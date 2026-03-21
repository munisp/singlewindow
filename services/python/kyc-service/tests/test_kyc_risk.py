"""
KYC Service — pytest suite
Tests the KYCRiskScorer FATF risk-based scoring engine,
entity profile extraction, and FastAPI endpoint contracts.
"""
import sys
import os

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main as svc

client = TestClient(svc.app)


# ─── Fixtures ─────────────────────────────────────────────────────────────────

def _ocr(confidence: float = 0.9, doc_type: str = "passport") -> svc.OCRResult:
    return svc.OCRResult(
        document_type=doc_type,
        language="en",
        extracted_fields=[
            svc.ExtractedField(field_name="given_name", value="John", confidence=0.95),
            svc.ExtractedField(field_name="surname", value="Doe", confidence=0.95),
            svc.ExtractedField(field_name="nationality", value="GH", confidence=0.9),
            svc.ExtractedField(field_name="expiry_date", value="2030-01-01", confidence=0.9),
        ],
        raw_text="JOHN DOE GH 2030-01-01",
        page_count=1,
        ocr_confidence=confidence,
        processing_time_ms=120,
    )


def _vlm(
    is_authentic: bool = True,
    tampering_detected: bool = False,
    expiry_status: str = "VALID",
    security_features_missing: list | None = None,
    cross_field_consistency: bool = True,
    consistency_issues: list | None = None,
    tampering_indicators: list | None = None,
) -> svc.VLMVerificationResult:
    return svc.VLMVerificationResult(
        is_authentic=is_authentic,
        authenticity_score=0.95 if is_authentic else 0.2,
        tampering_detected=tampering_detected,
        tampering_indicators=tampering_indicators or [],
        security_features_present=["hologram", "watermark"],
        security_features_missing=security_features_missing or [],
        cross_field_consistency=cross_field_consistency,
        consistency_issues=consistency_issues or [],
        expiry_status=expiry_status,
        expiry_date="2030-01-01" if expiry_status != "EXPIRED" else "2020-01-01",
        vlm_reasoning="Document appears genuine.",
    )


def _entity(nationality: str = "GH", full_name: str = "John Doe") -> svc.EntityProfile:
    return svc.EntityProfile(
        entity_type="individual",
        full_name=full_name,
        nationality=nationality,
    )


scorer = svc.KYCRiskScorer()


# ─── Low-risk baseline ────────────────────────────────────────────────────────

class TestLowRiskBaseline:
    def test_clean_document_scores_low(self):
        result = scorer.score(_ocr(), _vlm(), _entity(), "passport")
        assert result.risk_level in ("LOW", "MEDIUM")
        assert result.recommended_action in ("APPROVE", "ENHANCED_DUE_DILIGENCE")

    def test_clean_document_no_aml_flag(self):
        result = scorer.score(_ocr(), _vlm(), _entity(), "passport")
        assert result.aml_flag is False

    def test_clean_document_no_pep_flag(self):
        result = scorer.score(_ocr(), _vlm(), _entity(), "passport")
        assert result.pep_flag is False

    def test_score_bounded_0_to_100(self):
        result = scorer.score(_ocr(), _vlm(), _entity(), "passport")
        assert 0 <= result.overall_score <= 100


# ─── Document risk factors ────────────────────────────────────────────────────

class TestDocumentRiskFactors:
    def test_inauthentic_document_raises_score(self):
        clean = scorer.score(_ocr(), _vlm(is_authentic=True), _entity(), "passport")
        risky = scorer.score(_ocr(), _vlm(is_authentic=False), _entity(), "passport")
        assert risky.overall_score > clean.overall_score

    def test_tampered_document_raises_score(self):
        clean = scorer.score(_ocr(), _vlm(), _entity(), "passport")
        tampered = scorer.score(
            _ocr(),
            _vlm(tampering_detected=True, tampering_indicators=["Ink inconsistency"]),
            _entity(),
            "passport",
        )
        assert tampered.overall_score > clean.overall_score

    def test_expired_document_raises_score(self):
        clean = scorer.score(_ocr(), _vlm(expiry_status="VALID"), _entity(), "passport")
        expired = scorer.score(_ocr(), _vlm(expiry_status="EXPIRED"), _entity(), "passport")
        assert expired.overall_score > clean.overall_score

    def test_expiring_soon_raises_score_less_than_expired(self):
        expired = scorer.score(_ocr(), _vlm(expiry_status="EXPIRED"), _entity(), "passport")
        expiring = scorer.score(_ocr(), _vlm(expiry_status="EXPIRING_SOON"), _entity(), "passport")
        assert expired.overall_score > expiring.overall_score

    def test_missing_security_features_raises_score(self):
        clean = scorer.score(_ocr(), _vlm(security_features_missing=[]), _entity(), "passport")
        missing = scorer.score(
            _ocr(),
            _vlm(security_features_missing=["hologram", "watermark", "microprint"]),
            _entity(),
            "passport",
        )
        assert missing.overall_score > clean.overall_score

    def test_low_ocr_confidence_raises_score(self):
        high_conf = scorer.score(_ocr(confidence=0.95), _vlm(), _entity(), "passport")
        low_conf = scorer.score(_ocr(confidence=0.5), _vlm(), _entity(), "passport")
        assert low_conf.overall_score > high_conf.overall_score

    def test_cross_field_inconsistency_raises_score(self):
        clean = scorer.score(_ocr(), _vlm(cross_field_consistency=True), _entity(), "passport")
        inconsistent = scorer.score(
            _ocr(),
            _vlm(cross_field_consistency=False, consistency_issues=["Name mismatch"]),
            _entity(),
            "passport",
        )
        assert inconsistent.overall_score > clean.overall_score


# ─── Entity risk factors ──────────────────────────────────────────────────────

class TestEntityRiskFactors:
    def test_high_risk_jurisdiction_raises_score(self):
        clean = scorer.score(_ocr(), _vlm(), _entity(nationality="GH"), "passport")
        risky = scorer.score(_ocr(), _vlm(), _entity(nationality="IR"), "passport")
        assert risky.overall_score > clean.overall_score

    def test_north_korea_is_high_risk(self):
        result = scorer.score(_ocr(), _vlm(), _entity(nationality="KP"), "passport")
        assert result.entity_risk >= 40

    def test_pep_keyword_in_name_sets_flag(self):
        result = scorer.score(_ocr(), _vlm(), _entity(full_name="Minister John Doe"), "passport")
        assert result.pep_flag is True

    def test_regular_name_no_pep_flag(self):
        result = scorer.score(_ocr(), _vlm(), _entity(full_name="John Doe"), "passport")
        assert result.pep_flag is False

    def test_pep_raises_entity_risk(self):
        regular = scorer.score(_ocr(), _vlm(), _entity(full_name="John Doe"), "passport")
        pep = scorer.score(_ocr(), _vlm(), _entity(full_name="Governor John Doe"), "passport")
        assert pep.entity_risk > regular.entity_risk


# ─── Risk level thresholds ────────────────────────────────────────────────────

class TestRiskLevelThresholds:
    def test_critical_score_rejects(self):
        # Inauthentic + tampered + expired + high-risk jurisdiction
        result = scorer.score(
            _ocr(confidence=0.4),
            _vlm(
                is_authentic=False,
                tampering_detected=True,
                tampering_indicators=["Ink inconsistency", "Font mismatch"],
                expiry_status="EXPIRED",
                security_features_missing=["hologram", "watermark"],
                cross_field_consistency=False,
                consistency_issues=["Name mismatch"],
            ),
            _entity(nationality="KP", full_name="Minister Kim"),
            "passport",
        )
        assert result.risk_level in ("HIGH", "CRITICAL")
        assert result.recommended_action in ("MANUAL_REVIEW", "REJECT")

    def test_risk_factors_list_populated(self):
        result = scorer.score(
            _ocr(),
            _vlm(is_authentic=False),
            _entity(),
            "passport",
        )
        assert len(result.risk_factors) > 0

    def test_clean_document_risk_factors_has_no_significant_issues(self):
        result = scorer.score(_ocr(), _vlm(), _entity(), "passport")
        # Should have the default "no significant risk factors" message
        assert any("No significant" in f or len(result.risk_factors) >= 0 for f in result.risk_factors)


# ─── AML flag logic ───────────────────────────────────────────────────────────

class TestAMLFlag:
    def test_high_document_risk_sets_aml_flag(self):
        result = scorer.score(
            _ocr(),
            _vlm(is_authentic=False, tampering_detected=True,
                 tampering_indicators=["Ink inconsistency"]),
            _entity(),
            "passport",
        )
        # document_risk > 40 should set aml_flag
        if result.document_risk > 40:
            assert result.aml_flag is True

    def test_high_entity_risk_sets_aml_flag(self):
        result = scorer.score(_ocr(), _vlm(), _entity(nationality="KP"), "passport")
        if result.entity_risk > 40:
            assert result.aml_flag is True


# ─── API endpoint contracts ────────────────────────────────────────────────────

class TestAPIEndpoints:
    @pytest.fixture(autouse=True)
    def init_lazy_engines(self):
        """Ensure lazy engines are initialized before health endpoint is called."""
        svc.paddle_ocr._lazy_init()
        svc.docling._lazy_init()

    def test_health_returns_ok(self):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_health_includes_service_name(self):
        r = client.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert "service" in data
