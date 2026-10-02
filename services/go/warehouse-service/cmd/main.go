// warehouse-service — Bonded Warehouse Management microservice
// Implements duty-suspension bond lifecycle, inventory tracking (UCR-linked),
// and goods release with duty payment trigger per WCO guidelines.
package main

import (
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ─── Domain types ─────────────────────────────────────────────────────────────

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
	InvDeposited  InventoryStatus = "deposited"
	InvReleased   InventoryStatus = "released"
	InvTransferred InventoryStatus = "transferred"
	InvDestroyed  InventoryStatus = "destroyed"
)

type Warehouse struct {
	ID            string          `json:"id"`
	LicenceNumber string          `json:"licence_number"`
	OperatorID    int             `json:"operator_id"`
	Name          string          `json:"name"`
	PortCode      string          `json:"port_code"`
	Address       string          `json:"address"`
	MaxCapacityM3 float64         `json:"max_capacity_m3"`
	UsedCapacityM3 float64        `json:"used_capacity_m3"`
	Status        WarehouseStatus `json:"status"`
	RegisteredAt  time.Time       `json:"registered_at"`
}

type DutySuspensionBond struct {
	ID             string     `json:"id"`
	BondNumber     string     `json:"bond_number"`
	WarehouseID    string     `json:"warehouse_id"`
	UCR            string     `json:"ucr"`
	DeclarationID  int        `json:"declaration_id"`
	TraderID       int        `json:"trader_id"`
	DutyAmount     float64    `json:"duty_amount"`      // duty suspended (not yet paid)
	BondValue      float64    `json:"bond_value"`       // security posted (≥ duty amount)
	Currency       string     `json:"currency"`
	Status         BondStatus `json:"status"`
	IssuedAt       time.Time  `json:"issued_at"`
	ExpiresAt      time.Time  `json:"expires_at"`
	ReleasedAt     *time.Time `json:"released_at,omitempty"`
	ReleaseReason  string     `json:"release_reason,omitempty"`
}

type InventoryItem struct {
	ID            string          `json:"id"`
	WarehouseID   string          `json:"warehouse_id"`
	BondID        string          `json:"bond_id"`
	UCR           string          `json:"ucr"`
	DeclarationID int             `json:"declaration_id"`
	HSCode        string          `json:"hs_code"`
	Description   string          `json:"description"`
	QuantityKg    float64         `json:"quantity_kg"`
	VolumeM3      float64         `json:"volume_m3"`
	DeclaredValue float64         `json:"declared_value"`
	DutyOwed      float64         `json:"duty_owed"`
	Status        InventoryStatus `json:"status"`
	DepositedAt   time.Time       `json:"deposited_at"`
	ReleasedAt    *time.Time      `json:"released_at,omitempty"`
	MaxStorageDays int            `json:"max_storage_days"` // typically 365 days
}

type ReleaseRequest struct {
	InventoryID   string  `json:"inventory_id"`
	BondID        string  `json:"bond_id"`
	DutyPaid      float64 `json:"duty_paid"`
	PaymentRef    string  `json:"payment_ref"`
	DestinationType string `json:"destination_type"` // domestic | re_export | destruction
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

// ─── In-memory store (production: replace with DB calls) ─────────────────────

type Store struct {
	mu         sync.RWMutex
	warehouses map[string]*Warehouse
	bonds      map[string]*DutySuspensionBond
	inventory  map[string]*InventoryItem
}

var store = &Store{
	warehouses: make(map[string]*Warehouse),
	bonds:      make(map[string]*DutySuspensionBond),
	inventory:  make(map[string]*InventoryItem),
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

// ─── HTTP handlers ────────────────────────────────────────────────────────────

func handleHealth(c *gin.Context) {
	store.mu.RLock()
	wCount := len(store.warehouses)
	bCount := len(store.bonds)
	iCount := len(store.inventory)
	store.mu.RUnlock()
	c.JSON(http.StatusOK, gin.H{
		"status":      "ok",
		"service":     "warehouse-service",
		"warehouses":  wCount,
		"bonds":       bCount,
		"inventory":   iCount,
		"ts":          time.Now().UTC(),
	})
}

func handleRegisterWarehouse(c *gin.Context) {
	var req struct {
		OperatorID    int     `json:"operator_id" binding:"required"`
		Name          string  `json:"name" binding:"required"`
		PortCode      string  `json:"port_code" binding:"required"`
		Address       string  `json:"address"`
		MaxCapacityM3 float64 `json:"max_capacity_m3"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.MaxCapacityM3 <= 0 {
		req.MaxCapacityM3 = 5000 // default 5000 m³
	}
	w := &Warehouse{
		ID:             uuid.New().String(),
		LicenceNumber:  genLicence(),
		OperatorID:     req.OperatorID,
		Name:           req.Name,
		PortCode:       strings.ToUpper(req.PortCode),
		Address:        req.Address,
		MaxCapacityM3:  req.MaxCapacityM3,
		UsedCapacityM3: 0,
		Status:         StatusActive,
		RegisteredAt:   time.Now().UTC(),
	}
	store.mu.Lock()
	store.warehouses[w.ID] = w
	store.mu.Unlock()
	c.JSON(http.StatusCreated, w)
}

func handleListWarehouses(c *gin.Context) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	list := make([]*Warehouse, 0, len(store.warehouses))
	for _, w := range store.warehouses {
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
		DutyRate      float64 `json:"duty_rate"` // e.g. 0.20
		BondValue     float64 `json:"bond_value"` // security posted
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	w, ok := store.warehouses[req.WarehouseID]
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "warehouse not found"})
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

	now := time.Now().UTC()
	bondID := uuid.New().String()
	bond := &DutySuspensionBond{
		ID:            bondID,
		BondNumber:    genBondNumber(),
		WarehouseID:   req.WarehouseID,
		UCR:           req.UCR,
		DeclarationID: req.DeclarationID,
		TraderID:      req.TraderID,
		DutyAmount:    dutyOwed,
		BondValue:     req.BondValue,
		Currency:      "USD",
		Status:        BondActive,
		IssuedAt:      now,
		ExpiresAt:     now.AddDate(1, 0, 0), // 1-year bond
	}
	store.bonds[bondID] = bond

	itemID := uuid.New().String()
	item := &InventoryItem{
		ID:             itemID,
		WarehouseID:    req.WarehouseID,
		BondID:         bondID,
		UCR:            req.UCR,
		DeclarationID:  req.DeclarationID,
		HSCode:         req.HSCode,
		Description:    req.Description,
		QuantityKg:     req.QuantityKg,
		VolumeM3:       req.VolumeM3,
		DeclaredValue:  req.DeclaredValue,
		DutyOwed:       dutyOwed,
		Status:         InvDeposited,
		DepositedAt:    now,
		MaxStorageDays: 365,
	}
	store.inventory[itemID] = item
	w.UsedCapacityM3 += req.VolumeM3

	c.JSON(http.StatusCreated, gin.H{
		"inventory_item": item,
		"bond":           bond,
		"message":        "Goods deposited under duty suspension. Bond issued.",
	})
}

func handleListInventory(c *gin.Context) {
	warehouseID := c.Query("warehouse_id")
	store.mu.RLock()
	defer store.mu.RUnlock()
	list := make([]*InventoryItem, 0)
	for _, item := range store.inventory {
		if warehouseID == "" || item.WarehouseID == warehouseID {
			list = append(list, item)
		}
	}
	c.JSON(http.StatusOK, gin.H{"inventory": list, "total": len(list)})
}

func handleReleaseGoods(c *gin.Context) {
	var req ReleaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	store.mu.Lock()
	defer store.mu.Unlock()

	item, ok := store.inventory[req.InventoryID]
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "inventory item not found"})
		return
	}
	if item.Status != InvDeposited {
		c.JSON(http.StatusBadRequest, gin.H{"error": "goods already released or transferred"})
		return
	}
	bond, ok := store.bonds[req.BondID]
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "bond not found"})
		return
	}
	if bond.Status != BondActive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bond is not active"})
		return
	}

	// Verify duty payment covers the owed amount
	if req.DutyPaid < item.DutyOwed {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":      "duty payment insufficient",
			"duty_owed":  item.DutyOwed,
			"duty_paid":  req.DutyPaid,
			"shortfall":  math.Round((item.DutyOwed-req.DutyPaid)*100) / 100,
		})
		return
	}

	now := time.Now().UTC()
	item.Status = InvReleased
	item.ReleasedAt = &now
	bond.Status = BondReleased
	bond.ReleasedAt = &now
	bond.ReleaseReason = fmt.Sprintf("Duty paid (ref: %s) for %s release", req.PaymentRef, req.DestinationType)

	// Free up warehouse capacity
	if w, ok := store.warehouses[item.WarehouseID]; ok {
		w.UsedCapacityM3 -= item.VolumeM3
		if w.UsedCapacityM3 < 0 {
			w.UsedCapacityM3 = 0
		}
	}

	result := ReleaseResult{
		Success:         true,
		InventoryID:     item.ID,
		BondID:          bond.ID,
		DutySettled:     req.DutyPaid,
		BondReleased:    true,
		ReleasedAt:      now,
		ClearancePermit: genPermit(),
		Message: fmt.Sprintf(
			"Goods released for %s. Duty of USD %.2f settled (ref: %s). Bond %s discharged.",
			req.DestinationType, req.DutyPaid, req.PaymentRef, bond.BondNumber,
		),
	}
	c.JSON(http.StatusOK, result)
}

func handleWarehouseStats(c *gin.Context) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	totalCapacity := 0.0
	usedCapacity := 0.0
	activeBonds := 0
	totalDutySuspended := 0.0
	for _, w := range store.warehouses {
		totalCapacity += w.MaxCapacityM3
		usedCapacity += w.UsedCapacityM3
	}
	for _, b := range store.bonds {
		if b.Status == BondActive {
			activeBonds++
			totalDutySuspended += b.DutyAmount
		}
	}
	utilPct := 0.0
	if totalCapacity > 0 {
		utilPct = math.Round(usedCapacity/totalCapacity*10000) / 100
	}
	c.JSON(http.StatusOK, gin.H{
		"total_warehouses":     len(store.warehouses),
		"total_capacity_m3":    totalCapacity,
		"used_capacity_m3":     usedCapacity,
		"utilisation_pct":      utilPct,
		"active_bonds":         activeBonds,
		"total_duty_suspended": math.Round(totalDutySuspended*100) / 100,
		"currency":             "USD",
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8095"
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

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
