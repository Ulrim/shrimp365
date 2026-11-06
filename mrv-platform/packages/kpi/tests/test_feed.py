"""Unit tests for compute_fcr (FCR 산식, MASTER 3.2 ③). phase-1 슬라이스 A 수용 기준 고정.

경계조건: 증체량 0/음수, quality_flag 제외, 기간 반열림 [start,end), source_feed_refs
정렬·중복제거, 결정론, 음수/비유한 feed_kg 방어.
"""

from __future__ import annotations

import math
from dataclasses import FrozenInstanceError
from datetime import datetime, timedelta, timezone

import pytest

from culiver_kpi import BiomassPoint, FcrConfig, FeedReading, compute_fcr

UTC = timezone.utc
PERIOD_START = datetime(2026, 6, 1, 0, 0, 0, tzinfo=UTC)
PERIOD_END = datetime(2026, 6, 8, 0, 0, 0, tzinfo=UTC)  # 7일 기간, end 미포함
VERSION = "2026.1.0"


def _feed(ref: str, hours: int, feed_kg: float, quality_flag: str = "ok",
          batch_id: str = "batch-1") -> FeedReading:
    return FeedReading(
        source_ref=ref,
        batch_id=batch_id,
        ts=PERIOD_START + timedelta(hours=hours),
        feed_kg=feed_kg,
        quality_flag=quality_flag,
    )


def _biomass(hours: int, kg: float, ref: str) -> BiomassPoint:
    return BiomassPoint(ts=PERIOD_START + timedelta(hours=hours), biomass_kg=kg, source_ref=ref)


# --- 1) 정상 산출 ------------------------------------------------------------
def test_normal_computation_values():
    feeds = [
        _feed("f1", 0, 30.0),
        _feed("f2", 1, 30.0),
        _feed("f3", 2, 20.0),
    ]
    # total feed = 80, Δbiomass = 56 → FCR = 80/56
    b0 = _biomass(0, 100.0, "harvest-open")
    b1 = _biomass(24, 156.0, "harvest-close")
    r = compute_fcr(feeds, b0, b1, PERIOD_START, PERIOD_END, FcrConfig(), VERSION)

    assert r.total_feed_kg == pytest.approx(80.0)
    assert r.biomass_delta_kg == pytest.approx(56.0)
    assert r.fcr == pytest.approx(80.0 / 56.0)
    assert r.included_feed_count == 3
    assert r.excluded_feed_count == 0
    assert r.source_feed_refs == ("f1", "f2", "f3")
    assert r.source_biomass_refs == ("harvest-open", "harvest-close")
    assert r.config_version == VERSION


# --- 2) 경계: Δbiomass = 0 → FCR None ---------------------------------------
def test_zero_biomass_delta_yields_none():
    feeds = [_feed("f1", 0, 50.0)]
    r = compute_fcr(feeds, _biomass(0, 200.0, "o"), _biomass(24, 200.0, "c"),
                    PERIOD_START, PERIOD_END, FcrConfig(), VERSION)
    assert r.biomass_delta_kg == 0.0
    assert r.fcr is None
    # 근거는 여전히 채워짐(drill-down)
    assert r.total_feed_kg == pytest.approx(50.0)
    assert r.included_feed_count == 1


# --- 2b) 경계: Δbiomass 음수 → FCR None -------------------------------------
def test_negative_biomass_delta_yields_none():
    feeds = [_feed("f1", 0, 50.0)]
    r = compute_fcr(feeds, _biomass(0, 200.0, "o"), _biomass(24, 150.0, "c"),
                    PERIOD_START, PERIOD_END, FcrConfig(), VERSION)
    assert r.biomass_delta_kg == pytest.approx(-50.0)
    assert r.fcr is None


# --- 2c) 경계: min_biomass_delta_kg 임계 미달 → None ------------------------
def test_below_min_biomass_delta_threshold_yields_none():
    feeds = [_feed("f1", 0, 50.0)]
    cfg = FcrConfig(min_biomass_delta_kg=10.0)
    below = compute_fcr(feeds, _biomass(0, 0.0, "o"), _biomass(24, 5.0, "c"),
                        PERIOD_START, PERIOD_END, cfg, VERSION)  # Δ=5 <= 10
    assert below.fcr is None
    ok = compute_fcr(feeds, _biomass(0, 0.0, "o"), _biomass(24, 25.0, "c2"),
                     PERIOD_START, PERIOD_END, cfg, VERSION)  # Δ=25 > 10
    assert ok.fcr == pytest.approx(50.0 / 25.0)


# --- 3) quality_flag 제외 ----------------------------------------------------
def test_quality_flag_excluded():
    feeds = [
        _feed("f1", 0, 40.0, quality_flag="ok"),
        _feed("f2", 1, 999.0, quality_flag="bad"),      # 제외
        _feed("f3", 2, 999.0, quality_flag="suspect"),  # 제외(기본 included=('ok',))
    ]
    r = compute_fcr(feeds, _biomass(0, 0.0, "o"), _biomass(24, 20.0, "c"),
                    PERIOD_START, PERIOD_END, FcrConfig(), VERSION)
    assert r.total_feed_kg == pytest.approx(40.0)
    assert r.included_feed_count == 1
    assert r.excluded_feed_count == 2
    assert r.source_feed_refs == ("f1",)
    assert r.fcr == pytest.approx(40.0 / 20.0)


def test_included_quality_flags_configurable():
    feeds = [
        _feed("f1", 0, 40.0, quality_flag="ok"),
        _feed("f2", 1, 10.0, quality_flag="suspect"),
    ]
    cfg = FcrConfig(included_quality_flags=("ok", "suspect"))
    r = compute_fcr(feeds, _biomass(0, 0.0, "o"), _biomass(24, 20.0, "c"),
                    PERIOD_START, PERIOD_END, cfg, VERSION)
    assert r.total_feed_kg == pytest.approx(50.0)
    assert r.included_feed_count == 2


# --- 4) 기간 밖 제외 + 반열림 경계 ------------------------------------------
def test_out_of_period_excluded():
    before = FeedReading("b", "batch-1", PERIOD_START - timedelta(seconds=1), 111.0)
    after = FeedReading("a", "batch-1", PERIOD_END + timedelta(hours=1), 222.0)
    inside = _feed("in", 0, 10.0)
    r = compute_fcr([before, inside, after], _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    PERIOD_START, PERIOD_END, FcrConfig(), VERSION)
    assert r.total_feed_kg == pytest.approx(10.0)
    assert r.included_feed_count == 1
    assert r.excluded_feed_count == 2


def test_half_open_boundary_start_included_end_excluded():
    at_start = FeedReading("s", "batch-1", PERIOD_START, 7.0)   # 포함 (>= start)
    at_end = FeedReading("e", "batch-1", PERIOD_END, 13.0)      # 제외 (>= end)
    r = compute_fcr([at_start, at_end], _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    PERIOD_START, PERIOD_END, FcrConfig(), VERSION)
    assert r.total_feed_kg == pytest.approx(7.0)
    assert r.included_feed_count == 1
    assert r.excluded_feed_count == 1


# --- 5) source_feed_refs 정렬·중복제거 --------------------------------------
def test_source_feed_refs_sorted_deduped():
    feeds = [
        _feed("f3", 0, 10.0),
        _feed("f1", 1, 10.0),
        _feed("f1", 2, 10.0),  # 동일 ref 중복 → 1회로 dedup
        _feed("f2", 3, 10.0),
    ]
    r = compute_fcr(feeds, _biomass(0, 0.0, "o"), _biomass(24, 40.0, "c"),
                    PERIOD_START, PERIOD_END, FcrConfig(), VERSION)
    assert r.source_feed_refs == ("f1", "f2", "f3")
    assert r.total_feed_kg == pytest.approx(40.0)
    assert r.included_feed_count == 4  # 합산은 4건, refs 는 3개


# --- 6) 결정론 --------------------------------------------------------------
def test_determinism_same_input_same_result():
    feeds = [_feed("f2", 3, 20.0), _feed("f1", 1, 30.0), _feed("f2", 2, 30.0)]
    b0 = _biomass(0, 0.0, "o")
    b1 = _biomass(24, 40.0, "c")
    r1 = compute_fcr(feeds, b0, b1, PERIOD_START, PERIOD_END, FcrConfig(), VERSION)
    r2 = compute_fcr(feeds, b0, b1, PERIOD_START, PERIOD_END, FcrConfig(), VERSION)
    assert r1 == r2
    assert r1.source_feed_refs == ("f1", "f2")


# --- 7) 방어: 음수/비유한 feed_kg → ValueError ------------------------------
def test_negative_feed_kg_raises():
    feeds = [_feed("f1", 0, -5.0)]
    with pytest.raises(ValueError):
        compute_fcr(feeds, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    PERIOD_START, PERIOD_END, FcrConfig(), VERSION)


def test_nan_feed_kg_raises():
    feeds = [_feed("f1", 0, math.nan)]
    with pytest.raises(ValueError):
        compute_fcr(feeds, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    PERIOD_START, PERIOD_END, FcrConfig(), VERSION)


def test_inf_feed_kg_raises():
    feeds = [_feed("f1", 0, math.inf)]
    with pytest.raises(ValueError):
        compute_fcr(feeds, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    PERIOD_START, PERIOD_END, FcrConfig(), VERSION)


def test_excluded_bad_feed_negative_does_not_raise():
    # bad 로 제외되는 feed 의 음수/NaN 은 산출에 영향 없어야 한다(필터 후 검증).
    feeds = [
        _feed("f1", 0, 40.0, quality_flag="ok"),
        _feed("f2", 1, -999.0, quality_flag="bad"),
    ]
    r = compute_fcr(feeds, _biomass(0, 0.0, "o"), _biomass(24, 20.0, "c"),
                    PERIOD_START, PERIOD_END, FcrConfig(), VERSION)
    assert r.total_feed_kg == pytest.approx(40.0)
    assert r.excluded_feed_count == 1


def test_nonfinite_biomass_raises():
    feeds = [_feed("f1", 0, 40.0)]
    with pytest.raises(ValueError):
        compute_fcr(feeds, _biomass(0, math.nan, "o"), _biomass(24, 20.0, "c"),
                    PERIOD_START, PERIOD_END, FcrConfig(), VERSION)


def test_reversed_or_empty_period_raises():
    feeds = [_feed("f1", 0, 40.0)]
    with pytest.raises(ValueError):
        compute_fcr(feeds, _biomass(0, 0.0, "o"), _biomass(24, 20.0, "c"),
                    PERIOD_END, PERIOD_START, FcrConfig(), VERSION)
    with pytest.raises(ValueError):
        compute_fcr(feeds, _biomass(0, 0.0, "o"), _biomass(24, 20.0, "c"),
                    PERIOD_START, PERIOD_START, FcrConfig(), VERSION)


# --- 8) 빈 feed → 분자 0, Δ 유효 시 FCR = 0 ---------------------------------
def test_empty_feed_zero_numerator():
    r = compute_fcr([], _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    PERIOD_START, PERIOD_END, FcrConfig(), VERSION)
    assert r.total_feed_kg == 0.0
    assert r.fcr == 0.0
    assert r.source_feed_refs == ()


# --- 9) 결과 불변성(frozen) --------------------------------------------------
def test_result_is_frozen():
    r = compute_fcr([_feed("f1", 0, 40.0)], _biomass(0, 0.0, "o"), _biomass(24, 20.0, "c"),
                    PERIOD_START, PERIOD_END, FcrConfig(), VERSION)
    with pytest.raises(FrozenInstanceError):
        r.fcr = 1.0  # type: ignore[misc]
