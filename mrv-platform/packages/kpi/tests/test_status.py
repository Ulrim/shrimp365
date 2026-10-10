"""Unit tests for classify_metric_status (KPI 신호등, phase-2 슬라이스 G).

경계조건: None→'na', 5개 지표 각각 green/amber/red 경계값 정확(포함/배제 방향),
방향 반영(lower/higher_is_better), 결정론, 방어(ValueError: 비유한값/알 수 없는 방향/
모순된 임계 방향).
"""

from __future__ import annotations

import math

import pytest

from culiver_kpi import (
    DEFAULT_KPI_THRESHOLDS,
    METRIC_DIRECTIONS,
    MetricThresholds,
    classify_metric_status,
)


# --- 1) value=None → 'na' (지표/방향 무관) -----------------------------------
def test_none_value_is_na_for_all_metrics():
    for metric, direction in METRIC_DIRECTIONS.items():
        thresholds = getattr(DEFAULT_KPI_THRESHOLDS, metric)
        assert classify_metric_status(None, direction, thresholds) == "na"


# --- 2) 5개 지표 각각 green/amber/red 경계 정확 ------------------------------

def test_fcr_lower_is_better_boundaries():
    # FCR: red_threshold=1.6, amber_threshold=1.5 (lower_is_better)
    t = DEFAULT_KPI_THRESHOLDS.fcr
    assert t.red_threshold == 1.6 and t.amber_threshold == 1.5
    assert classify_metric_status(1.4, "lower_is_better", t) == "green"
    assert classify_metric_status(1.499999, "lower_is_better", t) == "green"
    assert classify_metric_status(1.5, "lower_is_better", t) == "amber"      # 경계값 포함
    assert classify_metric_status(1.55, "lower_is_better", t) == "amber"
    assert classify_metric_status(1.6, "lower_is_better", t) == "red"        # 경계값 포함
    assert classify_metric_status(2.0, "lower_is_better", t) == "red"


def test_ei_total_lower_is_better_boundaries():
    t = DEFAULT_KPI_THRESHOLDS.ei_total
    assert classify_metric_status(t.amber_threshold - 0.01, "lower_is_better", t) == "green"
    assert classify_metric_status(t.amber_threshold, "lower_is_better", t) == "amber"
    assert classify_metric_status(t.red_threshold, "lower_is_better", t) == "red"
    assert classify_metric_status(t.red_threshold + 1.0, "lower_is_better", t) == "red"


def test_ei_aeration_lower_is_better_boundaries():
    t = DEFAULT_KPI_THRESHOLDS.ei_aeration
    assert classify_metric_status(t.amber_threshold - 0.01, "lower_is_better", t) == "green"
    assert classify_metric_status(t.amber_threshold, "lower_is_better", t) == "amber"
    assert classify_metric_status(t.red_threshold, "lower_is_better", t) == "red"


def test_mortality_rate_lower_is_better_boundaries():
    t = DEFAULT_KPI_THRESHOLDS.mortality_rate
    assert classify_metric_status(t.amber_threshold - 0.5, "lower_is_better", t) == "green"
    assert classify_metric_status(t.amber_threshold, "lower_is_better", t) == "amber"
    assert classify_metric_status(t.red_threshold, "lower_is_better", t) == "red"
    assert classify_metric_status(t.red_threshold + 5.0, "lower_is_better", t) == "red"


def test_oei_higher_is_better_boundaries():
    # OEI: red_threshold=50, amber_threshold=60 (higher_is_better — 부등호 방향 반대)
    t = DEFAULT_KPI_THRESHOLDS.oei
    assert t.red_threshold == 50.0 and t.amber_threshold == 60.0
    assert classify_metric_status(70.0, "higher_is_better", t) == "green"
    assert classify_metric_status(60.01, "higher_is_better", t) == "green"
    assert classify_metric_status(60.0, "higher_is_better", t) == "amber"    # 경계값 포함
    assert classify_metric_status(55.0, "higher_is_better", t) == "amber"
    assert classify_metric_status(50.0, "higher_is_better", t) == "red"      # 경계값 포함
    assert classify_metric_status(10.0, "higher_is_better", t) == "red"


# --- 3) 결정론(동일 입력 → 동일 출력) ----------------------------------------
def test_deterministic():
    t = MetricThresholds(red_threshold=10.0, amber_threshold=5.0)
    r1 = classify_metric_status(7.5, "lower_is_better", t)
    r2 = classify_metric_status(7.5, "lower_is_better", t)
    assert r1 == r2 == "amber"


# --- 4) 방어: 비유한 값 / 알 수 없는 방향 / 모순된 임계 방향 -----------------
def test_nonfinite_value_raises():
    t = MetricThresholds(red_threshold=10.0, amber_threshold=5.0)
    with pytest.raises(ValueError):
        classify_metric_status(math.nan, "lower_is_better", t)
    with pytest.raises(ValueError):
        classify_metric_status(math.inf, "lower_is_better", t)


def test_unknown_direction_raises():
    t = MetricThresholds(red_threshold=10.0, amber_threshold=5.0)
    with pytest.raises(ValueError):
        classify_metric_status(7.0, "sideways", t)  # type: ignore[arg-type]


def test_inconsistent_threshold_direction_raises():
    # lower_is_better 인데 red < amber (모순) → ValueError
    bad_lower = MetricThresholds(red_threshold=1.0, amber_threshold=5.0)
    with pytest.raises(ValueError):
        classify_metric_status(3.0, "lower_is_better", bad_lower)
    # higher_is_better 인데 red > amber (모순) → ValueError
    bad_higher = MetricThresholds(red_threshold=10.0, amber_threshold=5.0)
    with pytest.raises(ValueError):
        classify_metric_status(7.0, "higher_is_better", bad_higher)


# --- 5) METRIC_DIRECTIONS 5개 지표 정의 확인 ---------------------------------
def test_metric_directions_cover_five_metrics():
    assert set(METRIC_DIRECTIONS) == {
        "ei_total", "ei_aeration", "fcr", "oei", "mortality_rate",
    }
    assert METRIC_DIRECTIONS["oei"] == "higher_is_better"
    for metric in ("ei_total", "ei_aeration", "fcr", "mortality_rate"):
        assert METRIC_DIRECTIONS[metric] == "lower_is_better"
