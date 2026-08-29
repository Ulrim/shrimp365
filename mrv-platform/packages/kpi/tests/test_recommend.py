"""Unit tests for compute_recommendation (추천 엔진, phase-2 슬라이스 K).

경계조건: 정상 케이스 3종(feed/oxygen/circulation) 값+rationale 생성, 근거 부족 시 None,
결정론(동일 입력 2회 호출 시 rationale 문자열까지 동일), source_refs 채움, 방어(period 역전,
DO band 역전, 비유한/음수 값).
"""

from __future__ import annotations

import math
from dataclasses import FrozenInstanceError
from datetime import datetime, timedelta, timezone

import pytest

from culiver_kpi import (
    DoBand,
    DoReading,
    FeedReading,
    RecommendConfig,
    RecommendationInput,
    compute_recommendation,
)

UTC = timezone.utc
PERIOD_START = datetime(2026, 6, 1, 0, 0, 0, tzinfo=UTC)
PERIOD_END = datetime(2026, 6, 8, 0, 0, 0, tzinfo=UTC)
VERSION = "2026.2.0"
BAND = DoBand(do_min=5.0, do_max=8.0)


def _feed(ref: str, day: int, kg: float, quality_flag: str = "ok") -> FeedReading:
    return FeedReading(
        source_ref=ref, batch_id="batch-1",
        ts=datetime(2026, 6, day, 8, 0, 0, tzinfo=UTC),
        feed_kg=kg, quality_flag=quality_flag,
    )


def _do(meter_id: str, do_mg_l: float) -> DoReading:
    return DoReading(meter_id=meter_id, ts=PERIOD_START + timedelta(hours=1),
                      do_mg_l=do_mg_l, quality_flag="ok")


def _inputs(
    do_latest=None, water_temp_latest=None, biomass_latest_kg=None,
    feed_history=(), aeration_power_recent_kwh=0.0,
) -> RecommendationInput:
    return RecommendationInput(
        do_latest=do_latest,
        do_band=BAND,
        water_temp_latest=water_temp_latest,
        biomass_latest_kg=biomass_latest_kg,
        feed_history=feed_history,
        aeration_power_recent_kwh=aeration_power_recent_kwh,
        period_start=PERIOD_START,
        period_end=PERIOD_END,
    )


# --- 1) 정상 케이스: 3종 모두 값+rationale 생성 ------------------------------
def test_normal_case_all_three_recommendations():
    feed_history = [_feed("f1", 1, 10.0), _feed("f2", 2, 12.0)]  # 2일, 합 22 -> avg 11
    do_latest = _do("do1", 6.5)  # 중앙권(5.3~7.7 밖) -> normal 목표 유지
    inputs = _inputs(
        do_latest=do_latest, water_temp_latest=25.0, biomass_latest_kg=1000.0,
        feed_history=feed_history,
    )
    cfg = RecommendConfig()
    r = compute_recommendation(inputs, cfg, VERSION)

    # feed: recent_avg=11, target=1000*0.03=30, cap=11*0.05=0.55 -> 11.55
    assert r.feed_kg_per_day == pytest.approx(11.55)
    # oxygen: 중앙권 -> band 하한 유지
    assert r.oxygen_target_do_mg_l == pytest.approx(5.0)
    # circulation: 고수온 아님 + DO 중앙권 -> normal
    assert r.circulation_setting == "normal"
    assert "급이" in r.rationale and "산소" in r.rationale and "순환" in r.rationale
    assert r.source_refs["feed"] == ("f1", "f2")
    assert r.source_refs["do"] == ("do1",)
    assert r.config_version == VERSION


# --- 2) 근거 부족: feed_kg_per_day None (이력 없음) --------------------------
def test_feed_none_when_no_history():
    inputs = _inputs(biomass_latest_kg=1000.0, feed_history=[])
    r = compute_recommendation(inputs, RecommendConfig(), VERSION)
    assert r.feed_kg_per_day is None
    assert "이력이 없어" in r.rationale
    assert r.source_refs["feed"] == ()


# --- 2b) 근거 부족: feed_kg_per_day None (생체량 없음) -----------------------
def test_feed_none_when_no_biomass():
    inputs = _inputs(biomass_latest_kg=None, feed_history=[_feed("f1", 1, 10.0)])
    r = compute_recommendation(inputs, RecommendConfig(), VERSION)
    assert r.feed_kg_per_day is None
    assert "생체량" in r.rationale
    assert r.source_refs["feed"] == ("f1",)  # 근거 자체는 채워짐(참조 추적 유지)


# --- 3) 근거 부족: oxygen/circulation None (DO/수온 모두 없음) ---------------
def test_oxygen_and_circulation_none_when_no_do_or_temp():
    inputs = _inputs(do_latest=None, water_temp_latest=None)
    r = compute_recommendation(inputs, RecommendConfig(), VERSION)
    assert r.oxygen_target_do_mg_l is None
    assert r.circulation_setting is None
    assert r.source_refs["do"] == ()


# --- 4) DO 하한 근접 -> oxygen 상향, circulation 'increase' ------------------
def test_do_near_low_band_increases_oxygen_and_circulation():
    do_latest = _do("do1", 5.2)  # <= 5.0+0.3=5.3
    inputs = _inputs(do_latest=do_latest, water_temp_latest=25.0)
    r = compute_recommendation(inputs, RecommendConfig(), VERSION)
    assert r.oxygen_target_do_mg_l == pytest.approx(8.0)  # band.do_max
    assert r.circulation_setting == "increase"


# --- 5) DO 상한 근접 -> oxygen 대역 중앙, circulation 'reduce' ---------------
def test_do_near_high_band_reduces_oxygen_and_circulation():
    do_latest = _do("do1", 7.8)  # >= 8.0-0.3=7.7
    inputs = _inputs(do_latest=do_latest, water_temp_latest=25.0)
    r = compute_recommendation(inputs, RecommendConfig(), VERSION)
    assert r.oxygen_target_do_mg_l == pytest.approx(6.5)  # (5+8)/2
    assert r.circulation_setting == "reduce"


# --- 6) 고수온 -> circulation 'increase' (DO 상태 무관 최우선) ---------------
def test_high_water_temp_forces_circulation_increase():
    do_latest = _do("do1", 6.5)  # 중앙권(DO 로만 보면 normal)
    inputs = _inputs(do_latest=do_latest, water_temp_latest=31.0)
    r = compute_recommendation(inputs, RecommendConfig(), VERSION)
    assert r.circulation_setting == "increase"
    assert "고수온" in r.rationale


# --- 7) 결정론: 동일 입력 2회 호출 -> rationale 문자열까지 동일 --------------
def test_deterministic_including_rationale_text():
    feed_history = [_feed("f1", 1, 10.0), _feed("f2", 2, 12.0)]
    do_latest = _do("do1", 6.5)
    inputs = _inputs(
        do_latest=do_latest, water_temp_latest=25.0, biomass_latest_kg=1000.0,
        feed_history=feed_history,
    )
    cfg = RecommendConfig()
    r1 = compute_recommendation(inputs, cfg, VERSION)
    r2 = compute_recommendation(inputs, cfg, VERSION)
    assert r1 == r2
    assert r1.rationale == r2.rationale


# --- 8) 방어: period 역전 / DO band 역전 -------------------------------------
def test_reversed_period_raises():
    inputs = RecommendationInput(
        do_latest=None, do_band=BAND, water_temp_latest=None, biomass_latest_kg=None,
        feed_history=(), aeration_power_recent_kwh=0.0,
        period_start=PERIOD_END, period_end=PERIOD_START,
    )
    with pytest.raises(ValueError):
        compute_recommendation(inputs, RecommendConfig(), VERSION)


def test_reversed_do_band_raises():
    inputs = _inputs()
    bad_band_inputs = RecommendationInput(
        do_latest=inputs.do_latest, do_band=DoBand(do_min=8.0, do_max=5.0),
        water_temp_latest=None, biomass_latest_kg=None, feed_history=(),
        aeration_power_recent_kwh=0.0, period_start=PERIOD_START, period_end=PERIOD_END,
    )
    with pytest.raises(ValueError):
        compute_recommendation(bad_band_inputs, RecommendConfig(), VERSION)


def test_negative_feed_kg_raises():
    inputs = _inputs(biomass_latest_kg=1000.0, feed_history=[_feed("f1", 1, -5.0)])
    with pytest.raises(ValueError):
        compute_recommendation(inputs, RecommendConfig(), VERSION)


def test_nonfinite_do_raises():
    do_latest = DoReading(meter_id="do1", ts=PERIOD_START, do_mg_l=math.nan, quality_flag="ok")
    inputs = _inputs(do_latest=do_latest)
    with pytest.raises(ValueError):
        compute_recommendation(inputs, RecommendConfig(), VERSION)


# --- 9) 결과 불변성(frozen) --------------------------------------------------
def test_result_is_frozen():
    r = compute_recommendation(_inputs(), RecommendConfig(), VERSION)
    with pytest.raises(FrozenInstanceError):
        r.feed_kg_per_day = 1.0  # type: ignore[misc]
