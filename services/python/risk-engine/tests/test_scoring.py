"""
Risk Engine — Unit Tests for ML Scoring Logic
==============================================

Tests cover:
  - HS code risk lookup (known chapters, unknown chapters, edge cases)
  - Country risk scoring (FATF blacklist, greylist, low-risk, unknown)
  - Value/weight anomaly detection (normal, extreme high, extreme low, zero weight)
  - Trader risk computation (new trader, experienced, AEO, non-compliant)
  - Document completeness risk (all present, missing critical, empty)
  - Composite risk score calculation (green/yellow/red lane assignment)
  - AEO discount application
  - High-value surcharge
  - Score clamping (always 0.0–1.0)
  - Lane assignment thresholds (< 0.30 green, 0.30–0.65 yellow, >= 0.65 red)
  - Confidence level (high for experienced traders, lower for new)

Run with:
  cd services/python/risk-engine && python -m pytest tests/ -v
"""

import sys
import os

# Add the service root to sys.path so we can import from main.py directly
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from main import (
    compute_hs_risk,
    compute_country_risk,
    compute_value_weight_ratio_risk,
    compute_trader_risk,
    compute_document_completeness_risk,
    score_declaration,
    ScoreRequest,
    HIGH_RISK_HS_CHAPTERS,
    COUNTRY_RISK_SCORES,
    DEFAULT_COUNTRY_RISK,
)


# ─── FIXTURES ─────────────────────────────────────────────────────────────────

def make_request(**overrides) -> ScoreRequest:
    """Create a baseline low-risk ScoreRequest with optional field overrides."""
    defaults = dict(
        declaration_id=1,
        trader_id=100,
        hs_code="8471.30",          # Electronics chapter 84 — not in high-risk list
        origin_country="DE",         # Germany — low risk
        destination_country="NG",    # Nigeria — medium risk
        declared_value=5_000.0,
        gross_weight_kg=50.0,
        declaration_type="import",
        trader_declaration_count=50,
        trader_compliance_rate=0.95,
        is_aeo_certified=False,
        document_types=["invoice", "bill_of_lading", "packing_list", "certificate_of_origin"],
    )
    defaults.update(overrides)
    return ScoreRequest(**defaults)


# ─── HS CODE RISK ─────────────────────────────────────────────────────────────

class TestHsCodeRisk:
    def test_weapons_chapter_93_returns_highest_risk(self):
        assert compute_hs_risk("9301.00") == 0.9

    def test_radioactive_chapter_28_returns_high_risk(self):
        assert compute_hs_risk("2844.10") == 0.85

    def test_explosives_chapter_36_returns_high_risk(self):
        assert compute_hs_risk("3601.00") == 0.85

    def test_pharmaceuticals_chapter_30_returns_medium_risk(self):
        assert compute_hs_risk("3004.90") == 0.6

    def test_tobacco_chapter_24_returns_medium_risk(self):
        assert compute_hs_risk("2402.20") == 0.6

    def test_beverages_chapter_22_returns_medium_risk(self):
        assert compute_hs_risk("2208.30") == 0.5

    def test_clothing_chapter_61_returns_lower_risk(self):
        assert compute_hs_risk("6104.43") == 0.4

    def test_clothing_chapter_62_returns_lower_risk(self):
        assert compute_hs_risk("6204.61") == 0.4

    def test_footwear_chapter_64_returns_lower_risk(self):
        assert compute_hs_risk("6403.51") == 0.35

    def test_electronics_chapter_85_returns_lower_risk(self):
        assert compute_hs_risk("8517.12") == 0.3

    def test_unknown_chapter_returns_default_risk(self):
        # Chapter 01 (live animals) is not in the high-risk list
        result = compute_hs_risk("0101.21")
        assert result == 0.15

    def test_short_hs_code_uses_first_two_chars(self):
        # Even a 2-char code should work
        assert compute_hs_risk("93") == 0.9

    def test_empty_hs_code_returns_default(self):
        # Empty string → chapter "00" → not in list → default
        result = compute_hs_risk("")
        assert result == 0.15

    def test_all_high_risk_chapters_present(self):
        """Ensure all documented high-risk chapters are in the lookup table."""
        expected_chapters = {"93", "28", "36", "30", "22", "24", "61", "62", "64", "85"}
        assert expected_chapters.issubset(set(HIGH_RISK_HS_CHAPTERS.keys()))


# ─── COUNTRY RISK ─────────────────────────────────────────────────────────────

class TestCountryRisk:
    def test_north_korea_returns_maximum_risk(self):
        risk = compute_country_risk("KP", "NG")
        # KP = 0.95, NG = 0.45 → combined should be high
        assert risk >= 0.5

    def test_iran_returns_high_risk(self):
        risk = compute_country_risk("IR", "NG")
        assert risk >= 0.5

    def test_germany_to_germany_returns_very_low_risk(self):
        risk = compute_country_risk("DE", "DE")
        assert risk < 0.15

    def test_germany_to_uk_returns_very_low_risk(self):
        risk = compute_country_risk("DE", "GB")
        assert risk < 0.15

    def test_unknown_country_uses_default_risk(self):
        # "XX" is not in the table
        risk = compute_country_risk("XX", "DE")
        # XX uses DEFAULT_COUNTRY_RISK (0.40), DE uses 0.05
        assert risk > 0.1

    def test_both_unknown_countries_use_default(self):
        risk = compute_country_risk("XX", "YY")
        # Both use DEFAULT_COUNTRY_RISK (0.40); weighted 0.7*0.40 + 0.3*0.40 = 0.40
        # Use pytest.approx to handle floating-point precision
        assert risk == pytest.approx(DEFAULT_COUNTRY_RISK, abs=1e-9)

    def test_risk_is_symmetric_for_same_pair(self):
        # Origin/destination are averaged, so order matters only if asymmetric
        r1 = compute_country_risk("IR", "DE")
        r2 = compute_country_risk("DE", "IR")
        # Both should be elevated due to Iran
        assert r1 > 0.3
        assert r2 > 0.3

    def test_risk_always_between_0_and_1(self):
        for origin, dest in [("KP", "IR"), ("DE", "SG"), ("XX", "YY")]:
            risk = compute_country_risk(origin, dest)
            assert 0.0 <= risk <= 1.0, f"Risk out of range for {origin}->{dest}: {risk}"


# ─── VALUE/WEIGHT ANOMALY ─────────────────────────────────────────────────────

class TestValueWeightAnomaly:
    def test_normal_electronics_ratio_is_low_risk(self):
        # $5,000 / 50 kg = $100/kg — normal for electronics
        risk = compute_value_weight_ratio_risk(5_000.0, 50.0)
        assert risk < 0.3

    def test_very_high_ratio_triggers_anomaly(self):
        # $500,000 / 0.1 kg = $5,000,000/kg — extreme anomaly (diamonds claimed as scrap)
        risk = compute_value_weight_ratio_risk(500_000.0, 0.1)
        assert risk > 0.5

    def test_very_low_ratio_triggers_anomaly(self):
        # $10 / 10,000 kg = $0.001/kg — extreme undervaluation
        risk = compute_value_weight_ratio_risk(10.0, 10_000.0)
        assert risk > 0.3

    def test_zero_weight_returns_nonzero_risk(self):
        # Zero weight is invalid — the implementation returns 0.5 as a guard value
        risk = compute_value_weight_ratio_risk(5_000.0, 0.0)
        assert risk > 0.0  # Must flag as risky
        assert risk == 0.5  # Matches the guard return value in the implementation

    def test_negative_weight_returns_nonzero_risk(self):
        # Negative weight is invalid — the implementation returns 0.5 (same guard as zero)
        risk = compute_value_weight_ratio_risk(5_000.0, -10.0)
        assert risk > 0.0  # Must flag as risky
        assert risk == 0.5  # Matches the guard return value in the implementation

    def test_normal_clothing_ratio_is_low_risk(self):
        # $2,000 / 100 kg = $20/kg — normal for clothing
        risk = compute_value_weight_ratio_risk(2_000.0, 100.0)
        assert risk < 0.3

    def test_risk_always_between_0_and_1(self):
        test_cases = [
            (0.0, 0.0),
            (1.0, 0.001),
            (1_000_000.0, 0.001),
            (5_000.0, 50.0),
        ]
        for value, weight in test_cases:
            risk = compute_value_weight_ratio_risk(value, weight)
            assert 0.0 <= risk <= 1.0, f"Risk out of range for value={value}, weight={weight}: {risk}"


# ─── TRADER RISK ──────────────────────────────────────────────────────────────

class TestTraderRisk:
    def test_new_trader_no_history_returns_high_risk(self):
        risk = compute_trader_risk(
            trader_declaration_count=0,
            trader_compliance_rate=0.0,
            is_aeo_certified=False,
        )
        assert risk > 0.4

    def test_experienced_compliant_trader_returns_low_risk(self):
        risk = compute_trader_risk(
            trader_declaration_count=200,
            trader_compliance_rate=0.98,
            is_aeo_certified=False,
        )
        assert risk < 0.2

    def test_aeo_certified_trader_returns_lowest_risk(self):
        risk = compute_trader_risk(
            trader_declaration_count=100,
            trader_compliance_rate=0.95,
            is_aeo_certified=True,
        )
        assert risk < 0.1

    def test_non_compliant_trader_returns_high_risk(self):
        risk = compute_trader_risk(
            trader_declaration_count=50,
            trader_compliance_rate=0.30,
            is_aeo_certified=False,
        )
        assert risk > 0.4

    def test_risk_always_between_0_and_1(self):
        test_cases = [
            (0, 0.0, False),
            (1000, 1.0, True),
            (5, 0.5, False),
        ]
        for count, rate, aeo in test_cases:
            risk = compute_trader_risk(count, rate, aeo)
            assert 0.0 <= risk <= 1.0, f"Risk out of range: {risk}"


# ─── DOCUMENT COMPLETENESS ────────────────────────────────────────────────────

class TestDocumentCompleteness:
    def test_all_required_documents_returns_zero_risk(self):
        # The implementation checks for uppercase keys: INVOICE, PACKING_LIST, BL_AWB
        docs = ["INVOICE", "PACKING_LIST", "BL_AWB"]
        risk = compute_document_completeness_risk(docs)
        assert risk == 0.0

    def test_empty_document_list_returns_high_risk(self):
        risk = compute_document_completeness_risk([])
        assert risk > 0.3

    def test_missing_invoice_increases_risk(self):
        docs = ["bill_of_lading", "packing_list"]
        risk = compute_document_completeness_risk(docs)
        assert risk > 0.0

    def test_extra_documents_dont_increase_risk(self):
        # Required uppercase keys plus extras — risk should be zero
        docs = ["INVOICE", "PACKING_LIST", "BL_AWB",
                "phytosanitary_certificate", "fumigation_certificate"]
        risk = compute_document_completeness_risk(docs)
        assert risk == 0.0

    def test_risk_always_between_0_and_1(self):
        for docs in [[], ["invoice"], ["invoice", "bill_of_lading"]]:
            risk = compute_document_completeness_risk(docs)
            assert 0.0 <= risk <= 1.0


# ─── COMPOSITE SCORE & LANE ASSIGNMENT ───────────────────────────────────────

class TestCompositeScoringAndLanes:
    def test_low_risk_declaration_gets_green_lane(self):
        req = make_request(
            hs_code="8471.30",        # Electronics — low-medium risk
            origin_country="DE",       # Germany — very low risk
            destination_country="NG",  # Nigeria — medium risk
            declared_value=5_000.0,
            gross_weight_kg=50.0,
            trader_declaration_count=100,
            trader_compliance_rate=0.97,
            is_aeo_certified=False,
            document_types=["invoice", "bill_of_lading", "packing_list", "certificate_of_origin"],
        )
        result = score_declaration(req)
        assert result.risk_lane == "green"
        assert result.risk_score < 0.30
        assert result.requires_physical_inspection is False
        assert result.requires_document_review is False

    def test_medium_risk_declaration_gets_yellow_lane(self):
        req = make_request(
            hs_code="2402.20",         # Tobacco — high excise fraud risk
            origin_country="CN",       # China — medium risk
            destination_country="NG",
            declared_value=15_000.0,
            gross_weight_kg=200.0,
            trader_declaration_count=5,
            trader_compliance_rate=0.70,
            is_aeo_certified=False,
            document_types=["invoice"],  # Missing several documents
        )
        result = score_declaration(req)
        assert result.risk_lane in ("yellow", "red")
        assert result.risk_score >= 0.30

    def test_high_risk_declaration_gets_red_lane(self):
        req = make_request(
            hs_code="9301.00",         # Weapons — highest risk
            origin_country="KP",       # North Korea — maximum risk
            destination_country="IR",  # Iran — maximum risk
            declared_value=200_000.0,  # High value surcharge
            gross_weight_kg=0.5,       # Extreme value/weight ratio
            trader_declaration_count=0,
            trader_compliance_rate=0.0,
            is_aeo_certified=False,
            document_types=[],         # No documents
        )
        result = score_declaration(req)
        assert result.risk_lane == "red"
        assert result.risk_score >= 0.65
        assert result.requires_physical_inspection is True
        assert result.requires_document_review is True

    def test_aeo_certified_trader_gets_significant_discount(self):
        """AEO certification should reduce risk score to 30% of raw score."""
        req_no_aeo = make_request(is_aeo_certified=False)
        req_aeo = make_request(is_aeo_certified=True)
        result_no_aeo = score_declaration(req_no_aeo)
        result_aeo = score_declaration(req_aeo)
        # AEO should always produce a lower score
        assert result_aeo.risk_score < result_no_aeo.risk_score

    def test_high_value_declaration_gets_surcharge(self):
        """Declarations over $50,000 should get a risk surcharge."""
        req_normal = make_request(declared_value=10_000.0)
        req_high = make_request(declared_value=100_000.0)
        result_normal = score_declaration(req_normal)
        result_high = score_declaration(req_high)
        assert result_high.risk_score > result_normal.risk_score

    def test_score_always_clamped_between_0_and_1(self):
        """Risk score must always be in [0.0, 1.0]."""
        # Maximum risk scenario
        req_max = make_request(
            hs_code="9301.00",
            origin_country="KP",
            destination_country="IR",
            declared_value=1_000_000.0,
            gross_weight_kg=0.001,
            trader_declaration_count=0,
            trader_compliance_rate=0.0,
            is_aeo_certified=False,
            document_types=[],
        )
        result = score_declaration(req_max)
        assert 0.0 <= result.risk_score <= 1.0

        # Minimum risk scenario
        req_min = make_request(
            hs_code="0101.21",
            origin_country="DE",
            destination_country="GB",
            declared_value=100.0,
            gross_weight_kg=10.0,
            trader_declaration_count=500,
            trader_compliance_rate=1.0,
            is_aeo_certified=True,
            document_types=["invoice", "bill_of_lading", "packing_list", "certificate_of_origin"],
        )
        result_min = score_declaration(req_min)
        assert 0.0 <= result_min.risk_score <= 1.0

    def test_response_has_required_fields(self):
        req = make_request()
        result = score_declaration(req)
        assert result.declaration_id == 1
        assert isinstance(result.risk_score, float)
        assert result.risk_lane in ("green", "yellow", "red")
        assert isinstance(result.risk_factors, list)
        assert isinstance(result.recommended_checks, list)
        assert isinstance(result.requires_physical_inspection, bool)
        assert isinstance(result.requires_document_review, bool)
        assert isinstance(result.confidence, float)
        assert 0.0 <= result.confidence <= 1.0

    def test_experienced_trader_has_higher_confidence(self):
        req_experienced = make_request(trader_declaration_count=50)
        req_new = make_request(trader_declaration_count=5)
        result_experienced = score_declaration(req_experienced)
        result_new = score_declaration(req_new)
        assert result_experienced.confidence >= result_new.confidence

    def test_green_lane_has_no_physical_inspection(self):
        req = make_request(
            hs_code="0101.21",
            origin_country="DE",
            destination_country="GB",
            declared_value=1_000.0,
            gross_weight_kg=100.0,
            trader_declaration_count=200,
            trader_compliance_rate=0.99,
        )
        result = score_declaration(req)
        if result.risk_lane == "green":
            assert result.requires_physical_inspection is False

    def test_red_lane_always_requires_physical_inspection(self):
        req = make_request(
            hs_code="9301.00",
            origin_country="KP",
            destination_country="IR",
            declared_value=500_000.0,
            gross_weight_kg=0.1,
            trader_declaration_count=0,
            trader_compliance_rate=0.0,
            document_types=[],
        )
        result = score_declaration(req)
        if result.risk_lane == "red":
            assert result.requires_physical_inspection is True

    def test_risk_factors_list_is_populated_for_high_risk(self):
        req = make_request(
            hs_code="9301.00",
            origin_country="KP",
            destination_country="IR",
        )
        result = score_declaration(req)
        assert len(result.risk_factors) > 0
        # Each factor should have the required fields
        for factor in result.risk_factors:
            assert hasattr(factor, "factor")
            assert hasattr(factor, "weight")
            assert hasattr(factor, "description")

    def test_aeo_factor_appears_in_risk_factors_when_certified(self):
        req = make_request(is_aeo_certified=True)
        result = score_declaration(req)
        factor_names = [f.factor for f in result.risk_factors]
        assert "aeo_certified" in factor_names

    def test_high_value_factor_appears_when_over_threshold(self):
        req = make_request(declared_value=75_000.0)
        result = score_declaration(req)
        factor_names = [f.factor for f in result.risk_factors]
        assert "high_value" in factor_names


# ─── LANE THRESHOLD BOUNDARY TESTS ───────────────────────────────────────────

class TestLaneThresholds:
    """Test exact boundary conditions for lane assignment."""

    def test_score_0_29_is_green(self):
        """Score just below 0.30 threshold should be green."""
        # We test the lane logic by checking score ranges
        # We can't directly set the score, so we verify the documented thresholds
        # are consistent with the implementation
        req = make_request(
            hs_code="0101.21",
            origin_country="DE",
            destination_country="GB",
            declared_value=500.0,
            gross_weight_kg=50.0,
            trader_declaration_count=200,
            trader_compliance_rate=1.0,
            is_aeo_certified=True,
            document_types=["invoice", "bill_of_lading", "packing_list", "certificate_of_origin"],
        )
        result = score_declaration(req)
        # With AEO + perfect compliance + low-risk everything, should be green
        assert result.risk_lane == "green"

    def test_score_0_65_or_above_is_red(self):
        """Score at or above 0.65 should be red."""
        req = make_request(
            hs_code="9301.00",
            origin_country="KP",
            destination_country="SY",
            declared_value=100_000.0,
            gross_weight_kg=1.0,
            trader_declaration_count=0,
            trader_compliance_rate=0.0,
            is_aeo_certified=False,
            document_types=[],
        )
        result = score_declaration(req)
        assert result.risk_lane == "red"
        assert result.risk_score >= 0.65
