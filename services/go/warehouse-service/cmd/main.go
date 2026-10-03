// warehouse-service — Bonded Warehouse Management microservice
// Implements duty-suspension bond lifecycle, inventory tracking (UCR-linked),
// and goods release with duty payment trigger per WCO guidelines.
//
// Phase 23 (C2): all state is persisted to the existing Drizzle-managed
// Postgres tables (bonded_warehouses, bonded_inventory, ex_bond_permits).
// The previous in-memory map store lost every warehouse/bond/inventory record
// on restart. The service is fail-closed: it refuses to start without a
// reachable DATABASE_URL and never falls back to memory.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── Domain types (JSON response shapes unchanged) ───────────────────────────

type WarehouseStatus string

const (
	StatusActive    WarehouseStatus = "active"
	StatusSuspended WarehouseStatus = "suspended"
	StatusRevoked   WarehouseStatus = "revoked"
)

type BondStatus string

const (
	BondActive    BondStatus = "active"
	BondReleased  BondStatus = "released"
	BondForfeited BondStatus = "forfeited"
	BondExpired   BondStatus = "expired"
)

type InventoryStatus string

const (
	InvDeposited   InventoryStatus = "deposited"
	InvReleased    InventoryStatus = "released"
	InvTransferred InventoryStatus = "transferred"
	InvDestroyed   InventoryStatus = "destroyed"
)

type Warehouse struct {
	ID             string          `json:"id"`
	LicenceNumber  string          `json:"licence_number"`
	OperatorID     int             `json:"operator_id"`
	Name           string          `json:"name"`
	PortCode       string          `json:"port_code"`
	Address        string          `json:"address"`
	MaxCapacityM3  float64         `json:"max_capacity_m3"`
	UsedCapacityM3 float64         `json:"used_capacity_m3"`
	Status         WarehouseStatus `json:"status"`
	RegisteredAt   time.Time       `json:"registered_at"`
}

type DutySuspensionBond struct {
	ID            string     `json:"id"`
	BondNumber    string     `json:"bond_number"`
	WarehouseID   string     `json:"warehouse_id"`
	UCR           string     `json:"ucr"`
	DeclarationID int        `json:"declaration_id"`
	TraderID      int        `json:"trader_id"`
	DutyAmount    float64    `json:"duty_amount"` // duty suspended (not yet paid)
	BondValue     float64    `json:"bond_value"`  // security posted (≥ duty amount)
	Currency      string     `json:"currency"`
	Status        BondStatus `json:"status"`
	IssuedAt      time.Time  `json:"issued_at"`
	ExpiresAt     time.Time  `json:"expires_at"`
	ReleasedAt    *time.Time `json:"released_at,omitempty"`
	ReleaseReason string     `json:"release_reason,omitempty"`
}

type InventoryItem struct {
	ID             string          `json:"id"`
	WarehouseID    string          `json:"warehouse_id"`
	BondID         string          `json:"bond_id"`
	UCR            string          `json:"ucr"`
	DeclarationID  int             `json:"declaration_id"`
	HSCode         string          `json:"hs_code"`
	Description    string          `json:"description"`
	QuantityKg     float64         `json:"quantity_kg"`
	VolumeM3       float64         `json:"volume_m3"`
	DeclaredValue  float64         `json:"declared_value"`
	DutyOwed       float64         `json:"duty_owed"`
	Status         InventoryStatus `json:"status"`
	DepositedAt    time.Time       `json:"deposited_at"`
	ReleasedAt     *time.Time      `json:"released_at,omitempty"`
	MaxStorageDays int             `json:"max_storage_days"` // typically 365 days
}

type ReleaseRequest struct {
	InventoryID     string  `json:"inventory_id"`
	BondID          string  `json:"bond_id"`
	DutyPaid        float64 `json:"duty_paid"`
	PaymentRef      string  `json:"payment_ref"`
	DestinationType string  `json:"destination_type"` // domestic | re_export | destruction
}

type ReleaseResult struct {
	Success         bool      `json:"success"`
	InventoryID     string    `json:"inventory_id"`
	BondID          string    `json:"bond_id"`
	DutySettled     float64   `json:"duty_settled"`
	BondReleased    bool      `json:"bond_released"`
	ReleasedAt      time.Time `json:"released_at"`
	ClearancePermit string    `json:"clearance_permit"`
	Message         string    `json:"message"`
}

// ─── Postgres store (pgx v5) ──────────────────────────────────────────────────

var db *pgxpool.Pool

func mustConnectDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("[warehouse-service] DATABASE_URL is required; refusing to start without persistent storage")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatalf("[warehouse-service] invalid DATABASE_URL: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("[warehouse-service] cannot reach Postgres: %v", err)
	}
	db = pool
	log.Printf("[warehouse-service] connected to Postgres (bonded_warehouses/bonded_inventory/ex_bond_permits)")
}

// parseID accepts numeric serial ids returned by this service (as strings).
func parseID(s string) (int64, error) {
	return strconv.ParseInt(strings.TrimSpace(s), 10, 64)
}

// pgxQuerier is the subset of pgx shared by the pool and transactions.
type pgxQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// resolveWarehouseID accepts either a numeric serial id or a licence number.
func resolveWarehouseID(ctx context.Context, q pgxQuerier, ref string) (int64, error) {
	if id, err := parseID(ref); err == nil {
		return id, nil
	}
	var id int64
	err := q.QueryRow(ctx, `SELECT id FROM bonded_warehouses WHERE license_no = $1`, ref).Scan(&id)
	return id, err
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func genLicence() string {
	year := time.Now().Year()
	return fmt.Sprintf("BWL-%d-%s", year, strings.ToUpper(uuid.New().String()[:6]))
}

func genBondNumber() string {
	year := time.Now().Year()
	return fmt.Sprintf("DSB-%d-%s", year, strings.ToUpper(uuid.New().String()[:8]))
}

func genPermit() string {
	return "CLR-" + strings.ToUpper(uuid.New().String()[:10])
}

// scanWarehouse maps a bonded_warehouses row to the API shape (serial id as string).
func scanWarehouse(row pgx.Row) (*Warehouse, error) {
	var (
		w         Warehouse
		id        int64
		capCbm    int
		usedCbm   int
		opID      *int
		portCode  *string
		createdAt time.Time
	)
	err := row.Scan(&id, &w.LicenceNumber, &w.Name, &opID, &w.Address, &portCode,
		&capCbm, &usedCbm, &w.Status, &createdAt)
	if err != nil {
		return nil, err
	}
	w.ID = strconv.FormatInt(id, 10)
	if opID != nil {
		w.OperatorID = *opID
	}
	if portCode != nil {
		w.PortCode = *portCode
	}
	w.MaxCapacityM3 = float64(capCbm)
	w.UsedCapacityM3 = float64(usedCbm)
	w.RegisteredAt = createdAt
	return &w, nil
}

const warehouseCols = `id, license_no, name, operator_id, address, port_code, capacity_cbm, used_cbm, status, created_at`

// scanInventory maps a bonded_inventory row to the API shape. The 1:1
// duty-suspension bond issued at deposit time shares the inventory row's
// serial id (the row carries the bond's duty_liability_usd and its discharge
// is recorded as status ex_bonded + an ex_bond_permits row).
func scanInventory(row pgx.Row) (*InventoryItem, error) {
	var (
		it       InventoryItem
		id       int64
		whID     int64
		declID   *int
		qtyKg    int
		volCbm   int
		invUSD   int64
		dutyUSD  int64
		dbStatus string
	)
	err := row.Scan(&id, &whID, &declID, &it.UCR, &it.HSCode, &it.Description,
		&qtyKg, &volCbm, &invUSD, &dutyUSD, &it.DepositedAt, &dbStatus, &it.ReleasedAt)
	if err != nil {
		return nil, err
	}
	it.ID = strconv.FormatInt(id, 10)
	it.WarehouseID = strconv.FormatInt(whID, 10)
	it.BondID = it.ID
	if declID != nil {
		it.DeclarationID = *declID
	}
	it.QuantityKg = float64(qtyKg)
	it.VolumeM3 = float64(volCbm)
	it.DeclaredValue = float64(invUSD)
	it.DutyOwed = float64(dutyUSD)
	switch dbStatus {
	case "in_bond":
		it.Status = InvDeposited
	case "ex_bonded":
		it.Status = InvReleased
	case "destroyed":
		it.Status = InvDestroyed
	case "re_exported":
		it.Status = InvTransferred
	default:
		it.Status = InventoryStatus(dbStatus)
	}
	it.MaxStorageDays = 365
	return &it, nil
}

const inventoryCols = `id, warehouse_id, declaration_id, ucr, hs_code, description,
	quantity_kg, volume_cbm, invoice_value_usd, duty_liability_usd,
	deposited_at, status, released_at`

// bondForItem synthesises the duty-suspension bond view for an inventory row.
func bondForItem(it *InventoryItem, ucr string, releasedAt *time.Time, releaseReason string) *DutySuspensionBond {
	status := BondActive
	if it.Status != InvDeposited {
		status = BondReleased
	}
	return &DutySuspensionBond{
		ID:            it.BondID,
		BondNumber:    genBondNumber(),
		WarehouseID:   it.WarehouseID,
		UCR:           ucr,
		DeclarationID: it.DeclarationID,
		DutyAmount:    it.DutyOwed,
		BondValue:     it.DutyOwed,
		Currency:      "USD",
		Status:        status,
		IssuedAt:      it.DepositedAt,
		ExpiresAt:     it.DepositedAt.AddDate(1, 0, 0),
		ReleasedAt:    releasedAt,
		ReleaseReason: releaseReason,
	}
}

// ─── HTTP handlers ────────────────────────────────────────────────────────────

func handleHealth(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	var one int
	if err := db.QueryRow(ctx, `SELECT 1`).Scan(&one); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"status":  "error",
			"service": "warehouse-service",
			"db":      "unreachable",
			"error":   err.Error(),
			"ts":      time.Now().UTC(),
		})
		return
	}
	var wCount, iCount, pCount int
	_ = db.QueryRow(ctx, `SELECT COUNT(*) FROM bonded_warehouses`).Scan(&wCount)
	_ = db.QueryRow(ctx, `SELECT COUNT(*) FROM bonded_inventory`).Scan(&iCount)
	_ = db.QueryRow(ctx, `SELECT COUNT(*) FROM ex_bond_permits`).Scan(&pCount)
	c.JSON(http.StatusOK, gin.H{
		"status":     "ok",
		"service":    "warehouse-service",
		"db":         "ok",
		"warehouses": wCount,
		"bonds":      iCount, // duty-suspension bonds are 1:1 with in-bond inventory rows
		"inventory":  iCount,
		"permits":    pCount,
		"ts":         time.Now().UTC(),
	})
}

func handleRegisterWarehouse(c *gin.Context) {
	var req struct {
		OperatorID    int     `json:"operator_id" binding:"required"`
		OperatorName  string  `json:"operator_name"`
		Name          string  `json:"name" binding:"required"`
		PortCode      string  `json:"port_code" binding:"required"`
		Address       string  `json:"address"`
		Country       string  `json:"country"`
		LicenceNumber string  `json:"licence_number"`
		MaxCapacityM3 float64 `json:"max_capacity_m3"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.MaxCapacityM3 <= 0 {
		req.MaxCapacityM3 = 5000 // default 5000 m³
	}
	if req.OperatorName == "" {
		req.OperatorName = fmt.Sprintf("operator-%d", req.OperatorID)
	}
	if req.Country == "" {
		req.Country = "NGA"
	}
	licence := req.LicenceNumber
	if licence == "" {
		licence = genLicence()
	}

	ctx := c.Request.Context()
	// Idempotent on license_no (natural dedupe key): a repeated register with
	// the same licence returns the existing warehouse row.
	w, err := scanWarehouse(db.QueryRow(ctx,
		`INSERT INTO bonded_warehouses
			(license_no, name, operator_id, operator_name, country, address, port_code, capacity_cbm, used_cbm, status, approved_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,'active', now())
		 ON CONFLICT (license_no) DO NOTHING
		 RETURNING `+warehouseCols,
		licence, req.Name, req.OperatorID, req.OperatorName, strings.ToUpper(req.Country),
		req.Address, strings.ToUpper(req.PortCode), int(math.Round(req.MaxCapacityM3)),
	))
	if errors.Is(err, pgx.ErrNoRows) {
		w, err = scanWarehouse(db.QueryRow(ctx,
			`SELECT `+warehouseCols+` FROM bonded_warehouses WHERE license_no = $1`, licence))
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to register warehouse: " + err.Error()})
		return
	}
	c.JSON(http.StatusCreated, w)
}

func handleListWarehouses(c *gin.Context) {
	ctx := c.Request.Context()
	rows, err := db.Query(ctx, `SELECT `+warehouseCols+` FROM bonded_warehouses ORDER BY id`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	list := make([]*Warehouse, 0)
	for rows.Next() {
		w, err := scanWarehouse(rows)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		list = append(list, w)
	}
	c.JSON(http.StatusOK, gin.H{"warehouses": list, "total": len(list)})
}

func handleDepositGoods(c *gin.Context) {
	var req struct {
		WarehouseID   string  `json:"warehouse_id" binding:"required"`
		UCR           string  `json:"ucr" binding:"required"`
		DeclarationID int     `json:"declaration_id" binding:"required"`
		TraderID      int     `json:"trader_id" binding:"required"`
		HSCode        string  `json:"hs_code"`
		Description   string  `json:"description"`
		QuantityKg    float64 `json:"quantity_kg"`
		VolumeM3      float64 `json:"volume_m3"`
		DeclaredValue float64 `json:"declared_value"`
		DutyRate      float64 `json:"duty_rate"`  // e.g. 0.20
		BondValue     float64 `json:"bond_value"` // security posted
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.HSCode == "" {
		req.HSCode = "000000"
	}

	ctx := c.Request.Context()
	whID, err := resolveWarehouseID(ctx, db, req.WarehouseID)
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"error": "warehouse not found"})
		return
	} else if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid warehouse_id"})
		return
	}

	w, err := scanWarehouse(db.QueryRow(ctx,
		`SELECT `+warehouseCols+` FROM bonded_warehouses WHERE id = $1`, whID))
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"error": "warehouse not found"})
		return
	} else if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if w.Status != StatusActive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "warehouse is not active"})
		return
	}
	if w.UsedCapacityM3+req.VolumeM3 > w.MaxCapacityM3 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "insufficient warehouse capacity"})
		return
	}

	dutyOwed := math.Round(req.DeclaredValue*req.DutyRate*100) / 100
	if req.BondValue < dutyOwed {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":      "bond value must be >= duty owed",
			"duty_owed":  dutyOwed,
			"bond_value": req.BondValue,
		})
		return
	}

	// Atomic: insert the bonded_inventory row AND increment used_cbm in one tx.
	tx, err := db.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var item *InventoryItem
	row := tx.QueryRow(ctx,
		`INSERT INTO bonded_inventory
			(warehouse_id, declaration_id, ucr, hs_code, description,
			 quantity_kg, volume_cbm, invoice_value_usd, duty_liability_usd,
			 deposited_at, expiry_date, status)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), now() + interval '365 days', 'in_bond')
		 RETURNING `+inventoryCols,
		whID, req.DeclarationID, req.UCR, req.HSCode, req.Description,
		int(math.Round(req.QuantityKg)), int(math.Round(req.VolumeM3)),
		int64(math.Round(req.DeclaredValue)), int64(math.Round(dutyOwed)),
	)
	item, err = scanInventory(row)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "deposit failed: " + err.Error()})
		return
	}
	if _, err := tx.Exec(ctx,
		`UPDATE bonded_warehouses SET used_cbm = used_cbm + $1, updated_at = now() WHERE id = $2`,
		int(math.Round(req.VolumeM3)), whID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "capacity update failed: " + err.Error()})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "commit failed: " + err.Error()})
		return
	}

	bond := bondForItem(item, req.UCR, nil, "")
	bond.TraderID = req.TraderID
	bond.BondValue = req.BondValue

	c.JSON(http.StatusCreated, gin.H{
		"inventory_item": item,
		"bond":           bond,
		"message":        "Goods deposited under duty suspension. Bond issued.",
	})
}

func handleListInventory(c *gin.Context) {
	warehouseID := c.Query("warehouse_id")
	ctx := c.Request.Context()

	query := `SELECT ` + inventoryCols + ` FROM bonded_inventory`
	args := []any{}
	if warehouseID != "" {
		whID, err := resolveWarehouseID(ctx, db, warehouseID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "warehouse not found"})
			return
		}
		query += ` WHERE warehouse_id = $1`
		args = append(args, whID)
	}
	query += ` ORDER BY id`

	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	list := make([]*InventoryItem, 0)
	for rows.Next() {
		item, err := scanInventory(rows)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		list = append(list, item)
	}
	c.JSON(http.StatusOK, gin.H{"inventory": list, "total": len(list)})
}

func handleReleaseGoods(c *gin.Context) {
	var req ReleaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx := c.Request.Context()
	invID, err := parseID(req.InventoryID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "inventory item not found"})
		return
	}
	// Bond id is the inventory row's serial id (1:1 duty-suspension bond);
	// accept both but require them to refer to the same row.
	if req.BondID != "" && req.BondID != req.InventoryID {
		c.JSON(http.StatusNotFound, gin.H{"error": "bond not found"})
		return
	}

	item, err := scanInventory(db.QueryRow(ctx,
		`SELECT `+inventoryCols+` FROM bonded_inventory WHERE id = $1`, invID))
	if errors.Is(err, pgx.ErrNoRows) {
		c.JSON(http.StatusNotFound, gin.H{"error": "inventory item not found"})
		return
	} else if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if item.Status != InvDeposited {
		c.JSON(http.StatusBadRequest, gin.H{"error": "goods already released or transferred"})
		return
	}

	// Verify duty payment covers the owed amount
	if req.DutyPaid < item.DutyOwed {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":     "duty payment insufficient",
			"duty_owed": item.DutyOwed,
			"duty_paid": req.DutyPaid,
			"shortfall": math.Round((item.DutyOwed-req.DutyPaid)*100) / 100,
		})
		return
	}

	permit := genPermit()
	releaseReason := fmt.Sprintf("Duty paid (ref: %s) for %s release", req.PaymentRef, req.DestinationType)

	// Atomic: discharge the bond (status ex_bonded + released_at), decrement
	// used_cbm, and record the ex-bond permit — one transaction.
	tx, err := db.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var releasedAt time.Time
	if err := tx.QueryRow(ctx,
		`UPDATE bonded_inventory SET status = 'ex_bonded', released_at = now()
		 WHERE id = $1 AND status = 'in_bond' RETURNING released_at`, invID,
	).Scan(&releasedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "goods already released or transferred"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if _, err := tx.Exec(ctx,
		`UPDATE bonded_warehouses SET used_cbm = GREATEST(used_cbm - $1, 0), updated_at = now() WHERE id = $2`,
		int(math.Round(item.VolumeM3)), item.WarehouseID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "capacity update failed: " + err.Error()})
		return
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO ex_bond_permits
			(permit_no, inventory_id, warehouse_id, requested_by_id,
			 quantity_kg, duty_paid_usd, payment_ref, status, issued_at, used_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,'used', now(), now())`,
		permit, invID, item.WarehouseID, nil,
		int(math.Round(item.QuantityKg)), int64(math.Round(req.DutyPaid)), req.PaymentRef,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "permit insert failed: " + err.Error()})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "commit failed: " + err.Error()})
		return
	}

	item.Status = InvReleased
	item.ReleasedAt = &releasedAt
	bond := bondForItem(item, item.UCR, &releasedAt, releaseReason)

	result := ReleaseResult{
		Success:         true,
		InventoryID:     item.ID,
		BondID:          bond.ID,
		DutySettled:     req.DutyPaid,
		BondReleased:    true,
		ReleasedAt:      releasedAt,
		ClearancePermit: permit,
		Message: fmt.Sprintf(
			"Goods released for %s. Duty of USD %.2f settled (ref: %s). Bond %s discharged.",
			req.DestinationType, req.DutyPaid, req.PaymentRef, bond.BondNumber,
		),
	}
	c.JSON(http.StatusOK, result)
}

func handleWarehouseStats(c *gin.Context) {
	ctx := c.Request.Context()
	var (
		totalWarehouses    int
		totalCapacity      int64
		usedCapacity       int64
		activeBonds        int
		totalDutySuspended int64
	)
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(capacity_cbm),0), COALESCE(SUM(used_cbm),0) FROM bonded_warehouses`,
	).Scan(&totalWarehouses, &totalCapacity, &usedCapacity); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*), COALESCE(SUM(duty_liability_usd),0) FROM bonded_inventory WHERE status = 'in_bond'`,
	).Scan(&activeBonds, &totalDutySuspended); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	utilPct := 0.0
	if totalCapacity > 0 {
		utilPct = math.Round(float64(usedCapacity)/float64(totalCapacity)*10000) / 100
	}
	c.JSON(http.StatusOK, gin.H{
		"total_warehouses":     totalWarehouses,
		"total_capacity_m3":    float64(totalCapacity),
		"used_capacity_m3":     float64(usedCapacity),
		"utilisation_pct":      utilPct,
		"active_bonds":         activeBonds,
		"total_duty_suspended": float64(totalDutySuspended),
		"currency":             "USD",
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	mustConnectDB()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8095"
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	// Phase 26 F1: fail-closed Keycloak JWT authz on all non-probe routes.
	r.Use(authGuard())

	r.GET("/health", handleHealth)
	r.GET("/api/warehouse/stats", handleWarehouseStats)
	r.POST("/api/warehouse/register", handleRegisterWarehouse)
	r.GET("/api/warehouse/list", handleListWarehouses)
	r.POST("/api/warehouse/deposit", handleDepositGoods)
	r.GET("/api/warehouse/inventory", handleListInventory)
	r.POST("/api/warehouse/release", handleReleaseGoods)

	log.Printf("[warehouse-service] listening on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
