"""
Unit tests for ai-risk-scorer — TradeGateway NGSWTP
Run with: pytest test_risk_scorer.py -v
"""

import pytest
from main import extract_features, rule_based_score, HIGH_RISK_HS_PREFIXES, HIGH_RISK_COUNTRIES


def make_declaration(**overrides):
    """Helper to build a minimal valid declaration dict."""
    base = {
        "declarationId": "decl-test-001",
        "traderId": "trader-001",
        "declarationType": "IMPORT",
        "countryOfOrigin": "CN",
        "countryOfDestination": "GH",
        "totalValue": 10000.0,
        "totalWeight": 500.0,
        "totalDuty": 1500.0,
        "numberOfPackages": 10,
        "items": [
            {"hsCode": "6101", "description": "Clothing", "quantity": 100, "unitValue": 100.0},
        ],
        "documents": [
            {"type": "COMMERCIAL_INVOICE", "reference": "INV-001"},
            {"type": "BILL_OF_LADING", "reference": "BL-001"},
            {"type": "PACKING_LIST", "reference": "PL-001"},
        ],
        "traderHistory": {
            "totalDeclarations": 50,
            "rejectionRate": 0.02,
            "amendmentRate": 0.05,
            "isAEO": False,
            "monthsActive": 24,
        },
    }
    base.update(overrides)
    return base


class TestFeatureExtraction:
    def test_basic_extraction(self):
        decl = make_declaration()
        features = extract_features(decl)
        assert len(features) == 1
        assert features["total_value"].iloc[0] == 10000.0
        assert features["num_items"].iloc[0] == 1

    def test_high_risk_hs_detection(self):
        decl = make_declaration(items=[
            {"hsCode": "9301", "description": "Firearms", "quantity": 1, "unitValue": 5000.0},
            {"hsCode": "2801", "description": "Chemicals", "quantity": 100, "unitValue": 50.0},
        ])
        features = extract_features(decl)
        assert features["high_risk_hs_count"].iloc[0] == 2

    def test_country_risk_scoring(self):
        # High-risk country
        decl_hr = make_declaration(countryOfOrigin="KP")
        features_hr = extract_features(decl_hr)
        assert features_hr["country_risk_score"].iloc[0] == 3.0

        # Low-risk country
        decl_lr = make_declaration(countryOfOrigin="DE")
        features_lr = extract_features(decl_lr)
        assert features_lr["country_risk_score"].iloc[0] == 1.0

    def test_aeo_flag(self):
        decl = make_declaration(traderHistory={
            "totalDeclarations": 100,
            "rejectionRate": 0.01,
            "amendmentRate": 0.02,
            "isAEO": True,
            "monthsActive": 60,
        })
        features = extract_features(decl)
        assert features["trader_is_aeo"].iloc[0] == 1

    def test_doc_completeness_full(self):
        decl = make_declaration()
        features = extract_features(decl)
        assert features["doc_completeness"].iloc[0] == 1.0

    def test_doc_completeness_partial(self):
        decl = make_declaration(documents=[
            {"type": "COMMERCIAL_INVOICE", "reference": "INV-001"},
        ])
        features = extract_features(decl)
        assert abs(features["doc_completeness"].iloc[0] - 0.333) < 0.01

    def test_value_per_kg_calculation(self):
        decl = make_declaration(totalValue=10000.0, totalWeight=100.0)
        features = extract_features(decl)
        assert features["declared_value_per_kg"].iloc[0] == pytest.approx(100.0)


class TestRuleBasedScoring:
    def test_clean_declaration_low_score(self):
        decl = make_declaration()
        features = extract_features(decl)
        score, rules = rule_based_score(decl, features)
        assert score < 0.3, f"Clean declaration should have low score, got {score}"

    def test_high_risk_hs_increases_score(self):
        decl_clean = make_declaration()
        decl_risky = make_declaration(items=[
            {"hsCode": "9301", "description": "Firearms", "quantity": 1, "unitValue": 5000.0},
        ])
        features_clean = extract_features(decl_clean)
        features_risky = extract_features(decl_risky)

        score_clean, _ = rule_based_score(decl_clean, features_clean)
        score_risky, rules_risky = rule_based_score(decl_risky, features_risky)

        assert score_risky > score_clean
        assert any("R1" in r for r in rules_risky)

    def test_high_risk_country_increases_score(self):
        decl = make_declaration(countryOfOrigin="KP")
        features = extract_features(decl)
        score, rules = rule_based_score(decl, features)
        assert score > 0.3
        assert any("R2" in r for r in rules)

    def test_aeo_reduces_score(self):
        decl_aeo = make_declaration(
            countryOfOrigin="KP",  # High risk country
            traderHistory={
                "totalDeclarations": 200,
                "rejectionRate": 0.01,
                "amendmentRate": 0.02,
                "isAEO": True,
                "monthsActive": 60,
            }
        )
        decl_non_aeo = make_declaration(
            countryOfOrigin="KP",
            traderHistory={
                "totalDeclarations": 200,
                "rejectionRate": 0.01,
                "amendmentRate": 0.02,
                "isAEO": False,
                "monthsActive": 60,
            }
        )
        features_aeo = extract_features(decl_aeo)
        features_non_aeo = extract_features(decl_non_aeo)

        score_aeo, rules_aeo = rule_based_score(decl_aeo, features_aeo)
        score_non_aeo, _ = rule_based_score(decl_non_aeo, features_non_aeo)

        assert score_aeo < score_non_aeo
        assert any("R7" in r for r in rules_aeo)

    def test_new_trader_high_value_increases_score(self):
        decl = make_declaration(
            totalValue=100000.0,
            traderHistory={
                "totalDeclarations": 2,
                "rejectionRate": 0.0,
                "amendmentRate": 0.0,
                "isAEO": False,
                "monthsActive": 1,
            }
        )
        features = extract_features(decl)
        score, rules = rule_based_score(decl, features)
        assert any("R3" in r for r in rules)

    def test_high_rejection_rate_increases_score(self):
        decl = make_declaration(traderHistory={
            "totalDeclarations": 100,
            "rejectionRate": 0.35,
            "amendmentRate": 0.10,
            "isAEO": False,
            "monthsActive": 24,
        })
        features = extract_features(decl)
        score, rules = rule_based_score(decl, features)
        assert any("R4" in r for r in rules)

    def test_score_capped_at_one(self):
        """Score must never exceed 1.0 regardless of how many rules trigger."""
        decl = make_declaration(
            countryOfOrigin="KP",
            totalValue=500000.0,
            totalWeight=1.0,  # Very low weight → suspicious value/weight ratio
            items=[
                {"hsCode": "9301", "description": "Firearms", "quantity": 1, "unitValue": 500000.0},
                {"hsCode": "2801", "description": "Chemicals", "quantity": 1, "unitValue": 1.0},
            ],
            documents=[],  # No documents
            traderHistory={
                "totalDeclarations": 1,
                "rejectionRate": 0.5,
                "amendmentRate": 0.5,
                "isAEO": False,
                "monthsActive": 0,
            }
        )
        features = extract_features(decl)
        score, rules = rule_based_score(decl, features)
        assert score <= 1.0

    def test_transit_high_risk_country(self):
        decl = make_declaration(
            declarationType="TRANSIT",
            countryOfOrigin="IR",
        )
        features = extract_features(decl)
        score, rules = rule_based_score(decl, features)
        assert any("R8" in r for r in rules)


class TestHighRiskConstants:
    def test_high_risk_hs_prefixes_are_two_chars(self):
        for prefix in HIGH_RISK_HS_PREFIXES:
            assert len(prefix) == 2, f"HS prefix {prefix} must be 2 characters"

    def test_high_risk_countries_are_two_chars(self):
        for code in HIGH_RISK_COUNTRIES:
            assert len(code) == 2, f"Country code {code} must be 2 characters (ISO 3166-1 alpha-2)"

    def test_kp_in_high_risk(self):
        assert "KP" in HIGH_RISK_COUNTRIES, "North Korea must be in high-risk countries"

    def test_ir_in_high_risk(self):
        assert "IR" in HIGH_RISK_COUNTRIES, "Iran must be in high-risk countries"

    def test_arms_hs_in_high_risk(self):
        assert "93" in HIGH_RISK_HS_PREFIXES, "Chapter 93 (arms) must be high-risk"
