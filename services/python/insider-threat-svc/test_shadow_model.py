"""pytest tests for shadow_model.py A/B parallel scoring."""
import pytest
import numpy as np
from unittest.mock import MagicMock

from shadow_model import ShadowModel, ComparisonRecord, BLOCK_THRESHOLD, get_shadow_model
from anomaly_detector import AnomalyDetector, AnomalyFeatures


def make_features(score: float = 0.3) -> AnomalyFeatures:
    return AnomalyFeatures(
        hour_of_day=10,
        action_count_per_hour=5,
        unique_records_accessed=3,
        off_hours_flag=0,
        role_mismatch_score=0.1,
    )


def make_mock_detector(score: float) -> AnomalyDetector:
    d = MagicMock(spec=AnomalyDetector)
    d.score.return_value = score
    return d


class TestShadowModelLifecycle:
    def test_disabled_by_default(self):
        sm = ShadowModel()
        assert not sm.is_enabled

    def test_enable_sets_enabled(self):
        sm = ShadowModel()
        sm.enable(make_mock_detector(0.3))
        assert sm.is_enabled

    def test_disable_clears_state(self):
        sm = ShadowModel()
        sm.enable(make_mock_detector(0.3))
        sm.disable()
        assert not sm.is_enabled

    def test_score_returns_none_when_disabled(self):
        sm = ShadowModel()
        result = sm.score(make_features(), production_score=0.4)
        assert result is None


class TestShadowModelScoring:
    def test_score_returns_shadow_value(self):
        sm = ShadowModel()
        sm.enable(make_mock_detector(0.6))
        result = sm.score(make_features(), production_score=0.4)
        assert result == pytest.approx(0.6)

    def test_score_appends_to_buffer(self):
        sm = ShadowModel()
        sm.enable(make_mock_detector(0.5))
        sm.score(make_features(), production_score=0.4)
        assert len(list(sm._buffer)) == 1

    def test_production_blocked_flag_set_correctly(self):
        sm = ShadowModel()
        sm.enable(make_mock_detector(0.3))
        sm.score(make_features(), production_score=0.9)
        record = list(sm._buffer)[0]
        assert record.production_blocked is True
        assert record.shadow_blocked is False

    def test_agreement_when_both_blocked(self):
        sm = ShadowModel()
        sm.enable(make_mock_detector(0.9))
        sm.score(make_features(), production_score=0.9)
        record = list(sm._buffer)[0]
        assert record.production_blocked == record.shadow_blocked


class TestShadowModelStats:
    def test_empty_stats_returns_zeros(self):
        sm = ShadowModel()
        stats = sm.get_stats()
        assert stats["total_comparisons"] == 0
        assert stats["agreement_rate"] == 0.0

    def test_stats_total_comparisons(self):
        sm = ShadowModel()
        sm.enable(make_mock_detector(0.3))
        for _ in range(5):
            sm.score(make_features(), production_score=0.3)
        stats = sm.get_stats()
        assert stats["total_comparisons"] == 5

    def test_stats_agreement_rate_perfect(self):
        sm = ShadowModel()
        sm.enable(make_mock_detector(0.3))
        for _ in range(10):
            sm.score(make_features(), production_score=0.3)
        stats = sm.get_stats()
        assert stats["agreement_rate"] == pytest.approx(1.0)

    def test_stats_agreement_rate_zero(self):
        sm = ShadowModel()
        sm.enable(make_mock_detector(0.9))  # shadow always blocks
        for _ in range(10):
            sm.score(make_features(), production_score=0.1)  # prod never blocks
        stats = sm.get_stats()
        assert stats["agreement_rate"] == pytest.approx(0.0)

    def test_get_recent_respects_limit(self):
        sm = ShadowModel()
        sm.enable(make_mock_detector(0.3))
        for _ in range(20):
            sm.score(make_features(), production_score=0.3)
        recent = sm.get_recent(limit=5)
        assert len(recent["records"]) == 5

    def test_score_distribution_bucket_count(self):
        sm = ShadowModel()
        sm.enable(make_mock_detector(0.3))
        sm.score(make_features(), production_score=0.3)
        stats = sm.get_stats()
        assert len(stats["score_distribution"]["production"]) == 5
        assert len(stats["score_distribution"]["shadow"]) == 5

    def test_clear_empties_buffer(self):
        sm = ShadowModel()
        sm.enable(make_mock_detector(0.3))
        sm.score(make_features(), production_score=0.3)
        sm.clear()
        assert sm.get_stats()["total_comparisons"] == 0

    def test_module_singleton(self):
        sm1 = get_shadow_model()
        sm2 = get_shadow_model()
        assert sm1 is sm2
