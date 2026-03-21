"""
Sedona Geospatial Service — pytest suite
Tests the haversine distance calculation, AIS dark vessel detection,
speed anomaly detection, and FastAPI endpoint contracts.
"""
import sys
import os
import math
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main as svc

client = TestClient(svc.app)


# ─── Haversine distance ────────────────────────────────────────────────────────

class TestHaversine:
    def test_same_point_is_zero(self):
        d = svc._haversine_km(0.0, 0.0, 0.0, 0.0)
        assert d == pytest.approx(0.0, abs=0.001)

    def test_equator_one_degree_longitude(self):
        """1° of longitude at equator ≈ 111.32 km."""
        d = svc._haversine_km(0.0, 0.0, 1.0, 0.0)
        assert d == pytest.approx(111.32, abs=0.5)

    def test_accra_to_tema(self):
        """Accra (−0.187, 5.603) to Tema (0.017, 5.670) ≈ 21 km."""
        d = svc._haversine_km(-0.187, 5.603, 0.017, 5.670)
        assert 18.0 <= d <= 25.0

    def test_symmetry(self):
        """Distance A→B == distance B→A."""
        d1 = svc._haversine_km(-0.187, 5.603, 0.017, 5.670)
        d2 = svc._haversine_km(0.017, 5.670, -0.187, 5.603)
        assert d1 == pytest.approx(d2, abs=0.001)

    def test_antipodal_points_approx_half_circumference(self):
        """Antipodal points should be ~20,015 km apart."""
        d = svc._haversine_km(0.0, 0.0, 180.0, 0.0)
        assert d == pytest.approx(20_015.0, abs=100.0)


# ─── Bounding box check ────────────────────────────────────────────────────────

class TestBoundingBox:
    def test_point_inside_bbox(self):
        # bbox: [lon_min, lat_min, lon_max, lat_max]
        bbox = [-0.5, 5.0, 0.5, 6.0]
        assert svc._in_bbox(0.0, 5.5, bbox) is True

    def test_point_outside_bbox(self):
        bbox = [-0.5, 5.0, 0.5, 6.0]
        assert svc._in_bbox(1.0, 5.5, bbox) is False

    def test_point_on_boundary(self):
        bbox = [-0.5, 5.0, 0.5, 6.0]
        assert svc._in_bbox(-0.5, 5.0, bbox) is True

    def test_point_at_corner(self):
        bbox = [-0.5, 5.0, 0.5, 6.0]
        assert svc._in_bbox(0.5, 6.0, bbox) is True


# ─── Dark vessel detection ────────────────────────────────────────────────────

class TestDarkVesselDetection:
    def _pos(self, offset_hours: float, lon: float = 0.0, lat: float = 5.0) -> dict:
        ts = (datetime.now(timezone.utc) + timedelta(hours=offset_hours)).isoformat()
        return {"timestamp": ts, "lon": lon, "lat": lat}

    def test_gap_over_2h_triggers_dark_period(self):
        positions = [
            self._pos(-10.0),  # 10h ago
            self._pos(-7.0),   # 7h ago — gap of 3h → dark period
            self._pos(-6.9),
        ]
        anomalies = svc._detect_dark_periods(positions)
        assert len(anomalies) >= 1
        assert anomalies[0]["type"] == "DARK_VESSEL"

    def test_gap_under_2h_no_dark_period(self):
        positions = [
            self._pos(-3.0),
            self._pos(-2.0),   # 1h gap — OK
            self._pos(-1.0),
        ]
        anomalies = svc._detect_dark_periods(positions)
        assert len(anomalies) == 0

    def test_single_position_no_dark_period(self):
        positions = [self._pos(-1.0)]
        anomalies = svc._detect_dark_periods(positions)
        assert len(anomalies) == 0

    def test_dark_period_records_gap_hours(self):
        positions = [
            self._pos(-5.0),
            self._pos(-1.0),   # 4h gap
        ]
        anomalies = svc._detect_dark_periods(positions)
        assert len(anomalies) >= 1
        assert anomalies[0]["gap_hours"] == pytest.approx(4.0, abs=0.1)

    def test_multiple_dark_periods_detected(self):
        positions = [
            self._pos(-20.0),
            self._pos(-15.0),  # 5h gap
            self._pos(-10.0),  # 5h gap
            self._pos(-5.0),   # 5h gap
        ]
        anomalies = svc._detect_dark_periods(positions)
        assert len(anomalies) == 3


# ─── Speed anomaly detection ──────────────────────────────────────────────────

class TestSpeedAnomalyDetection:
    def _pos_at(self, ts_iso: str, lon: float, lat: float) -> dict:
        return {"timestamp": ts_iso, "lon": lon, "lat": lat}

    def test_implausible_speed_triggers_anomaly(self):
        """Vessel teleporting 1000 km in 1 minute → impossible speed."""
        now = datetime.now(timezone.utc)
        positions = [
            self._pos_at(now.isoformat(), 0.0, 5.0),
            self._pos_at((now + timedelta(minutes=1)).isoformat(), 10.0, 5.0),
        ]
        anomalies = svc._detect_speed_anomalies(positions)
        assert len(anomalies) >= 1
        assert anomalies[0]["type"] == "SPEED_ANOMALY"

    def test_normal_speed_no_anomaly(self):
        """Vessel moving at 15 knots (≈28 km/h) over 1 hour."""
        now = datetime.now(timezone.utc)
        positions = [
            self._pos_at(now.isoformat(), 0.0, 5.0),
            self._pos_at((now + timedelta(hours=1)).isoformat(), 0.25, 5.0),  # ~28 km
        ]
        anomalies = svc._detect_speed_anomalies(positions)
        assert len(anomalies) == 0

    def test_anomaly_records_implied_speed(self):
        now = datetime.now(timezone.utc)
        positions = [
            self._pos_at(now.isoformat(), 0.0, 5.0),
            self._pos_at((now + timedelta(minutes=1)).isoformat(), 10.0, 5.0),
        ]
        anomalies = svc._detect_speed_anomalies(positions)
        if anomalies:
            assert anomalies[0]["implied_speed_knots"] > 35.0

    def test_single_position_no_anomaly(self):
        now = datetime.now(timezone.utc)
        positions = [self._pos_at(now.isoformat(), 0.0, 5.0)]
        anomalies = svc._detect_speed_anomalies(positions)
        assert len(anomalies) == 0


# ─── API endpoint contracts ────────────────────────────────────────────────────

class TestAPIEndpoints:
    def test_health_returns_ok(self):
        r = client.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"
        assert "vessels_tracked" in data

    def test_vessels_endpoint_returns_list(self):
        r = client.get("/vessels")
        assert r.status_code == 200
        data = r.json()
        assert "vessels" in data
        assert isinstance(data["vessels"], list)

    def test_anomalies_endpoint_returns_list(self):
        r = client.get("/anomalies")
        assert r.status_code == 200
        data = r.json()
        assert "anomalies" in data

    def test_geofence_alerts_endpoint(self):
        r = client.get("/geofence-alerts")
        assert r.status_code == 200
        data = r.json()
        assert "alerts" in data

    def test_ais_ingest_endpoint(self):
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "positions": [
                {
                    "mmsi": "123456789",
                    "timestamp": now,
                    "lon": -0.187,
                    "lat": 5.603,
                    "speed_knots": 12.5,
                    "heading": 180.0,
                    "nav_status": "UNDERWAY_ENGINE",
                }
            ]
        }
        r = client.post("/ais/ingest", json=payload)
        assert r.status_code == 200

    def test_vessel_route_not_found_returns_404(self):
        r = client.get("/vessels/NONEXISTENT999/route")
        assert r.status_code == 404
