"""
OpenCTI Threat Intelligence Service — pytest suite
Tests fuzzy entity matching, country risk scoring, sanctions checking,
threat actor lookup, declaration enrichment, and FastAPI endpoint contracts.
"""
import sys
import os

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main as svc

client = TestClient(svc.app)


# ─── Fuzzy matching ────────────────────────────────────────────────────────────

class TestFuzzyMatch:
    def test_exact_match_returns_true(self):
        assert svc.fuzzy_match("ACME Corp", "ACME Corp") is True

    def test_case_insensitive_match(self):
        assert svc.fuzzy_match("acme corp", "ACME Corp") is True

    def test_substring_match(self):
        # fuzzy_match uses substring containment, not edit distance
        assert svc.fuzzy_match("Phantom", "Phantom Silk Road") is True

    def test_completely_different_names_no_match(self):
        assert svc.fuzzy_match("XYZ Holdings", "ACME Corp") is False

    def test_empty_string_matches_everything(self):
        # "" is a substring of any string
        assert svc.fuzzy_match("", "ACME Corp") is True

    def test_partial_name_short_target_matches(self):
        assert svc.fuzzy_match("AB", "AB") is True


# ─── Country risk scoring ──────────────────────────────────────────────────────

class TestCountryRisk:
    def test_known_critical_country_kp(self):
        result = svc.get_country_risk("KP")
        assert result["score"] >= 80
        assert result["level"] == "critical"

    def test_known_critical_country_ir(self):
        result = svc.get_country_risk("IR")
        assert result["score"] >= 80

    def test_low_risk_country_sg(self):
        result = svc.get_country_risk("SG")
        assert result["score"] < 40

    def test_unknown_country_returns_default(self):
        result = svc.get_country_risk("ZZ")
        assert "score" in result
        assert isinstance(result["score"], (int, float))

    def test_result_has_required_fields(self):
        result = svc.get_country_risk("GH")
        assert "score" in result
        assert "level" in result
        assert "factors" in result
        assert "sources" in result

    def test_north_korea_is_critical(self):
        result = svc.get_country_risk("KP")
        assert result["level"] == "critical"

    def test_ghana_is_low_risk(self):
        result = svc.get_country_risk("GH")
        assert result["level"] == "low"


# ─── Sanctions checking ───────────────────────────────────────────────────────

class TestSanctionsCheck:
    def test_clean_entity_returns_empty_list(self):
        results = svc.check_sanctions("Totally Legitimate Trader Ltd")
        assert isinstance(results, list)
        assert len(results) == 0

    def test_result_is_list(self):
        results = svc.check_sanctions("Some Company Name")
        assert isinstance(results, list)

    def test_sanctioned_entity_detected(self):
        """Use first entry in SANCTIONED_ENTITIES to verify detection."""
        first_entity = svc.SANCTIONED_ENTITIES[0]["name"]
        results = svc.check_sanctions(first_entity)
        assert len(results) >= 1

    def test_match_has_required_fields(self):
        first_entity = svc.SANCTIONED_ENTITIES[0]["name"]
        results = svc.check_sanctions(first_entity)
        if results:
            match = results[0]
            assert "entity_id" in match
            assert "matched_name" in match
            assert "sanctions_lists" in match
            assert "match_confidence" in match

    def test_case_insensitive_detection(self):
        first_entity = svc.SANCTIONED_ENTITIES[0]["name"].lower()
        results = svc.check_sanctions(first_entity)
        assert len(results) >= 1


# ─── Threat actor lookup ──────────────────────────────────────────────────────

class TestThreatActors:
    def test_find_threat_actors_returns_list(self):
        results = svc.find_threat_actors("NG", "85")
        assert isinstance(results, list)

    def test_known_country_returns_actors(self):
        # NG (Nigeria) has threat actors in the mock dataset
        results = svc.find_threat_actors("NG", "85")
        assert len(results) >= 1

    def test_low_risk_country_returns_empty_or_list(self):
        results = svc.find_threat_actors("CH", "01")
        assert isinstance(results, list)

    def test_actor_has_required_fields(self):
        results = svc.find_threat_actors("NG", "85")
        if results:
            actor = results[0]
            assert "actor_id" in actor
            assert "name" in actor
            assert "sophistication" in actor
            assert "ttps" in actor


# ─── Declaration enrichment ───────────────────────────────────────────────────

def _enrich_req(**overrides):
    base = {
        "declaration_id": "DECL-TEST-001",
        "trader_name": "Test Trader Ltd",
        "shipper_name": "Clean Shipper Co",
        "consignee_name": "Honest Consignee Ltd",
        "origin_country": "GH",
        "destination_country": "RW",
        "transshipment_ports": [],
        "hs_code": "0901.21",
        "declared_value_usd": 10_000.0,
    }
    base.update(overrides)
    return svc.EnrichRequest(**base)


class TestDeclarationEnrichment:
    def test_enrich_returns_dict(self):
        result = svc.enrich_declaration(_enrich_req())
        assert isinstance(result, dict)

    def test_enrich_has_risk_score(self):
        result = svc.enrich_declaration(_enrich_req())
        assert "overall_risk_score" in result
        assert 0 <= result["overall_risk_score"] <= 100

    def test_enrich_high_risk_origin_raises_score(self):
        low = svc.enrich_declaration(_enrich_req(origin_country="GH"))
        high = svc.enrich_declaration(_enrich_req(origin_country="KP"))
        assert high["overall_risk_score"] > low["overall_risk_score"]

    def test_enrich_has_recommendations(self):
        result = svc.enrich_declaration(_enrich_req())
        assert "recommendations" in result
        assert isinstance(result["recommendations"], list)

    def test_enrich_has_threat_level(self):
        result = svc.enrich_declaration(_enrich_req())
        assert "threat_level" in result
        assert result["threat_level"] in ("low", "medium", "high", "critical")

    def test_enrich_sanctioned_shipper_increases_risk(self):
        clean = svc.enrich_declaration(_enrich_req())
        sanctioned_name = svc.SANCTIONED_ENTITIES[0]["name"]
        dirty = svc.enrich_declaration(_enrich_req(shipper_name=sanctioned_name))
        assert dirty["overall_risk_score"] >= clean["overall_risk_score"]


# ─── API endpoint contracts ────────────────────────────────────────────────────

class TestAPIEndpoints:
    def test_health_returns_ok(self):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_enrich_endpoint(self):
        payload = {
            "declaration_id": "DECL-API-001",
            "trader_name": "API Test Trader",
            "shipper_name": "API Shipper",
            "consignee_name": "API Consignee",
            "origin_country": "GH",
            "destination_country": "RW",
            "hs_code": "0901.21",
            "declared_value_usd": 5000.0,
        }
        r = client.post("/enrich", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert "overall_risk_score" in data

    def test_sanctions_check_endpoint(self):
        payload = {"entity_name": "Test Entity Ltd"}
        r = client.post("/sanctions/check", json=payload)
        assert r.status_code == 200
        data = r.json()
        # Response has entity_name, hits, is_sanctioned
        assert "hits" in data or "is_sanctioned" in data

    def test_threat_actors_endpoint(self):
        r = client.get("/threat-actors")
        assert r.status_code == 200
        data = r.json()
        # Returns a list directly
        assert isinstance(data, list)

    def test_country_risk_endpoint(self):
        r = client.get("/country-risk/GH")
        assert r.status_code == 200
        data = r.json()
        assert "score" in data

    def test_ttps_endpoint(self):
        r = client.get("/ttps")
        assert r.status_code == 200
        data = r.json()
        # Returns a list of TTP objects
        assert isinstance(data, list)
        if data:
            assert "id" in data[0]

    def test_enrich_missing_fields_returns_422(self):
        r = client.post("/enrich", json={"declaration_id": "X"})
        assert r.status_code == 422
