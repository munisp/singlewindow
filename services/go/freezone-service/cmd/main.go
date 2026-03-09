// freezone-service — Free Zone Operations Management
// Handles zone registration, operator licensing, goods admission/transfer/exit
// with duty-suspension tracking and inventory snapshots.
package main

import (
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
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

// ─── In-Memory Stores ─────────────────────────────────────────────────────────

var (
	zoneStore   = make(map[string]*FreeZone)
	zoneStoreMu sync.RWMutex
	goodsStore  = make(map[string]*GoodsRecord)
	goodsStoreMu sync.RWMutex
)

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

	zoneStoreMu.Lock()
	zoneStore[zone.ID] = zone
	zoneStoreMu.Unlock()

	c.JSON(http.StatusCreated, zone)
}

func listZones(c *gin.Context) {
	zoneStoreMu.RLock()
	defer zoneStoreMu.RUnlock()

	result := []*FreeZone{}
	for _, z := range zoneStore {
		result = append(result, z)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	c.JSON(http.StatusOK, gin.H{"zones": result, "total": len(result)})
}

func admitGoods(c *gin.Context) {
	zoneID := c.Param("zoneId")

	zoneStoreMu.RLock()
	zone, exists := zoneStore[zoneID]
	zoneStoreMu.RUnlock()

	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "zone not found"})
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

	// Capacity check
	zoneStoreMu.Lock()
	if zone.UsedM3+req.VolumeM3 > zone.CapacityM3 {
		zoneStoreMu.Unlock()
		c.JSON(http.StatusBadRequest, gin.H{
			"error":     "insufficient capacity",
			"available": zone.CapacityM3 - zone.UsedM3,
			"requested": req.VolumeM3,
		})
		return
	}
	zone.UsedM3 += req.VolumeM3
	zoneStoreMu.Unlock()

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

	goodsStoreMu.Lock()
	goodsStore[goods.ID] = goods
	goodsStoreMu.Unlock()

	c.JSON(http.StatusCreated, goods)
}

func transferGoods(c *gin.Context) {
	goodsID := c.Param("goodsId")

	goodsStoreMu.Lock()
	goods, exists := goodsStore[goodsID]
	if !exists {
		goodsStoreMu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "goods not found"})
		return
	}
	if goods.Status == GoodsExited || goods.Status == GoodsDestroyed {
		goodsStoreMu.Unlock()
		c.JSON(http.StatusBadRequest, gin.H{"error": "goods have already exited the free zone"})
		return
	}

	var req struct {
		ToZoneID   string `json:"toZoneId" binding:"required"`
		Reason     string `json:"reason" binding:"required"`
		OfficerRef string `json:"officerRef"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		goodsStoreMu.Unlock()
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate destination zone
	zoneStoreMu.RLock()
	destZone, destExists := zoneStore[req.ToZoneID]
	zoneStoreMu.RUnlock()

	if !destExists || destZone.Status != ZoneActive {
		goodsStoreMu.Unlock()
		c.JSON(http.StatusBadRequest, gin.H{"error": "destination zone not found or inactive"})
		return
	}

	// Update capacity
	zoneStoreMu.Lock()
	if srcZone, ok := zoneStore[goods.CurrentZoneID]; ok {
		srcZone.UsedM3 -= goods.VolumeM3
	}
	destZone.UsedM3 += goods.VolumeM3
	zoneStoreMu.Unlock()

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
	goodsStoreMu.Unlock()

	c.JSON(http.StatusOK, goods)
}

func exitGoods(c *gin.Context) {
	goodsID := c.Param("goodsId")

	goodsStoreMu.Lock()
	goods, exists := goodsStore[goodsID]
	if !exists {
		goodsStoreMu.Unlock()
		c.JSON(http.StatusNotFound, gin.H{"error": "goods not found"})
		return
	}
	if goods.Status == GoodsExited || goods.Status == GoodsDestroyed {
		goodsStoreMu.Unlock()
		c.JSON(http.StatusBadRequest, gin.H{"error": "goods have already exited"})
		return
	}

	var req struct {
		Destination ExitDestination `json:"destination" binding:"required"`
		DutyPaid    float64         `json:"dutyPaid"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		goodsStoreMu.Unlock()
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	dutyOwed := calculateDuty(goods.InvoiceValue, goods.DutyRate, req.Destination)
	if req.Destination == ExitDomestic && req.DutyPaid < dutyOwed {
		goodsStoreMu.Unlock()
		c.JSON(http.StatusBadRequest, gin.H{
			"error":    "insufficient duty payment for domestic release",
			"dutyOwed": dutyOwed,
			"dutyPaid": req.DutyPaid,
		})
		return
	}

	// Release capacity
	zoneStoreMu.Lock()
	if zone, ok := zoneStore[goods.CurrentZoneID]; ok {
		zone.UsedM3 -= goods.VolumeM3
	}
	zoneStoreMu.Unlock()

	now := time.Now()
	goods.Status = GoodsExited
	goods.ExitDestination = req.Destination
	goods.ExitDutyPaid = req.DutyPaid
	goods.DutyOwed = dutyOwed
	goods.ExitedAt = &now
	goodsStoreMu.Unlock()

	c.JSON(http.StatusOK, goods)
}

func listInventory(c *gin.Context) {
	zoneID := c.Query("zoneId")
	status := c.Query("status")

	goodsStoreMu.RLock()
	defer goodsStoreMu.RUnlock()

	result := []*GoodsRecord{}
	for _, g := range goodsStore {
		if zoneID != "" && g.CurrentZoneID != zoneID {
			continue
		}
		if status != "" && string(g.Status) != status {
			continue
		}
		result = append(result, g)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].AdmittedAt.After(result[j].AdmittedAt)
	})
	c.JSON(http.StatusOK, gin.H{"inventory": result, "total": len(result)})
}

func getZoneStats(c *gin.Context) {
	zoneStoreMu.RLock()
	goodsStoreMu.RLock()
	defer zoneStoreMu.RUnlock()
	defer goodsStoreMu.RUnlock()

	totalZones := len(zoneStore)
	activeZones := 0
	totalCapacity := 0.0
	totalUsed := 0.0

	for _, z := range zoneStore {
		if z.Status == ZoneActive {
			activeZones++
		}
		totalCapacity += z.CapacityM3
		totalUsed += z.UsedM3
	}

	admitted := 0
	exited := 0
	totalValue := 0.0
	for _, g := range goodsStore {
		if g.Status == GoodsAdmitted || g.Status == GoodsTransferred {
			admitted++
			totalValue += g.InvoiceValue
		} else if g.Status == GoodsExited {
			exited++
		}
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
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"service":   "freezone-service",
		"version":   "1.0.0",
		"zones":     len(zoneStore),
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8098"
	}

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
