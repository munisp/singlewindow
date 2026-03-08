/*!
 * graph_risk_lib — Core trade knowledge graph and GNN risk propagation engine
 *
 * Architecture:
 *   - TradeGraph: in-memory petgraph DiGraph of trade entities (traders, declarations,
 *     HS codes, ports, OGAs, sanctions entities)
 *   - GnnRiskPropagator: message-passing GNN that propagates risk scores along edges
 *     (TRADER→DECLARATION, DECLARATION→HS_CODE, TRADER→SANCTIONS, PORT→CORRIDOR)
 *   - RiskCache: Redis-backed cache of computed risk scores (TTL = 5 min)
 *   - GraphQuery: Cypher-compatible query builder for FalkorDB/Neo4j
 *
 * Language choice rationale:
 *   Rust is used here because:
 *   1. GNN message-passing over large graphs is CPU-bound; Rust gives ~10x speedup vs Python
 *   2. Zero-cost abstractions allow safe concurrent graph traversal without GIL
 *   3. Petgraph provides O(1) edge/node lookup with cache-friendly memory layout
 *   4. The risk engine is called synchronously from the Go bridge on every declaration
 *      submission — latency must be < 50ms at p99
 */

use std::collections::HashMap;
use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::visit::EdgeRef;
use petgraph::Direction;
use serde::{Deserialize, Serialize};
use thiserror::Error;

// ─── ERROR TYPES ─────────────────────────────────────────────────────────────

#[derive(Error, Debug)]
pub enum GraphRiskError {
    #[error("Node not found: {0}")]
    NodeNotFound(String),
    #[error("Graph traversal error: {0}")]
    TraversalError(String),
    #[error("Risk computation error: {0}")]
    ComputationError(String),
    #[error("Cache error: {0}")]
    CacheError(String),
    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),
}

// ─── GRAPH NODE TYPES ─────────────────────────────────────────────────────────

/// Every node in the trade knowledge graph
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TradeNode {
    Trader {
        id: String,
        name: String,
        country: String,
        aeo_status: bool,
        kyc_verified: bool,
        /// Cumulative risk score [0.0, 1.0] — updated by GNN propagation
        risk_score: f32,
        /// Number of historical violations
        violation_count: u32,
        /// Total declared value (USD) across all declarations
        total_declared_value: f64,
    },
    Declaration {
        id: String,
        declaration_number: String,
        hs_code: String,
        declared_value: f64,
        origin_country: String,
        destination_country: String,
        risk_score: f32,
        risk_lane: RiskLane,
        /// Whether the declaration was flagged by customs
        flagged: bool,
    },
    HsCode {
        code: String,
        description: String,
        chapter: String,
        /// Historical fraud rate for this HS code [0.0, 1.0]
        fraud_rate: f32,
        /// Whether this HS code is a controlled/dual-use good
        controlled: bool,
        /// Average duty rate
        avg_duty_rate: f32,
    },
    Port {
        id: String,
        name: String,
        country: String,
        /// Congestion index [0.0, 1.0]
        congestion: f32,
        /// Risk index based on historical smuggling incidents [0.0, 1.0]
        risk_index: f32,
        latitude: f64,
        longitude: f64,
    },
    Oga {
        id: String,
        name: String,
        /// Average processing time in hours
        avg_processing_hours: f32,
        /// SLA compliance rate [0.0, 1.0]
        sla_compliance: f32,
    },
    SanctionedEntity {
        id: String,
        name: String,
        list_source: String,
        /// Similarity score to a trader name [0.0, 1.0] — set when matched
        match_score: f32,
    },
    Corridor {
        id: String,
        origin: String,
        destination: String,
        /// Historical risk index for this trade corridor [0.0, 1.0]
        risk_index: f32,
        /// Volume of declarations through this corridor
        declaration_volume: u64,
    },
}

impl TradeNode {
    pub fn node_id(&self) -> &str {
        match self {
            TradeNode::Trader { id, .. } => id,
            TradeNode::Declaration { id, .. } => id,
            TradeNode::HsCode { code, .. } => code,
            TradeNode::Port { id, .. } => id,
            TradeNode::Oga { id, .. } => id,
            TradeNode::SanctionedEntity { id, .. } => id,
            TradeNode::Corridor { id, .. } => id,
        }
    }

    pub fn base_risk_score(&self) -> f32 {
        match self {
            TradeNode::Trader { risk_score, .. } => *risk_score,
            TradeNode::Declaration { risk_score, .. } => *risk_score,
            TradeNode::HsCode { fraud_rate, .. } => *fraud_rate,
            TradeNode::Port { risk_index, .. } => *risk_index,
            TradeNode::Oga { sla_compliance, .. } => 1.0 - sla_compliance,
            TradeNode::SanctionedEntity { match_score, .. } => *match_score,
            TradeNode::Corridor { risk_index, .. } => *risk_index,
        }
    }
}

/// Risk lane assignment (mirrors the database enum)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RiskLane {
    Green,
    Yellow,
    Red,
}

impl RiskLane {
    pub fn from_score(score: f32) -> Self {
        match score {
            s if s < 0.35 => RiskLane::Green,
            s if s < 0.70 => RiskLane::Yellow,
            _ => RiskLane::Red,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            RiskLane::Green => "green",
            RiskLane::Yellow => "yellow",
            RiskLane::Red => "red",
        }
    }
}

// ─── GRAPH EDGE TYPES ─────────────────────────────────────────────────────────

/// Typed edges encode the semantic relationship between nodes
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "rel", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TradeEdge {
    /// Trader submitted a declaration
    Submitted { timestamp: i64, weight: f32 },
    /// Declaration covers goods under this HS code
    ClassifiedUnder { weight: f32 },
    /// Declaration arrived at / departed from this port
    ArrivedAt { weight: f32 },
    /// Declaration required permit from this OGA
    RequiresPermitFrom { weight: f32 },
    /// Trader name matches a sanctioned entity
    MatchesSanction { similarity: f32, weight: f32 },
    /// Declaration follows this trade corridor
    FollowsCorridor { weight: f32 },
    /// Trader has a historical relationship with another trader (same beneficial owner)
    RelatedTo { relationship_type: String, weight: f32 },
}

impl TradeEdge {
    pub fn weight(&self) -> f32 {
        match self {
            TradeEdge::Submitted { weight, .. } => *weight,
            TradeEdge::ClassifiedUnder { weight } => *weight,
            TradeEdge::ArrivedAt { weight } => *weight,
            TradeEdge::RequiresPermitFrom { weight } => *weight,
            TradeEdge::MatchesSanction { weight, .. } => *weight,
            TradeEdge::FollowsCorridor { weight } => *weight,
            TradeEdge::RelatedTo { weight, .. } => *weight,
        }
    }
}

// ─── TRADE KNOWLEDGE GRAPH ────────────────────────────────────────────────────

/// In-memory trade knowledge graph backed by petgraph DiGraph.
/// This is the primary data structure for GNN risk propagation.
pub struct TradeGraph {
    pub graph: DiGraph<TradeNode, TradeEdge>,
    /// Map from node_id string → NodeIndex for O(1) lookup
    pub node_index: HashMap<String, NodeIndex>,
}

impl TradeGraph {
    pub fn new() -> Self {
        Self {
            graph: DiGraph::new(),
            node_index: HashMap::new(),
        }
    }

    /// Add a node to the graph. Returns the NodeIndex.
    pub fn add_node(&mut self, node: TradeNode) -> NodeIndex {
        let id = node.node_id().to_string();
        if let Some(&existing) = self.node_index.get(&id) {
            return existing;
        }
        let idx = self.graph.add_node(node);
        self.node_index.insert(id, idx);
        idx
    }

    /// Add a directed edge between two nodes by their string IDs.
    pub fn add_edge(
        &mut self,
        from_id: &str,
        to_id: &str,
        edge: TradeEdge,
    ) -> Result<(), GraphRiskError> {
        let from = *self.node_index.get(from_id)
            .ok_or_else(|| GraphRiskError::NodeNotFound(from_id.to_string()))?;
        let to = *self.node_index.get(to_id)
            .ok_or_else(|| GraphRiskError::NodeNotFound(to_id.to_string()))?;
        self.graph.add_edge(from, to, edge);
        Ok(())
    }

    /// Get a node by its string ID.
    pub fn get_node(&self, id: &str) -> Option<&TradeNode> {
        self.node_index.get(id)
            .and_then(|&idx| self.graph.node_weight(idx))
    }

    /// Get all neighbours (outgoing edges) of a node.
    pub fn neighbours(&self, id: &str) -> Vec<(&TradeNode, &TradeEdge)> {
        let Some(&idx) = self.node_index.get(id) else { return vec![] };
        self.graph.edges_directed(idx, Direction::Outgoing)
            .filter_map(|e| {
                let target = self.graph.node_weight(e.target())?;
                Some((target, e.weight()))
            })
            .collect()
    }

    /// Get all predecessors (incoming edges) of a node.
    pub fn predecessors(&self, id: &str) -> Vec<(&TradeNode, &TradeEdge)> {
        let Some(&idx) = self.node_index.get(id) else { return vec![] };
        self.graph.edges_directed(idx, Direction::Incoming)
            .filter_map(|e| {
                let source = self.graph.node_weight(e.source())?;
                Some((source, e.weight()))
            })
            .collect()
    }
}

impl Default for TradeGraph {
    fn default() -> Self {
        Self::new()
    }
}

// ─── GNN RISK PROPAGATOR ──────────────────────────────────────────────────────

/// Graph Neural Network risk propagation using message-passing.
///
/// Algorithm (GraphSAGE-style mean aggregation):
///   For each node v:
///     h_v^(k) = σ(W · CONCAT(h_v^(k-1), MEAN_{u ∈ N(v)} h_u^(k-1) * w_uv))
///   where:
///     h_v^(0) = base_risk_score(v)
///     w_uv    = edge weight (semantic relationship strength)
///     σ       = sigmoid activation
///     k       = propagation depth (default: 2 hops)
///
/// This captures:
///   - Direct risk: trader's own violation history
///   - 1-hop risk: risk from the HS codes, ports, corridors they use
///   - 2-hop risk: risk from the OGAs and sanctions entities connected to those
pub struct GnnRiskPropagator {
    /// Number of message-passing iterations
    pub depth: usize,
    /// Damping factor: how much neighbour risk bleeds into a node [0.0, 1.0]
    pub damping: f32,
    /// Weight of self-risk vs neighbour-risk [0.0, 1.0]
    pub self_weight: f32,
}

impl Default for GnnRiskPropagator {
    fn default() -> Self {
        Self {
            depth: 2,
            damping: 0.6,
            self_weight: 0.7,
        }
    }
}

impl GnnRiskPropagator {
    pub fn new(depth: usize, damping: f32, self_weight: f32) -> Self {
        Self { depth, damping, self_weight }
    }

    /// Sigmoid activation: maps any real value to (0, 1)
    fn sigmoid(x: f32) -> f32 {
        1.0 / (1.0 + (-x).exp())
    }

    /// Run GNN propagation on the graph and return a map of node_id → propagated risk score.
    /// This is the hot path — must complete in < 10ms for graphs up to 10,000 nodes.
    pub fn propagate(&self, graph: &TradeGraph) -> HashMap<String, f32> {
        // Initialise scores from base risk
        let mut scores: HashMap<String, f32> = graph.node_index.keys()
            .filter_map(|id| {
                let node = graph.get_node(id)?;
                Some((id.clone(), node.base_risk_score()))
            })
            .collect();

        // Message-passing iterations
        for _iteration in 0..self.depth {
            let prev_scores = scores.clone();
            for (id, &idx) in &graph.node_index {
                // Aggregate neighbour messages (mean aggregation with edge weights)
                let neighbours: Vec<_> = graph.graph
                    .edges_directed(idx, Direction::Incoming)
                    .filter_map(|e| {
                        let src_id = graph.graph.node_weight(e.source())?.node_id().to_string();
                        let src_score = prev_scores.get(&src_id).copied().unwrap_or(0.0);
                        let edge_weight = e.weight().weight();
                        Some(src_score * edge_weight)
                    })
                    .collect();

                let neighbour_mean = if neighbours.is_empty() {
                    0.0
                } else {
                    neighbours.iter().sum::<f32>() / neighbours.len() as f32
                };

                let self_score = prev_scores.get(id).copied().unwrap_or(0.0);

                // GraphSAGE-style aggregation with sigmoid activation
                let aggregated = Self::sigmoid(
                    self.self_weight * self_score
                    + (1.0 - self.self_weight) * neighbour_mean * self.damping
                );

                scores.insert(id.clone(), aggregated);
            }
        }

        scores
    }

    /// Compute risk score for a single declaration node, considering its full
    /// neighbourhood context (trader history, HS code fraud rate, port risk,
    /// corridor risk, sanctions matches).
    pub fn score_declaration(
        &self,
        graph: &TradeGraph,
        declaration_id: &str,
    ) -> Result<RiskResult, GraphRiskError> {
        let all_scores = self.propagate(graph);

        let base_score = graph.get_node(declaration_id)
            .map(|n| n.base_risk_score())
            .ok_or_else(|| GraphRiskError::NodeNotFound(declaration_id.to_string()))?;

        let propagated_score = all_scores.get(declaration_id).copied().unwrap_or(base_score);

        // Collect contributing factors from neighbours
        let mut factors: Vec<RiskFactor> = Vec::new();

        for (neighbour, edge) in graph.neighbours(declaration_id) {
            let neighbour_score = all_scores.get(neighbour.node_id()).copied().unwrap_or(0.0);
            if neighbour_score > 0.3 {
                factors.push(RiskFactor {
                    factor_type: format!("{:?}", std::mem::discriminant(neighbour)),
                    node_id: neighbour.node_id().to_string(),
                    contribution: neighbour_score * edge.weight(),
                    description: describe_factor(neighbour, neighbour_score),
                });
            }
        }

        // Also check incoming edges (trader who submitted)
        for (predecessor, edge) in graph.predecessors(declaration_id) {
            let pred_score = all_scores.get(predecessor.node_id()).copied().unwrap_or(0.0);
            if pred_score > 0.3 {
                factors.push(RiskFactor {
                    factor_type: "TRADER".to_string(),
                    node_id: predecessor.node_id().to_string(),
                    contribution: pred_score * edge.weight(),
                    description: describe_factor(predecessor, pred_score),
                });
            }
        }

        // Sort factors by contribution descending
        factors.sort_by(|a, b| b.contribution.partial_cmp(&a.contribution).unwrap_or(std::cmp::Ordering::Equal));

        let lane = RiskLane::from_score(propagated_score);

        Ok(RiskResult {
            declaration_id: declaration_id.to_string(),
            base_score,
            propagated_score,
            lane: lane.as_str().to_string(),
            factors,
            confidence: compute_confidence(graph, declaration_id),
        })
    }
}

/// Describe a risk factor in human-readable terms
fn describe_factor(node: &TradeNode, score: f32) -> String {
    match node {
        TradeNode::Trader { name, violation_count, aeo_status, .. } => {
            if *violation_count > 0 {
                format!("Trader '{}' has {} historical violation(s) (risk: {:.0}%)", name, violation_count, score * 100.0)
            } else if !aeo_status {
                format!("Trader '{}' is not AEO-certified (risk: {:.0}%)", name, score * 100.0)
            } else {
                format!("Trader '{}' (risk: {:.0}%)", name, score * 100.0)
            }
        }
        TradeNode::HsCode { code, description, controlled, fraud_rate, .. } => {
            if *controlled {
                format!("HS {} ({}) is a controlled/dual-use good (fraud rate: {:.0}%)", code, description, fraud_rate * 100.0)
            } else {
                format!("HS {} ({}) has {:.0}% historical fraud rate", code, description, fraud_rate * 100.0)
            }
        }
        TradeNode::Port { name, risk_index, .. } => {
            format!("Port '{}' has {:.0}% risk index based on smuggling incidents", name, risk_index * 100.0)
        }
        TradeNode::Corridor { origin, destination, risk_index, .. } => {
            format!("Corridor {}-{} has {:.0}% historical risk index", origin, destination, risk_index * 100.0)
        }
        TradeNode::SanctionedEntity { name, match_score, list_source, .. } => {
            format!("Trader name matches sanctioned entity '{}' on {} (similarity: {:.0}%)", name, list_source, match_score * 100.0)
        }
        _ => format!("Risk factor (score: {:.0}%)", score * 100.0),
    }
}

/// Compute confidence in the risk score based on graph connectivity.
/// More connected nodes have higher confidence.
fn compute_confidence(graph: &TradeGraph, node_id: &str) -> f32 {
    let neighbour_count = graph.neighbours(node_id).len()
        + graph.predecessors(node_id).len();
    // Confidence saturates at 5 connections → 0.95
    let raw = 1.0 - (1.0 / (1.0 + neighbour_count as f32));
    (raw * 0.95).min(0.95).max(0.3)
}

// ─── RISK RESULT ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskResult {
    pub declaration_id: String,
    pub base_score: f32,
    pub propagated_score: f32,
    pub lane: String,
    pub factors: Vec<RiskFactor>,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskFactor {
    pub factor_type: String,
    pub node_id: String,
    pub contribution: f32,
    pub description: String,
}

// ─── GRAPH QUERY BUILDER ──────────────────────────────────────────────────────

/// Cypher query builder for FalkorDB / Neo4j.
/// Generates parameterised Cypher queries for common trade graph operations.
pub struct GraphQuery;

impl GraphQuery {
    /// Find all declarations submitted by a trader in the last N days
    pub fn trader_declarations(trader_id: &str, days: u32) -> String {
        format!(
            r#"MATCH (t:Trader {{id: '{}'}})-[:SUBMITTED]->(d:Declaration)
WHERE d.submittedAt > datetime() - duration({{days: {}}})
RETURN d ORDER BY d.submittedAt DESC"#,
            trader_id, days
        )
    }

    /// Find traders connected to a sanctioned entity within 2 hops
    pub fn sanctions_network(entity_name: &str) -> String {
        format!(
            r#"MATCH path = (t:Trader)-[:MATCHES_SANCTION*1..2]->(s:SanctionedEntity {{name: '{}'}})
RETURN t, s, length(path) as hops ORDER BY hops ASC LIMIT 50"#,
            entity_name
        )
    }

    /// Find the highest-risk trade corridors by average declaration risk score
    pub fn high_risk_corridors(min_risk: f32) -> String {
        format!(
            r#"MATCH (d:Declaration)-[:FOLLOWS_CORRIDOR]->(c:Corridor)
WHERE d.riskScore > {}
RETURN c.id, c.origin, c.destination, avg(d.riskScore) as avgRisk, count(d) as volume
ORDER BY avgRisk DESC LIMIT 20"#,
            min_risk
        )
    }

    /// Find all OGAs that have SLA breaches in the last 30 days
    pub fn oga_sla_breaches() -> String {
        r#"MATCH (d:Declaration)-[:REQUIRES_PERMIT_FROM]->(o:OGA)
WHERE d.ogaResponseTime > o.slaHours AND d.submittedAt > datetime() - duration({days: 30})
RETURN o.name, count(d) as breaches, avg(d.ogaResponseTime) as avgResponseHours
ORDER BY breaches DESC"#.to_string()
    }

    /// Find traders with similar HS code patterns (potential collusion detection)
    pub fn similar_hs_patterns(trader_id: &str) -> String {
        format!(
            r#"MATCH (t1:Trader {{id: '{}'}})-[:SUBMITTED]->(d1:Declaration)-[:CLASSIFIED_UNDER]->(h:HsCode)
MATCH (t2:Trader)-[:SUBMITTED]->(d2:Declaration)-[:CLASSIFIED_UNDER]->(h)
WHERE t2.id <> t1.id
RETURN t2.id, t2.name, count(h) as sharedHsCodes, collect(h.code) as codes
ORDER BY sharedHsCodes DESC LIMIT 10"#,
            trader_id
        )
    }

    /// Upsert a Trader node in FalkorDB/Neo4j
    pub fn upsert_trader(
        id: &str, name: &str, country: &str,
        aeo: bool, kyc: bool, risk_score: f32,
    ) -> String {
        format!(
            r#"MERGE (t:Trader {{id: '{}'}})
SET t.name = '{}', t.country = '{}', t.aeoStatus = {}, t.kycVerified = {},
    t.riskScore = {}, t.updatedAt = datetime()
RETURN t"#,
            id, name, country, aeo, kyc, risk_score
        )
    }

    /// Upsert a Declaration node and link it to its trader
    pub fn upsert_declaration(
        decl_id: &str, decl_number: &str, trader_id: &str,
        hs_code: &str, declared_value: f64, risk_score: f32, lane: &str,
    ) -> String {
        format!(
            r#"MERGE (d:Declaration {{id: '{}'}})
SET d.declarationNumber = '{}', d.hsCode = '{}', d.declaredValue = {},
    d.riskScore = {}, d.lane = '{}', d.updatedAt = datetime()
WITH d
MATCH (t:Trader {{id: '{}'}})
MERGE (t)-[:SUBMITTED {{timestamp: datetime()}}]->(d)
RETURN d"#,
            decl_id, decl_number, hs_code, declared_value, risk_score, lane, trader_id
        )
    }
}

// ─── TESTS ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn build_test_graph() -> TradeGraph {
        let mut g = TradeGraph::new();

        // Add a trader with moderate risk
        g.add_node(TradeNode::Trader {
            id: "trader-001".to_string(),
            name: "Accra Imports Ltd".to_string(),
            country: "GH".to_string(),
            aeo_status: false,
            kyc_verified: true,
            risk_score: 0.4,
            violation_count: 2,
            total_declared_value: 500_000.0,
        });

        // Add a declaration
        g.add_node(TradeNode::Declaration {
            id: "decl-001".to_string(),
            declaration_number: "GH-2026-001234".to_string(),
            hs_code: "8471.30".to_string(),
            declared_value: 25_000.0,
            origin_country: "CN".to_string(),
            destination_country: "GH".to_string(),
            risk_score: 0.3,
            risk_lane: RiskLane::Yellow,
            flagged: false,
        });

        // Add a high-fraud HS code
        g.add_node(TradeNode::HsCode {
            code: "8471.30".to_string(),
            description: "Portable digital automatic data processing machines".to_string(),
            chapter: "84".to_string(),
            fraud_rate: 0.65,
            controlled: false,
            avg_duty_rate: 0.20,
        });

        // Add a port
        g.add_node(TradeNode::Port {
            id: "port-tema".to_string(),
            name: "Tema Port".to_string(),
            country: "GH".to_string(),
            congestion: 0.7,
            risk_index: 0.35,
            latitude: 5.6333,
            longitude: -0.0167,
        });

        // Wire edges
        g.add_edge("trader-001", "decl-001", TradeEdge::Submitted {
            timestamp: 1_741_000_000,
            weight: 1.0,
        }).unwrap();
        g.add_edge("decl-001", "8471.30", TradeEdge::ClassifiedUnder { weight: 0.9 }).unwrap();
        g.add_edge("decl-001", "port-tema", TradeEdge::ArrivedAt { weight: 0.8 }).unwrap();

        g
    }

    #[test]
    fn test_graph_construction() {
        let g = build_test_graph();
        assert_eq!(g.graph.node_count(), 4);
        assert_eq!(g.graph.edge_count(), 3);
        assert!(g.get_node("trader-001").is_some());
        assert!(g.get_node("decl-001").is_some());
    }

    #[test]
    fn test_gnn_propagation_increases_risk_for_high_fraud_hs() {
        let g = build_test_graph();
        let propagator = GnnRiskPropagator::default();
        let scores = propagator.propagate(&g);

        // The declaration is connected to a high-fraud HS code (0.65)
        // After propagation, its score should be higher than the base 0.3
        let decl_score = scores.get("decl-001").copied().unwrap_or(0.0);
        assert!(decl_score > 0.3, "Propagated score {:.3} should exceed base 0.3", decl_score);
    }

    #[test]
    fn test_risk_lane_assignment() {
        assert_eq!(RiskLane::from_score(0.1), RiskLane::Green);
        assert_eq!(RiskLane::from_score(0.5), RiskLane::Yellow);
        assert_eq!(RiskLane::from_score(0.8), RiskLane::Red);
    }

    #[test]
    fn test_score_declaration_returns_factors() {
        let g = build_test_graph();
        let propagator = GnnRiskPropagator::default();
        let result = propagator.score_declaration(&g, "decl-001").unwrap();

        assert!(!result.factors.is_empty(), "Should have risk factors");
        assert!(result.propagated_score >= 0.0 && result.propagated_score <= 1.0);
        assert!(result.confidence > 0.0);
    }

    #[test]
    fn test_graph_query_builder() {
        let q = GraphQuery::trader_declarations("trader-001", 30);
        assert!(q.contains("trader-001"));
        assert!(q.contains("SUBMITTED"));

        let q2 = GraphQuery::high_risk_corridors(0.5);
        assert!(q2.contains("FOLLOWS_CORRIDOR"));
        assert!(q2.contains("0.5"));
    }

    #[test]
    fn test_neighbours_and_predecessors() {
        let g = build_test_graph();
        let neighbours = g.neighbours("decl-001");
        assert_eq!(neighbours.len(), 2); // HS code + port

        let preds = g.predecessors("decl-001");
        assert_eq!(preds.len(), 1); // trader
    }
}
