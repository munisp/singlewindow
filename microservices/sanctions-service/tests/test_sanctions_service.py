"""
test_sanctions_service.py — SW-8/SW-M6 offline regression tests.

Runs entirely against local fixtures — no network egress required.
"""
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from list_loader import (  # noqa: E402
    SanctionsListRegistry,
    parse_ofac_sdn_csv,
    parse_un_consolidated_xml,
)

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


# ── Parsers ──────────────────────────────────────────────────────────────────

def test_ofac_csv_parser():
    entries = parse_ofac_sdn_csv(open(os.path.join(FIXTURE_DIR, "sdn.csv")).read())
    names = {e["name"] for e in entries}
    assert "SHADOW TRADE LLC" in names
    assert all(e["list"] == "OFAC-SDN" for e in entries)
    assert all(e["id"].startswith("OFAC-") for e in entries)
    assert len(entries) == 3


def test_un_xml_parser():
    entries = parse_un_consolidated_xml(open(os.path.join(FIXTURE_DIR, "consolidated.xml")).read())
    by_id = {e["id"]: e for e in entries}
    assert by_id["UN-6900001"]["name"] == "JOHN SMITH"
    assert by_id["UN-6900001"]["type"] == "individual"
    assert by_id["UN-6800001"]["name"] == "ACME ARMS TRADING"
    assert by_id["UN-6800001"]["type"] == "entity"


# ── Registry semantics ───────────────────────────────────────────────────────

def test_registry_loads_fixtures_and_versions():
    reg = SanctionsListRegistry()
    reg.load_from_dir(FIXTURE_DIR)
    assert reg.is_available()
    assert reg.lists_loaded == ["OFAC-SDN", "UN-SC"]
    assert reg.list_version() != "NO_LISTS_LOADED"
    assert "OFAC-SDN:" in reg.list_version() and "UN-SC:" in reg.list_version()
    assert reg.errors == {}
    assert len(reg.all_entries()) == 5


def test_registry_missing_dir_fails_closed():
    reg = SanctionsListRegistry()
    reg.load_from_dir("/nonexistent/path")
    assert not reg.is_available()
    assert "OFAC-SDN" in reg.errors and "UN-SC" in reg.errors
    assert reg.list_version() == "NO_LISTS_LOADED"


def test_registry_empty_list_fails_closed(tmp_path):
    (tmp_path / "sdn.csv").write_text("garbage,line\n")
    (tmp_path / "consolidated.xml").write_text("<CONSOLIDATED_LIST></CONSOLIDATED_LIST>")
    reg = SanctionsListRegistry()
    reg.load_from_dir(str(tmp_path))
    assert not reg.is_available()
    assert "parsed 0 entries" in reg.errors["OFAC-SDN"]
    assert "parsed 0 entries" in reg.errors["UN-SC"]


def test_registry_staleness():
    reg = SanctionsListRegistry()
    reg.load_from_dir(FIXTURE_DIR)
    assert not reg.is_stale(24)
    # Force-loaded lists to appear old
    for loaded in reg._lists.values():
        loaded.loaded_at = time.time() - 48 * 3600
    assert reg.is_stale(24)


def test_registry_corrupt_xml_fails_closed(tmp_path):
    (tmp_path / "sdn.csv").write_text(open(os.path.join(FIXTURE_DIR, "sdn.csv")).read())
    (tmp_path / "consolidated.xml").write_text("<unclosed")
    reg = SanctionsListRegistry()
    reg.load_from_dir(str(tmp_path))
    # OFAC loaded; UN failed → registry available but error recorded honestly
    assert reg.is_available()
    assert reg.lists_loaded == ["OFAC-SDN"]
    assert "UN-SC" in reg.errors


# ── Service-level screening behaviour (fail closed) ──────────────────────────

@pytest.fixture()
def service_module():
    """Import main.py with a fresh registry (no DB needed for these paths)."""
    for mod in ("main",):
        sys.modules.pop(mod, None)
    import importlib
    m = importlib.import_module("main")
    return m


def test_screening_refuses_when_no_lists(service_module):
    from fastapi import HTTPException
    service_module.LIST_REGISTRY._lists = {}
    service_module.LIST_REGISTRY._errors = {"OFAC-SDN": "missing"}
    with pytest.raises(HTTPException) as exc:
        service_module._require_screening_available()
    assert exc.value.status_code == 503
    assert exc.value.detail["error"] == "SCREENING_UNAVAILABLE"


def test_screening_refuses_when_stale(service_module):
    from fastapi import HTTPException
    reg = SanctionsListRegistry()
    reg.load_from_dir(FIXTURE_DIR)
    for loaded in reg._lists.values():
        loaded.loaded_at = time.time() - 72 * 3600
    service_module.LIST_REGISTRY._lists = reg._lists
    service_module.LIST_REGISTRY._errors = {}
    service_module.MAX_LIST_AGE_HOURS = 24
    with pytest.raises(HTTPException) as exc:
        service_module._require_screening_available()
    assert exc.value.status_code == 503
    assert "stale" in exc.value.detail["reason"]


def test_screen_name_matches_real_fixture_entries(service_module):
    reg = SanctionsListRegistry()
    reg.load_from_dir(FIXTURE_DIR)
    service_module.LIST_REGISTRY._lists = reg._lists
    service_module.LIST_REGISTRY._errors = {}
    hits = service_module.screen_name("Shadow Trade LLC")
    assert hits, "expected a fuzzy hit against the real OFAC fixture"
    assert hits[0]["list"] == "OFAC-SDN"
    assert hits[0]["matchScore"] >= service_module.MATCH_THRESHOLD
    # A benign name produces no hits (no fabricated matches)
    assert service_module.screen_name("Completely Benign Organization") == []
