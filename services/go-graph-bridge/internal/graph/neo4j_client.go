// neo4j_client.go — Real Neo4j Bolt client for TradeGateway NGSWTP
//
// Replaces the MockGraphClient with a production Neo4j driver.
// Supports:
//   - Trader network analysis (fraud ring detection)
//   - HS code co-occurrence graphs
//   - Declaration relationship mapping
//   - Shortest path between suspicious entities
//   - Community detection (Louvain algorithm via GDS)
//
// Environment variables:
//   NEO4J_URI       — Bolt URI (default: bolt://localhost:7687)
//   NEO4J_USER      — Username (default: neo4j)
//   NEO4J_PASSWORD  — Password
//   NEO4J_DATABASE  — Database name (default: neo4j)
package graph

import (
	"context"
	"fmt"
	"time"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// ─── Neo4j Client ─────────────────────────────────────────────────────────────

type Neo4jClient struct {
	driver neo4j.DriverWithContext
	db     string
}

// NewNeo4jClient creates a new Neo4j client with connection pooling.
func NewNeo4jClient() (*Neo4jClient, error) {
	uri := getEnv("NEO4J_URI", "bolt://localhost:7687")
	user := getEnv("NEO4J_USER", "neo4j")
	password := mustGetEnv("NEO4J_PASSWORD") // SW-S2-4: no default secret
	database := getEnv("NEO4J_DATABASE", "neo4j")

	driver, err := neo4j.NewDriverWithContext(
		uri,
		neo4j.BasicAuth(user, password, ""),
		func(c *neo4j.Config) {
			c.MaxConnectionPoolSize = 25
			c.ConnectionAcquisitionTimeout = 10 * time.Second
			c.SocketConnectTimeout = 5 * time.Second
			c.MaxConnectionLifetime = 1 * time.Hour
		},
	)
	if err != nil {
		return nil, fmt.Errorf("neo4j driver creation failed: %w", err)
	}

	// Verify connectivity
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := driver.VerifyConnectivity(ctx); err != nil {
		return nil, fmt.Errorf("neo4j connectivity check failed: %w", err)
	}

	return &Neo4jClient{driver: driver, db: database}, nil
}

// Close closes the Neo4j driver.
func (c *Neo4jClient) Close(ctx context.Context) {
	c.driver.Close(ctx)
}

// ─── Schema Bootstrap ─────────────────────────────────────────────────────────

// EnsureSchema creates constraints and indexes for the trade graph.
func (c *Neo4jClient) EnsureSchema(ctx context.Context) error {
	session := c.driver.NewSession(ctx, neo4j.SessionConfig{DatabaseName: c.db})
	defer session.Close(ctx)

	constraints := []string{
		"CREATE CONSTRAINT trader_id IF NOT EXISTS FOR (t:Trader) REQUIRE t.traderId IS UNIQUE",
		"CREATE CONSTRAINT declaration_id IF NOT EXISTS FOR (d:Declaration) REQUIRE d.declarationId IS UNIQUE",
		"CREATE CONSTRAINT hs_code IF NOT EXISTS FOR (h:HSCode) REQUIRE h.code IS UNIQUE",
		"CREATE CONSTRAINT country_code IF NOT EXISTS FOR (c:Country) REQUIRE c.code IS UNIQUE",
		"CREATE INDEX trader_risk IF NOT EXISTS FOR (t:Trader) ON (t.riskScore)",
		"CREATE INDEX declaration_status IF NOT EXISTS FOR (d:Declaration) ON (d.status)",
		"CREATE INDEX declaration_created IF NOT EXISTS FOR (d:Declaration) ON (d.createdAt)",
	}

	for _, cypher := range constraints {
		_, err := session.Run(ctx, cypher, nil)
		if err != nil {
			// Ignore "already exists" errors
			continue
		}
	}

	return nil
}

// ─── Node Upsert ─────────────────────────────────────────────────────────────

// UpsertTrader creates or updates a Trader node.
func (c *Neo4jClient) UpsertTrader(ctx context.Context, trader map[string]interface{}) error {
	session := c.driver.NewSession(ctx, neo4j.SessionConfig{DatabaseName: c.db})
	defer session.Close(ctx)

	_, err := session.Run(ctx, `
		MERGE (t:Trader {traderId: $traderId})
		SET t.riskScore = $riskScore,
		    t.violationCount = $violationCount,
		    t.aeoStatus = $aeoStatus,
		    t.declarationCount = $declarationCount,
		    t.updatedAt = datetime()
	`, trader)
	return err
}

// UpsertDeclaration creates or updates a Declaration node and its relationships.
func (c *Neo4jClient) UpsertDeclaration(ctx context.Context, decl map[string]interface{}) error {
	session := c.driver.NewSession(ctx, neo4j.SessionConfig{DatabaseName: c.db})
	defer session.Close(ctx)

	_, err := session.Run(ctx, `
		MERGE (d:Declaration {declarationId: $declarationId})
		SET d.hsCode = $hsCode,
		    d.declaredValue = $declaredValue,
		    d.status = $status,
		    d.riskLane = $riskLane,
		    d.isFraud = $isFraud,
		    d.createdAt = datetime($createdAt)

		WITH d
		MERGE (t:Trader {traderId: $traderId})
		MERGE (t)-[:SUBMITTED]->(d)

		WITH d
		MERGE (h:HSCode {code: $hsCode})
		MERGE (d)-[:CLASSIFIES_AS]->(h)

		WITH d
		MERGE (c:Country {code: $originCountry})
		MERGE (d)-[:ORIGINATES_FROM]->(c)
	`, decl)
	return err
}

// ─── Fraud Ring Detection ─────────────────────────────────────────────────────

// FindFraudRings detects clusters of traders with high mutual risk using
// the Louvain community detection algorithm (requires Neo4j GDS plugin).
func (c *Neo4jClient) FindFraudRings(ctx context.Context, minRiskScore float64) ([]map[string]interface{}, error) {
	session := c.driver.NewSession(ctx, neo4j.SessionConfig{DatabaseName: c.db})
	defer session.Close(ctx)

	// Project graph for GDS
	_, _ = session.Run(ctx, `
		CALL gds.graph.project.cypher(
		  'fraud-network',
		  'MATCH (t:Trader) WHERE t.riskScore >= $minRisk RETURN id(t) AS id, t.riskScore AS riskScore',
		  'MATCH (t1:Trader)-[:SUBMITTED]->(d:Declaration)<-[:SUBMITTED]-(t2:Trader)
		   WHERE t1 <> t2 RETURN id(t1) AS source, id(t2) AS target, count(d) AS weight',
		  {parameters: {minRisk: $minRisk}}
		)
	`, map[string]interface{}{"minRisk": minRiskScore})

	// Run Louvain community detection
	result, err := session.Run(ctx, `
		CALL gds.louvain.stream('fraud-network')
		YIELD nodeId, communityId
		WITH communityId, collect(gds.util.asNode(nodeId).traderId) AS traders,
		     avg(gds.util.asNode(nodeId).riskScore) AS avgRisk
		WHERE size(traders) >= 2
		RETURN communityId, traders, avgRisk
		ORDER BY avgRisk DESC
		LIMIT 20
	`, nil)
	if err != nil {
		// GDS not available — fallback to simple query
		return c.findHighRiskTraderClusters(ctx, minRiskScore)
	}

	var rings []map[string]interface{}
	for result.Next(ctx) {
		record := result.Record()
		rings = append(rings, map[string]interface{}{
			"communityId": record.Values[0],
			"traders":     record.Values[1],
			"avgRisk":     record.Values[2],
		})
	}

	// Drop projected graph
	_, _ = session.Run(ctx, `CALL gds.graph.drop('fraud-network', false)`, nil)

	return rings, nil
}

// findHighRiskTraderClusters is a fallback for when GDS is not available.
func (c *Neo4jClient) findHighRiskTraderClusters(ctx context.Context, minRiskScore float64) ([]map[string]interface{}, error) {
	session := c.driver.NewSession(ctx, neo4j.SessionConfig{DatabaseName: c.db})
	defer session.Close(ctx)

	result, err := session.Run(ctx, `
		MATCH (t1:Trader)-[:SUBMITTED]->(d:Declaration)<-[:SUBMITTED]-(t2:Trader)
		WHERE t1 <> t2
		  AND t1.riskScore >= $minRisk
		  AND t2.riskScore >= $minRisk
		WITH t1, collect(DISTINCT t2.traderId) AS connectedTraders,
		     count(DISTINCT d) AS sharedDeclarations
		WHERE size(connectedTraders) >= 1
		RETURN t1.traderId AS trader, connectedTraders, sharedDeclarations,
		       t1.riskScore AS riskScore
		ORDER BY riskScore DESC
		LIMIT 20
	`, map[string]interface{}{"minRisk": minRiskScore})
	if err != nil {
		return nil, err
	}

	var clusters []map[string]interface{}
	for result.Next(ctx) {
		record := result.Record()
		clusters = append(clusters, map[string]interface{}{
			"trader":              record.Values[0],
			"connectedTraders":    record.Values[1],
			"sharedDeclarations":  record.Values[2],
			"riskScore":           record.Values[3],
		})
	}
	return clusters, nil
}

// ─── Trader Risk Network ──────────────────────────────────────────────────────

// GetTraderNetwork returns the immediate network of a trader (1-hop).
func (c *Neo4jClient) GetTraderNetwork(ctx context.Context, traderID string, depth int) (map[string]interface{}, error) {
	session := c.driver.NewSession(ctx, neo4j.SessionConfig{DatabaseName: c.db})
	defer session.Close(ctx)

	if depth < 1 {
		depth = 1
	}
	if depth > 3 {
		depth = 3
	}

	result, err := session.Run(ctx, fmt.Sprintf(`
		MATCH path = (t:Trader {traderId: $traderId})-[:SUBMITTED*1..%d]->(d:Declaration)
		WITH t, collect(DISTINCT d.declarationId) AS declarations,
		     count(DISTINCT d) AS totalDeclarations
		OPTIONAL MATCH (t)-[:SUBMITTED]->(d2:Declaration)<-[:SUBMITTED]-(t2:Trader)
		WHERE t2 <> t
		RETURN t.traderId AS traderId,
		       t.riskScore AS riskScore,
		       t.violationCount AS violations,
		       totalDeclarations,
		       collect(DISTINCT t2.traderId) AS connectedTraders,
		       count(DISTINCT t2) AS networkSize
	`, depth), map[string]interface{}{"traderId": traderID})
	if err != nil {
		return nil, err
	}

	if result.Next(ctx) {
		record := result.Record()
		return map[string]interface{}{
			"traderId":         record.Values[0],
			"riskScore":        record.Values[1],
			"violations":       record.Values[2],
			"totalDeclarations": record.Values[3],
			"connectedTraders": record.Values[4],
			"networkSize":      record.Values[5],
		}, nil
	}

	return nil, fmt.Errorf("trader %s not found in graph", traderID)
}

// ─── HS Code Analysis ─────────────────────────────────────────────────────────

// GetHSCodeRiskProfile returns fraud statistics for an HS code.
func (c *Neo4jClient) GetHSCodeRiskProfile(ctx context.Context, hsCode string) (map[string]interface{}, error) {
	session := c.driver.NewSession(ctx, neo4j.SessionConfig{DatabaseName: c.db})
	defer session.Close(ctx)

	result, err := session.Run(ctx, `
		MATCH (h:HSCode {code: $hsCode})<-[:CLASSIFIES_AS]-(d:Declaration)
		RETURN h.code AS hsCode,
		       count(d) AS totalDeclarations,
		       count(d) * 1.0 / count(d) AS fraudRate,
		       avg(d.declaredValue) AS avgDeclaredValue,
		       collect(DISTINCT d.riskLane) AS riskLanes
	`, map[string]interface{}{"hsCode": hsCode})
	if err != nil {
		return nil, err
	}

	if result.Next(ctx) {
		record := result.Record()
		return map[string]interface{}{
			"hsCode":            record.Values[0],
			"totalDeclarations": record.Values[1],
			"fraudRate":         record.Values[2],
			"avgDeclaredValue":  record.Values[3],
			"riskLanes":         record.Values[4],
		}, nil
	}

	return map[string]interface{}{"hsCode": hsCode, "totalDeclarations": 0}, nil
}

// getEnv is defined in client.go (same package).
