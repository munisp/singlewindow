// freezone-service — Free Zone Operations Management
// Handles zone registration, operator licensing, goods admission/transfer/exit
// with duty-suspension tracking and inventory snapshots.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── Domain Types ─────────────────────────────────────────────────────────────

type ZoneStatus string
const (
	ZoneActive    ZoneStatus = "ACTIVE"
	ZoneSuspended ZoneStatus = "SUSPENDED"
	ZoneRevoked   ZoneStatus = "REVOKED"
)

type GoodsStatus string
const (
	GoodsAdmitted    GoodsStatus = "ADMITTED"
	GoodsTransferred GoodsStatus = "TRANSFERRED"
	GoodsExited      GoodsStatus = "EXITED"
	GoodsDestroyed   GoodsStatus = "DESTROYED"
)

type ExitDestination string
const (
	ExitDomestic  ExitDestination = "DOMESTIC"
	ExitReExport  ExitDestination = "RE_EXPORT"
	ExitDestruct  ExitDestination = "DESTRUCTION"
)

type FreeZone struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	Code          string     `json:"code"`
	Location      string     `json:"location"`
	OperatorName  string     `json:"operatorName"`
	LicenceNumber string     `json:"licenceNumber"`
	ZoneType      string     `json:"zoneType"` // EXPORT_PROCESSING, LOGISTICS, TECHNOLOGY, GENERAL
	CapacityM3    float64    `json:"capacityM3"`
	UsedM3        float64    `json:"usedM3"`
	Status        ZoneStatus `json:"status"`
	CreatedAt     time.Time  `json:"createdAt"`
}

type GoodsRecord struct {
	ID              string          `json:"id"`
	ZoneID          string          `json:"zoneId"`
	UCR             string          `json:"ucr"`
	TraderRef       string          `json:"traderRef"`
	HSCode          string          `json:"hsCode"`
	Description     string          `json:"description"`
	OriginCountry   string          `json:"originCountry"`
	GrossWeightKg   float64         `json:"grossWeightKg"`
	VolumeM3        float64         `json:"volumeM3"`
	InvoiceValue    float64         `json:"invoiceValue"`
	Currency        string          `json:"currency"`
	DutyRate        float64         `json:"dutyRate"`
	DutyOwed        float64         `json:"dutyOwed"` // calculated on exit to domestic
	Status          GoodsStatus     `json:"status"`
	CurrentZoneID   string          `json:"currentZoneId"`
	ExitDestination ExitDestination `json:"exitDestination,omitempty"`
	ExitDutyPaid    float64         `json:"exitDutyPaid,omitempty"`
	AdmittedAt      time.Time       `json:"admittedAt"`
	ExitedAt        *time.Time      `json:"exitedAt,omitempty"`
	TransferHistory []TransferEvent `json:"transferHistory,omitempty"`
}

type TransferEvent struct {
	FromZoneID string    `json:"fromZoneId"`
	ToZoneID   string    `json:"toZoneId"`
	Reason     string    `json:"reason"`
	OfficerRef string    `json:"officerRef"`
	TransferAt time.Time `json:"transferAt"`
}

// ─── PostgreSQL Store ─────────────────────────────────────────────────────────
// Phase 24: zones (free_zones) and goods (freezone_goods) are persisted in
// PostgreSQL via pgx/v5. FAIL-CLOSED: the service refuses to start without
// DATABASE_URL and never falls back to an in-memory store.

var db *pgxpool.Pool

const zoneColumns = `id, name, code, location, operator_name, licence_number, zone_type, capacity_m3, used_m3, status, created_at`

func scanZone(row pgx.Row) (*FreeZone, error) {
	var z FreeZone
	err := row.Scan(&z.ID, &z.Name, &z.Code, &z.Location, &z.OperatorName,
		&z.LicenceNumber, &z.ZoneType, &z.CapacityM3, &z.UsedM3, &z.Status, &z.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &z, nil
}

const goodsColumns = `id, zone_id, ucr, trader_ref, hs_code, description, origin_country,
	gross_weight_kg, volume_m3, invoice_value, currency, duty_rate, duty_owed, status,
	current_zone_id, exit_destination, exit_duty_paid, admitted_at, exited_at, transfer_history`

func scanGoods(row pgx.Row) (*GoodsRecord, error) {
	var g GoodsRecord
	var history []byte
	err := row.Scan(&g.ID, &g.ZoneID, &g.UCR, &g.TraderRef, &g.HSCode, &g.Description,
		&g.OriginCountry, &g.GrossWeightKg, &g.VolumeM3, &g.InvoiceValue, &g.Currency,
		&g.DutyRate, &g.DutyOwed, &g.Status, &g.CurrentZoneID, &g.ExitDestination,
		&g.ExitDutyPaid, &g.AdmittedAt, &g.ExitedAt, &history)
	if err != nil {
		return nil, err
	}
	if len(history) > 0 {
		_ = json.Unmarshal(history, &g.TransferHistory)
	}
	return &g, nil
}

func insertGoods(ctx context.Context, tx pgx.Tx, g *GoodsRecord) error {
	history, err := json.Marshal(g.TransferHistory)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO freezone_goods (`+goodsColumns+`)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
		g.ID, g.ZoneID, g.UCR, g.TraderRef, g.HSCode, g.Description, g.OriginCountry,
		g.GrossWeightKg, g.VolumeM3, g.InvoiceValue, g.Currency, g.DutyRate, g.DutyOwed,
		g.Status, g.CurrentZoneID, g.ExitDestination, g.ExitDutyPaid, g.AdmittedAt,
		g.ExitedAt, history)
	return err
}

func updateGoods(ctx context.Context, tx pgx.Tx, g *GoodsRecord) error {
	history, err := json.Marshal(g.TransferHistory)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE freezone_goods SET status=$2, current_zone_id=$3,
		exit_destination=$4, exit_duty_paid=$5, duty_owed=$6, exited_at=$7, transfer_history=$8
		WHERE id=$1`,
		g.ID, g.Status, g.CurrentZoneID, g.ExitDestination, g.ExitDutyPaid, g.DutyOwed,
		g.ExitedAt, history)
	return err
}

// adjustZoneUsedM3 applies a signed delta to a zone's used capacity.
func adjustZoneUsedM3(ctx context.Context, tx pgx.Tx, zoneID string, delta float64) error {
	_, err := tx.Exec(ctx, `UPDATE free_zones SET used_m3 = used_m3 + $2 WHERE id = $1`, zoneID, delta)
	return err
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func generateLicenceNumber(zoneCode string) string {
	year := time.Now().Year()
	seq := rand.Intn(9000) + 1000
	return fmt.Sprintf("FZ-%s-%d-%04d", strings.ToUpper(zoneCode), year, seq)
}

func calculateDuty(value, dutyRate float64, dest ExitDestination) float64 {
	if dest == ExitReExport || dest == ExitDestruct {
		return 0
	}
	return math.Round(value*dutyRate*100) / 100
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

func registerZone(c *gin.Context) {
	var req struct {
		Name         string  `json:"name" binding:"required"`
		Code         string  `json:"code" binding:"required"`
		Location     string  `json:"location" binding:"required"`
		OperatorName string  `json:"operatorName" binding:"required"`
		ZoneType     string  `json:"zoneType" binding:"required"`
		CapacityM3   float64 `json:"capacityM3" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	zone := &FreeZone{
		ID:            "FZ-" + strings.ToUpper(uuid.New().String()[:8]),
		Name:          req.Name,
		Code:          strings.ToUpper(req.Code),
		Location:      req.Location,
		OperatorName:  req.OperatorName,
		LicenceNumber: generateLicenceNumber(req.Code),
		ZoneType:      req.ZoneType,
		CapacityM3:    req.CapacityM3,
		UsedM3:        0,
		Status:        ZoneActive,
		CreatedAt:     time.Now(),
	}

	_, err := db.Exec(c.Request.Context(), `INSERT INTO free_zones (`+zoneColumns+`)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		zone.ID, zone.Name, zone.Code, zone.Location, zone.OperatorName,
		zone.LicenceNumber, zone.ZoneType, zone.CapacityM3, zone.UsedM3,
		zone.Status, zone.CreatedAt)
	if err != nil {
		log.Printf("[FreeZone Service] failed to persist zone: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist zone"})
		return
	}

	c.JSON(http.StatusCreated, zone)
}

func listZones(c *gin.Context) {
	rows, err := db.Query(c.Request.Context(),
		`SELECT `+zoneColumns+` FROM free_zones ORDER BY created_at DESC`)
	if err != nil {
		log.Printf("[FreeZone Service] list zones failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query zones"})
		return
	}
	defer rows.Close()

	result := []*FreeZone{}
	for rows.Next() {
		z, err := scanZone(rows)
		if err != nil {
			log.Printf("[FreeZone Service] scan zone failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query zones"})
			return
		}
		result = append(result, z)
	}
	c.JSON(http.StatusOK, gin.H{"zones": result, "total": len(result)})
}

func admitGoods(c *gin.Context) {
	zoneID := c.Param("zoneId")

	zone, err := scanZone(db.QueryRow(c.Request.Context(),
		`SELECT `+zoneColumns+` FROM free_zones WHERE id = $1`, zoneID))
	if err == pgx.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "zone not found"})
		return
	}
	if err != nil {
		log.Printf("[FreeZone Service] get zone failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query zone"})
		return
	}
	if zone.Status != ZoneActive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "zone is not active"})
		return
	}

	var req struct {
		UCR           string  `json:"ucr" binding:"required"`
		TraderRef     string  `json:"traderRef" binding:"required"`
		HSCode        string  `json:"hsCode" binding:"required"`
		Description   string  `json:"description" binding:"required"`
		OriginCountry string  `json:"originCountry" binding:"required"`
		GrossWeightKg float64 `json:"grossWeightKg" binding:"required"`
		VolumeM3      float64 `json:"volumeM3" binding:"required"`
		InvoiceValue  float64 `json:"invoiceValue" binding:"required"`
		Currency      string  `json:"currency" binding:"required"`
		DutyRate      float64 `json:"dutyRate"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Capacity check + reservation in one transaction (row lock on the zone).
	ctx := c.Request.Context()
	tx, err := db.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist goods"})
		return
	}
	defer tx.Rollback(ctx)

	locked, err := scanZone(tx.QueryRow(ctx,
		`SELECT `+zoneColumns+` FROM free_zones WHERE id = $1 FOR UPDATE`, zoneID))
	if err != nil {
		log.Printf("[FreeZone Service] lock zone failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query zone"})
		return
	}
	if locked.UsedM3+req.VolumeM3 > locked.CapacityM3 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":     "insufficient capacity",
			"available": locked.CapacityM3 - locked.UsedM3,
			"requested": req.VolumeM3,
		})
		return
	}
	if err := adjustZoneUsedM3(ctx, tx, zoneID, req.VolumeM3); err != nil {
		log.Printf("[FreeZone Service] update zone capacity failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist goods"})
		return
	}

	goods := &GoodsRecord{
		ID:            "GDS-" + strings.ToUpper(uuid.New().String()[:8]),
		ZoneID:        zoneID,
		UCR:           req.UCR,
		TraderRef:     req.TraderRef,
		HSCode:        req.HSCode,
		Description:   req.Description,
		OriginCountry: req.OriginCountry,
		GrossWeightKg: req.GrossWeightKg,
		VolumeM3:      req.VolumeM3,
		InvoiceValue:  req.InvoiceValue,
		Currency:      req.Currency,
		DutyRate:      req.DutyRate,
		Status:        GoodsAdmitted,
		CurrentZoneID: zoneID,
		AdmittedAt:    time.Now(),
	}

	if err := insertGoods(ctx, tx, goods); err != nil {
		log.Printf("[FreeZone Service] failed to persist goods: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist goods"})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		log.Printf("[FreeZone Service] commit failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to persist goods"})
		return
	}

	c.JSON(http.StatusCreated, goods)
}

func transferGoods(c *gin.Context) {
	goodsID := c.Param("goodsId")

	ctx := c.Request.Context()
	tx, err := db.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to transfer goods"})
		return
	}
	defer tx.Rollback(ctx)

	goods, err := scanGoods(tx.QueryRow(ctx,
		`SELECT `+goodsColumns+` FROM freezone_goods WHERE id = $1 FOR UPDATE`, goodsID))
	if err == pgx.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "goods not found"})
		return
	}
	if err != nil {
		log.Printf("[FreeZone Service] get goods failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to transfer goods"})
		return
	}
	if goods.Status == GoodsExited || goods.Status == GoodsDestroyed {
		c.JSON(http.StatusBadRequest, gin.H{"error": "goods have already exited the free zone"})
		return
	}

	var req struct {
		ToZoneID   string `json:"toZoneId" binding:"required"`
		Reason     string `json:"reason" binding:"required"`
		OfficerRef string `json:"officerRef"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate destination zone
	destZone, err := scanZone(tx.QueryRow(ctx,
		`SELECT `+zoneColumns+` FROM free_zones WHERE id = $1 FOR UPDATE`, req.ToZoneID))
	if err != nil || destZone.Status != ZoneActive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "destination zone not found or inactive"})
		return
	}

	// Update capacity on both zones
	if err := adjustZoneUsedM3(ctx, tx, goods.CurrentZoneID, -goods.VolumeM3); err != nil {
		log.Printf("[FreeZone Service] release source capacity failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to transfer goods"})
		return
	}
	if err := adjustZoneUsedM3(ctx, tx, req.ToZoneID, goods.VolumeM3); err != nil {
		log.Printf("[FreeZone Service] reserve destination capacity failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to transfer goods"})
		return
	}

	event := TransferEvent{
		FromZoneID: goods.CurrentZoneID,
		ToZoneID:   req.ToZoneID,
		Reason:     req.Reason,
		OfficerRef: req.OfficerRef,
		TransferAt: time.Now(),
	}
	goods.TransferHistory = append(goods.TransferHistory, event)
	goods.CurrentZoneID = req.ToZoneID
	goods.Status = GoodsTransferred
	if err := updateGoods(ctx, tx, goods); err != nil {
		log.Printf("[FreeZone Service] update goods failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to transfer goods"})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to transfer goods"})
		return
	}

	c.JSON(http.StatusOK, goods)
}

func exitGoods(c *gin.Context) {
	goodsID := c.Param("goodsId")

	ctx := c.Request.Context()
	tx, err := db.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to exit goods"})
		return
	}
	defer tx.Rollback(ctx)

	goods, err := scanGoods(tx.QueryRow(ctx,
		`SELECT `+goodsColumns+` FROM freezone_goods WHERE id = $1 FOR UPDATE`, goodsID))
	if err == pgx.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "goods not found"})
		return
	}
	if err != nil {
		log.Printf("[FreeZone Service] get goods failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to exit goods"})
		return
	}
	if goods.Status == GoodsExited || goods.Status == GoodsDestroyed {
		c.JSON(http.StatusBadRequest, gin.H{"error": "goods have already exited"})
		return
	}

	var req struct {
		Destination ExitDestination `json:"destination" binding:"required"`
		DutyPaid    float64         `json:"dutyPaid"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	dutyOwed := calculateDuty(goods.InvoiceValue, goods.DutyRate, req.Destination)
	if req.Destination == ExitDomestic && req.DutyPaid < dutyOwed {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":    "insufficient duty payment for domestic release",
			"dutyOwed": dutyOwed,
			"dutyPaid": req.DutyPaid,
		})
		return
	}

	// Release capacity
	if err := adjustZoneUsedM3(ctx, tx, goods.CurrentZoneID, -goods.VolumeM3); err != nil {
		log.Printf("[FreeZone Service] release capacity failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to exit goods"})
		return
	}

	now := time.Now()
	goods.Status = GoodsExited
	goods.ExitDestination = req.Destination
	goods.ExitDutyPaid = req.DutyPaid
	goods.DutyOwed = dutyOwed
	goods.ExitedAt = &now
	if err := updateGoods(ctx, tx, goods); err != nil {
		log.Printf("[FreeZone Service] update goods failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to exit goods"})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to exit goods"})
		return
	}

	c.JSON(http.StatusOK, goods)
}

func listInventory(c *gin.Context) {
	zoneID := c.Query("zoneId")
	status := c.Query("status")

	rows, err := db.Query(c.Request.Context(),
		`SELECT `+goodsColumns+` FROM freezone_goods
		 WHERE ($1 = '' OR current_zone_id = $1) AND ($2 = '' OR status = $2)
		 ORDER BY admitted_at DESC`, zoneID, status)
	if err != nil {
		log.Printf("[FreeZone Service] list inventory failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query inventory"})
		return
	}
	defer rows.Close()

	result := []*GoodsRecord{}
	for rows.Next() {
		g, err := scanGoods(rows)
		if err != nil {
			log.Printf("[FreeZone Service] scan goods failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query inventory"})
			return
		}
		result = append(result, g)
	}
	c.JSON(http.StatusOK, gin.H{"inventory": result, "total": len(result)})
}

func getZoneStats(c *gin.Context) {
	ctx := c.Request.Context()

	var totalZones, activeZones int
	var totalCapacity, totalUsed float64
	if err := db.QueryRow(ctx, `SELECT COUNT(*),
		COUNT(*) FILTER (WHERE status = 'ACTIVE'),
		COALESCE(SUM(capacity_m3), 0), COALESCE(SUM(used_m3), 0)
		FROM free_zones`).Scan(&totalZones, &activeZones, &totalCapacity, &totalUsed); err != nil {
		log.Printf("[FreeZone Service] zone stats failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to compute stats"})
		return
	}

	var admitted, exited int
	var totalValue float64
	if err := db.QueryRow(ctx, `SELECT
		COUNT(*) FILTER (WHERE status IN ('ADMITTED', 'TRANSFERRED')),
		COUNT(*) FILTER (WHERE status = 'EXITED'),
		COALESCE(SUM(invoice_value) FILTER (WHERE status IN ('ADMITTED', 'TRANSFERRED')), 0)
		FROM freezone_goods`).Scan(&admitted, &exited, &totalValue); err != nil {
		log.Printf("[FreeZone Service] goods stats failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to compute stats"})
		return
	}

	utilisation := 0.0
	if totalCapacity > 0 {
		utilisation = math.Round((totalUsed/totalCapacity)*10000) / 100
	}

	c.JSON(http.StatusOK, gin.H{
		"totalZones":     totalZones,
		"activeZones":    activeZones,
		"totalCapacityM3": totalCapacity,
		"usedCapacityM3":  totalUsed,
		"utilisationPct":  utilisation,
		"goodsInZone":    admitted,
		"goodsExited":    exited,
		"totalValueUSD":  totalValue,
	})
}

func healthCheck(c *gin.Context) {
	var one int
	if err := db.QueryRow(c.Request.Context(), "SELECT 1").Scan(&one); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":    "unhealthy",
			"service":   "freezone-service",
			"version":   "1.0.0",
			"zones":     0,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
		return
	}
	var zoneCount int
	_ = db.QueryRow(c.Request.Context(), "SELECT COUNT(*) FROM free_zones").Scan(&zoneCount)
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "freezone-service",
		"version":   "1.0.0",
		"zones":     zoneCount,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8098"
	}

	// Fail-closed: no database, no service. Never fall back to memory.
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("[FreeZone Service] DATABASE_URL is required; refusing to start (fail-closed)")
	}
	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		log.Fatalf("[FreeZone Service] Invalid DATABASE_URL: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("[FreeZone Service] Database unreachable: %v (fail-closed, refusing to start)", err)
	}
	db = pool
	log.Printf("[FreeZone Service] Connected to PostgreSQL")

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	r.GET("/health", healthCheck)
	r.POST("/zones", registerZone)
	r.GET("/zones", listZones)
	r.POST("/zones/:zoneId/admit", admitGoods)
	r.POST("/goods/:goodsId/transfer", transferGoods)
	r.POST("/goods/:goodsId/exit", exitGoods)
	r.GET("/inventory", listInventory)
	r.GET("/stats", getZoneStats)

	log.Printf("[FreeZone Service] Starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start: %v", err)
	}
}
