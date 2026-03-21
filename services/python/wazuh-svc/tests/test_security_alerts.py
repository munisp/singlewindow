"""
Wazuh Security Service — pytest suite
Tests severity classification, MITRE ATT&CK tagging, declaration correlation,
incident management, and FastAPI endpoint contracts.
"""
import sys
import os

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main as svc

client = TestClient(svc.app)


# ─── Severity classification ──────────────────────────────────────────────────

class TestSeverityClassification:
    def test_level_1_is_low(self):
        assert svc._get_severity(1) == "low"

    def test_level_5_is_medium(self):
        # range(4,8) → medium
        assert svc._get_severity(5) == "medium"

    def test_level_6_is_medium(self):
        assert svc._get_severity(6) == "medium"

    def test_level_10_is_high(self):
        # range(8,13) → high
        assert svc._get_severity(10) == "high"

    def test_level_11_is_high(self):
        assert svc._get_severity(11) == "high"

    def test_level_13_is_critical(self):
        # range(13,16) → critical
        assert svc._get_severity(13) == "critical"

    def test_level_14_is_critical(self):
        assert svc._get_severity(14) == "critical"

    def test_level_15_is_critical(self):
        assert svc._get_severity(15) == "critical"

    def test_out_of_range_returns_low(self):
        assert svc._get_severity(99) == "low"

    def test_zero_returns_low(self):
        assert svc._get_severity(0) == "low"


# ─── MITRE ATT&CK tagging ─────────────────────────────────────────────────────

class TestMITRETagging:
    def test_known_rule_id_returns_mitre_info(self):
        """At least one rule ID in the map should return a MITRE entry."""
        if not svc.RULE_MITRE_MAP:
            pytest.skip("RULE_MITRE_MAP is empty")
        rule_id = next(iter(svc.RULE_MITRE_MAP))
        result = svc._tag_mitre(rule_id)
        assert result is not None
        assert "tactic" in result
        assert "technique" in result

    def test_unknown_rule_id_returns_none(self):
        result = svc._tag_mitre("NONEXISTENT_RULE_99999")
        assert result is None

    def test_mitre_entry_has_name(self):
        if not svc.RULE_MITRE_MAP:
            pytest.skip("RULE_MITRE_MAP is empty")
        rule_id = next(iter(svc.RULE_MITRE_MAP))
        result = svc._tag_mitre(rule_id)
        if result:
            assert "name" in result


# ─── Declaration correlation ──────────────────────────────────────────────────

class TestDeclarationCorrelation:
    def test_decl_id_in_srcip_field_extracted(self):
        alert = {"data": {"srcip": "DECL-12345"}}
        result = svc._correlate_declaration(alert)
        assert result == "DECL-12345"

    def test_tg_prefix_in_url_field_extracted(self):
        alert = {"data": {"url": "TG-99999"}}
        result = svc._correlate_declaration(alert)
        assert result == "TG-99999"

    def test_no_declaration_id_returns_none(self):
        alert = {"data": {"srcip": "192.168.1.1", "dstip": "10.0.0.1"}}
        result = svc._correlate_declaration(alert)
        assert result is None

    def test_empty_data_returns_none(self):
        alert = {"data": {}}
        result = svc._correlate_declaration(alert)
        assert result is None

    def test_missing_data_key_returns_none(self):
        alert = {}
        result = svc._correlate_declaration(alert)
        assert result is None


# ─── API endpoint contracts ────────────────────────────────────────────────────

class TestAPIEndpoints:
    def test_health_returns_ok(self):
        r = client.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"

    def test_alerts_endpoint_returns_list(self):
        r = client.get("/alerts")
        assert r.status_code == 200
        data = r.json()
        assert "alerts" in data
        assert isinstance(data["alerts"], list)

    def test_alerts_pagination(self):
        r = client.get("/alerts?limit=5&offset=0")
        assert r.status_code == 200
        data = r.json()
        assert len(data["alerts"]) <= 5

    def test_alerts_filter_by_severity(self):
        r = client.get("/alerts?severity=critical")
        assert r.status_code == 200
        data = r.json()
        for alert in data["alerts"]:
            assert alert["severity"] == "critical"

    def test_ingest_alert_creates_entry(self):
        payload = {
            "rule_id": "5501",
            "level": 12,
            "description": "Test brute force alert",
            "agent_id": "001",
            "agent_name": "tg-node-01",
        }
        r = client.post("/alerts/ingest", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert "alert_id" in data or "id" in data

    def test_ingest_alert_with_declaration_id(self):
        payload = {
            "rule_id": "5501",
            "level": 8,
            "description": "Suspicious access to declaration",
            "agent_id": "002",
            "agent_name": "tg-node-02",
            "declaration_id": "DECL-99999",
        }
        r = client.post("/alerts/ingest", json=payload)
        assert r.status_code == 200

    def test_incidents_endpoint_returns_list(self):
        r = client.get("/incidents")
        assert r.status_code == 200
        data = r.json()
        assert "incidents" in data
        assert isinstance(data["incidents"], list)

    def test_incidents_filter_by_status(self):
        r = client.get("/incidents?status=open")
        assert r.status_code == 200
        data = r.json()
        for inc in data["incidents"]:
            assert inc["status"] == "open"

    def test_create_incident(self):
        payload = {
            "title": "Test Security Incident",
            "severity": "high",
            "alert_ids": [],
            "description": "Created by pytest",
            "assigned_to": "analyst-01",
        }
        r = client.post("/incidents", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert "id" in data
        assert data["title"] == "Test Security Incident"

    def test_get_incident_by_id(self):
        # First create one
        payload = {
            "title": "Lookup Test Incident",
            "severity": "medium",
            "alert_ids": [],
            "description": "For lookup test",
            "assigned_to": "analyst-02",
        }
        create_r = client.post("/incidents", json=payload)
        assert create_r.status_code == 200
        inc_id = create_r.json()["id"]

        r = client.get(f"/incidents/{inc_id}")
        assert r.status_code == 200
        assert r.json()["id"] == inc_id

    def test_get_nonexistent_incident_returns_404(self):
        r = client.get("/incidents/nonexistent-id-xyz")
        assert r.status_code == 404

    def test_acknowledge_alert(self):
        # Get first alert ID from the list
        r = client.get("/alerts?limit=1")
        alerts = r.json()["alerts"]
        if not alerts:
            pytest.skip("No alerts to acknowledge")
        alert_id = alerts[0]["id"]
        ack_r = client.post(f"/alerts/{alert_id}/acknowledge")
        assert ack_r.status_code == 200
