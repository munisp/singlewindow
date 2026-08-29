// SW-FLAG2 regression tests: port queue + cargo history come from REAL recorded
// gate events only — no random/synthetic filler.
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func resetStore() {
	gateEvents.mu.Lock()
	gateEvents.events = nil
	gateEvents.mu.Unlock()
}

func postGate(t *testing.T, path, body string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	rec := httptest.NewRecorder()
	if strings.Contains(path, "gate-in") {
		gateInHandler(rec, req)
	} else {
		gateOutHandler(rec, req)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("gate event post failed: %d %s", rec.Code, rec.Body.String())
	}
}

func TestPortQueueDerivedFromRealGateEvents(t *testing.T) {
	resetStore()
	postGate(t, "/api/v1/events/gate-in", `{"ucr":"UCR-1","portCode":"GHTMA","container":"TEMU0000001"}`)
	postGate(t, "/api/v1/events/gate-in", `{"ucr":"UCR-2","portCode":"GHTMA","container":"TEMU0000002"}`)
	postGate(t, "/api/v1/events/gate-out", `{"ucr":"UCR-1","portCode":"GHTMA","container":"TEMU0000001"}`)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/ports/GHTMA/queue", nil)
	rec := httptest.NewRecorder()
	portQueueHandler(rec, req)

	var resp struct {
		Queue []struct {
			Position  int    `json:"position"`
			UCR       string `json:"ucr"`
			Container string `json:"container"`
		} `json:"queue"`
		Total  int  `json:"total"`
		NoData bool `json:"noData"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if resp.Total != 1 || len(resp.Queue) != 1 {
		t.Fatalf("expected 1 queued container (gate-in without gate-out), got %d", resp.Total)
	}
	if resp.Queue[0].Container != "TEMU0000002" || resp.Queue[0].UCR != "UCR-2" {
		t.Fatalf("wrong queue entry: %+v", resp.Queue[0])
	}
	if resp.Queue[0].Position != 1 {
		t.Fatalf("position should derive from arrival order, got %d", resp.Queue[0].Position)
	}
	if strings.Contains(rec.Body.String(), "riskLane") {
		t.Fatal("riskLane must not be fabricated from gate events")
	}
}

func TestPortQueueEmptyIsHonestNoData(t *testing.T) {
	resetStore()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ports/NOWHERE/queue", nil)
	rec := httptest.NewRecorder()
	portQueueHandler(rec, req)
	var resp struct {
		Total  int  `json:"total"`
		NoData bool `json:"noData"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if resp.Total != 0 || !resp.NoData {
		t.Fatalf("expected explicit no-data state, got %+v", resp)
	}
}

func TestCargoHistoryServesOnlyRecordedEvents(t *testing.T) {
	resetStore()
	postGate(t, "/api/v1/events/gate-in", `{"ucr":"UCR-9","portCode":"GHTMA","container":"TEMU0000009"}`)

	rec := httptest.NewRecorder()
	cargoHandler(rec, httptest.NewRequest(http.MethodGet, "/api/v1/cargo/UCR-9", nil))
	var resp struct {
		Status string         `json:"status"`
		Events []map[string]any `json:"events"`
		NoData bool           `json:"noData"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if resp.Status != "GATE_EVENTS_RECORDED" || len(resp.Events) != 1 {
		t.Fatalf("expected the single recorded event, got %+v", resp)
	}

	// Unknown UCR → explicit UNKNOWN/no-data, never a canned 'cleared' timeline
	rec2 := httptest.NewRecorder()
	cargoHandler(rec2, httptest.NewRequest(http.MethodGet, "/api/v1/cargo/UCR-UNKNOWN", nil))
	var resp2 struct {
		Status string `json:"status"`
		NoData bool   `json:"noData"`
	}
	if err := json.Unmarshal(rec2.Body.Bytes(), &resp2); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if resp2.Status != "UNKNOWN" || !resp2.NoData {
		t.Fatalf("expected honest UNKNOWN state, got %+v", resp2)
	}
	if strings.Contains(rec2.Body.String(), "cleared") {
		t.Fatal("canned 'cleared' timeline must never be fabricated")
	}
}

func TestQueueWaitHoursFromRealTimestamps(t *testing.T) {
	resetStore()
	gateEvents.record(GateEvent{UCR: "UCR-1", PortCode: "GHTMA", Container: "C1", EventType: "gate_in", Timestamp: time.Now().UTC().Add(-5 * time.Hour)})
	queue := gateEvents.queueForPort("GHTMA")
	if len(queue) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(queue))
	}
	if wh := queue[0]["waitHours"].(int); wh < 4 || wh > 6 {
		t.Fatalf("waitHours should derive from the real gate-in timestamp, got %d", wh)
	}
}
