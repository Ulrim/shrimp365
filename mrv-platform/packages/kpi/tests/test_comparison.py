"""Unit tests for compare_metric (phase-2 슬라이스 J, 3.1절 — 산식 아닌 표시 산술)."""

from __future__ import annotations

import pytest

from culiver_kpi.comparison import METRIC_DIRECTION, MetricComparison, compare_metric


def test_lower_is_better_improvement():
    result = compare_metric(4.87, 4.10, "lower_is_better")
    assert result.delta == pytest.approx(-0.77)
    assert result.improvement_pct == pytest.approx((4.87 - 4.10) / 4.87 * 100.0)
    assert result.direction == "lower_is_better"


def test_higher_is_better_improvement():
    result = compare_metric(72.4, 78.9, "higher_is_better")
    assert result.delta == pytest.approx(6.5)
    assert result.improvement_pct == pytest.approx((78.9 - 72.4) / 72.4 * 100.0)


def test_lower_is_better_regression_is_negative_pct():
    """값이 나빠지면(lower_is_better 인데 증가) improvement_pct 는 음수."""
    result = compare_metric(1.4, 1.6, "lower_is_better")
    assert result.delta == pytest.approx(0.2)
    assert result.improvement_pct < 0


def test_none_propagation_baseline_none():
    result = compare_metric(None, 4.10, "lower_is_better")
    assert result.delta is None
    assert result.improvement_pct is None
    assert result.baseline_value is None
    assert result.current_value == 4.10


def test_none_propagation_current_none():
    result = compare_metric(4.87, None, "lower_is_better")
    assert result.delta is None
    assert result.improvement_pct is None


def test_none_propagation_both_none():
    result = compare_metric(None, None, "higher_is_better")
    assert result.delta is None
    assert result.improvement_pct is None


def test_baseline_zero_or_negative_guards_improvement_pct_but_keeps_delta():
    result = compare_metric(0.0, 5.0, "higher_is_better")
    assert result.delta == pytest.approx(5.0)
    assert result.improvement_pct is None

    result_neg = compare_metric(-1.0, 5.0, "lower_is_better")
    assert result_neg.delta == pytest.approx(6.0)
    assert result_neg.improvement_pct is None


def test_unknown_direction_raises():
    with pytest.raises(ValueError):
        compare_metric(1.0, 2.0, "sideways")  # type: ignore[arg-type]


def test_metric_direction_table_matches_master_3_2():
    assert METRIC_DIRECTION == {
        "ei_total": "lower_is_better",
        "ei_aeration": "lower_is_better",
        "oei": "higher_is_better",
        "fcr": "lower_is_better",
        "mortality_rate": "lower_is_better",
    }


def test_deterministic_repeat():
    a = compare_metric(1.42, 1.35, "lower_is_better")
    b = compare_metric(1.42, 1.35, "lower_is_better")
    assert a == b
    assert isinstance(a, MetricComparison)
