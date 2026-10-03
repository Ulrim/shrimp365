"""Unit tests for compute_ei (EI 산식). sprint-0 3.1절 K2 수용 기준 전부 고정.

경계조건: 생산량 0/음수, quality_flag 제외, 기간 반열림 [start,end), aeration 부분집합,
결정론(동일 입력 2회 → 동일 결과), 비유한값(NaN/inf) 방어, 근거 추적 필드 정확성.
"""

from __future__ import annotations

import math
from dataclasses import FrozenInstanceError
from datetime import datetime, timedelta, timezone

import pytest

from culiver_kpi import (
    BiomassPoint,
    EiConfig,
    PowerReading,
    compute_ei,
)

UTC = timezone.utc
PERIOD_START = datetime(2026, 6, 1, 0, 0, 0, tzinfo=UTC)
PERIOD_END = datetime(2026, 6, 8, 0, 0, 0, tzinfo=UTC)  # 7일 기간, end 미포함
VERSION = "2026.1.0"


def _reading(meter_id: str, hours: int, kwh: float, is_aeration: bool = False,
             quality_flag: str = "ok") -> PowerReading:
    return PowerReading(
        meter_id=meter_id,
        ts=PERIOD_START + timedelta(hours=hours),
        kwh=kwh,
        is_aeration=is_aeration,
        quality_flag=quality_flag,
    )


def _biomass(hours: int, kg: float, ref: str) -> BiomassPoint:
    return BiomassPoint(ts=PERIOD_START + timedelta(hours=hours), biomass_kg=kg, source_ref=ref)


# --- 1) 정상 산출: ei_total / ei_aeration 값 검증 -----------------------------
def test_normal_computation_values():
    readings = [
        _reading("power-main", 0, 100.0, is_aeration=False),
        _reading("power-main", 1, 100.0, is_aeration=False),
        _reading("power-blower", 0, 40.0, is_aeration=True),
        _reading("power-blower", 1, 40.0, is_aeration=True),
    ]
    # total = 100+100+40+40 = 280, aeration = 40+40 = 80
    b0 = _biomass(0, 0.0, "harvest-open")
    b1 = _biomass(24, 56.0, "harvest-close")  # Δbiomass = 56
    result = compute_ei(readings, b0, b1, PERIOD_START, PERIOD_END, EiConfig(), VERSION)

    assert result.total_power_kwh == pytest.approx(280.0)
    assert result.aeration_power_kwh == pytest.approx(80.0)
    assert result.biomass_delta_kg == pytest.approx(56.0)
    assert result.ei_total == pytest.approx(280.0 / 56.0)      # 5.0 kWh/kg
    assert result.ei_aeration == pytest.approx(80.0 / 56.0)    # ~1.4286 kWh/kg
    assert result.included_reading_count == 4
    assert result.excluded_reading_count == 0
    assert result.source_meter_ids == ("power-blower", "power-main")  # 정렬·중복제거
    assert result.source_biomass_refs == ("harvest-open", "harvest-close")
    assert result.config_version == VERSION


# --- 2) 경계: biomass_delta = 0 → EI = None ----------------------------------
def test_zero_biomass_delta_yields_none():
    readings = [_reading("power-main", 0, 500.0)]
    b0 = _biomass(0, 1000.0, "open")
    b1 = _biomass(24, 1000.0, "close")  # Δ = 0
    result = compute_ei(readings, b0, b1, PERIOD_START, PERIOD_END, EiConfig(), VERSION)

    assert result.biomass_delta_kg == 0.0
    assert result.ei_total is None
    assert result.ei_aeration is None
    # 근거/중간값은 여전히 채워져야 한다(drill-down).
    assert result.total_power_kwh == pytest.approx(500.0)
    assert result.included_reading_count == 1


# --- 2b) 경계: biomass_delta 음수(생산량 감소) → EI = None --------------------
def test_negative_biomass_delta_yields_none():
    readings = [_reading("power-main", 0, 500.0)]
    b0 = _biomass(0, 1000.0, "open")
    b1 = _biomass(24, 900.0, "close")  # Δ = -100 (감소)
    result = compute_ei(readings, b0, b1, PERIOD_START, PERIOD_END, EiConfig(), VERSION)

    assert result.biomass_delta_kg == pytest.approx(-100.0)
    assert result.ei_total is None
    assert result.ei_aeration is None


# --- 2c) 경계: min_biomass_delta_kg 임계 미달 → None --------------------------
def test_below_min_biomass_delta_threshold_yields_none():
    readings = [_reading("power-main", 0, 500.0)]
    b0 = _biomass(0, 0.0, "open")
    b1 = _biomass(24, 5.0, "close")  # Δ = 5
    config = EiConfig(min_biomass_delta_kg=10.0)  # 5 <= 10 → 산출 불가
    result = compute_ei(readings, b0, b1, PERIOD_START, PERIOD_END, config, VERSION)

    assert result.ei_total is None
    # 임계보다 큰 Δ 이면 산출됨을 대비 확인
    b2 = _biomass(24, 20.0, "close2")  # Δ = 20 > 10
    ok = compute_ei(readings, b0, b2, PERIOD_START, PERIOD_END, config, VERSION)
    assert ok.ei_total == pytest.approx(500.0 / 20.0)


# --- 3) quality_flag 제외 (included 밖) ---------------------------------------
def test_quality_flag_bad_and_suspect_excluded():
    readings = [
        _reading("power-main", 0, 100.0, quality_flag="ok"),
        _reading("power-main", 1, 999.0, quality_flag="bad"),      # 제외
        _reading("power-main", 2, 999.0, quality_flag="suspect"),  # 제외(기본 included=('ok',))
    ]
    b0 = _biomass(0, 0.0, "open")
    b1 = _biomass(24, 10.0, "close")
    result = compute_ei(readings, b0, b1, PERIOD_START, PERIOD_END, EiConfig(), VERSION)

    assert result.total_power_kwh == pytest.approx(100.0)  # bad/suspect 미포함
    assert result.included_reading_count == 1
    assert result.excluded_reading_count == 2
    assert result.ei_total == pytest.approx(100.0 / 10.0)


def test_included_quality_flags_configurable():
    readings = [
        _reading("power-main", 0, 100.0, quality_flag="ok"),
        _reading("power-main", 1, 50.0, quality_flag="suspect"),
    ]
    b0 = _biomass(0, 0.0, "open")
    b1 = _biomass(24, 10.0, "close")
    config = EiConfig(included_quality_flags=("ok", "suspect"))  # suspect 도 포함
    result = compute_ei(readings, b0, b1, PERIOD_START, PERIOD_END, config, VERSION)

    assert result.total_power_kwh == pytest.approx(150.0)
    assert result.included_reading_count == 2


# --- 4) 기간 밖 제외 + 반열림 [start, end) 경계 -------------------------------
def test_out_of_period_readings_excluded():
    before = PowerReading("m", PERIOD_START - timedelta(seconds=1), 111.0, False, "ok")
    after = PowerReading("m", PERIOD_END + timedelta(hours=1), 222.0, False, "ok")
    inside = _reading("m", 0, 10.0)
    result = compute_ei([before, inside, after], _biomass(0, 0.0, "o"),
                        _biomass(24, 10.0, "c"), PERIOD_START, PERIOD_END, EiConfig(), VERSION)
    assert result.total_power_kwh == pytest.approx(10.0)
    assert result.included_reading_count == 1
    assert result.excluded_reading_count == 2


def test_half_open_boundary_start_included_end_excluded():
    at_start = PowerReading("m", PERIOD_START, 7.0, False, "ok")           # 포함 (>= start)
    at_end = PowerReading("m", PERIOD_END, 13.0, False, "ok")              # 제외 (>= end)
    result = compute_ei([at_start, at_end], _biomass(0, 0.0, "o"),
                        _biomass(24, 10.0, "c"), PERIOD_START, PERIOD_END, EiConfig(), VERSION)
    assert result.total_power_kwh == pytest.approx(7.0)
    assert result.included_reading_count == 1
    assert result.excluded_reading_count == 1


# --- 5) aeration 부분집합 합산 정확성 -----------------------------------------
def test_aeration_is_subset_of_total():
    readings = [
        _reading("main", 0, 200.0, is_aeration=False),
        _reading("blower", 0, 60.0, is_aeration=True),
        _reading("blower", 1, 60.0, is_aeration=True),
    ]
    result = compute_ei(readings, _biomass(0, 0.0, "o"), _biomass(24, 40.0, "c"),
                        PERIOD_START, PERIOD_END, EiConfig(), VERSION)
    # aeration(120) <= total(320)
    assert result.aeration_power_kwh == pytest.approx(120.0)
    assert result.total_power_kwh == pytest.approx(320.0)
    assert result.aeration_power_kwh <= result.total_power_kwh
    assert result.ei_aeration == pytest.approx(120.0 / 40.0)
    assert result.ei_total == pytest.approx(320.0 / 40.0)


def test_no_aeration_readings_yields_zero_aeration():
    readings = [_reading("main", 0, 100.0, is_aeration=False)]
    result = compute_ei(readings, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                        PERIOD_START, PERIOD_END, EiConfig(), VERSION)
    assert result.aeration_power_kwh == 0.0
    assert result.ei_aeration == 0.0  # 0/Δ = 0 (산출 가능, None 아님)
    assert result.ei_total == pytest.approx(10.0)


# --- 6) 결정론: 동일 입력 2회 호출 → 동일 EiResult ---------------------------
def test_determinism_same_input_same_result():
    readings = [
        _reading("b", 3, 40.0, is_aeration=True),
        _reading("a", 1, 100.0, is_aeration=False),
        _reading("b", 2, 40.0, is_aeration=True),
    ]
    b0 = _biomass(0, 0.0, "open")
    b1 = _biomass(24, 36.0, "close")
    r1 = compute_ei(readings, b0, b1, PERIOD_START, PERIOD_END, EiConfig(), VERSION)
    r2 = compute_ei(readings, b0, b1, PERIOD_START, PERIOD_END, EiConfig(), VERSION)
    assert r1 == r2  # frozen dataclass 동등성
    # 입력 순서가 섞여 있어도 source_meter_ids 는 정렬되어 결정론적
    assert r1.source_meter_ids == ("a", "b")


# --- 7) 비유한값(NaN/inf) 방어 + 빈 기간 방어 --------------------------------
def test_nan_kwh_in_included_reading_raises():
    readings = [_reading("m", 0, math.nan)]
    with pytest.raises(ValueError):
        compute_ei(readings, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                   PERIOD_START, PERIOD_END, EiConfig(), VERSION)


def test_inf_kwh_in_included_reading_raises():
    readings = [_reading("m", 0, math.inf)]
    with pytest.raises(ValueError):
        compute_ei(readings, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                   PERIOD_START, PERIOD_END, EiConfig(), VERSION)


def test_nan_kwh_but_excluded_does_not_raise():
    # bad 로 제외되는 reading 의 NaN 은 산출에 영향 없어야 한다(방어 우선순위: 필터 후 검증).
    readings = [
        _reading("m", 0, 100.0, quality_flag="ok"),
        _reading("m", 1, math.nan, quality_flag="bad"),
    ]
    result = compute_ei(readings, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                        PERIOD_START, PERIOD_END, EiConfig(), VERSION)
    assert result.total_power_kwh == pytest.approx(100.0)
    assert result.excluded_reading_count == 1


def test_nonfinite_biomass_raises():
    readings = [_reading("m", 0, 100.0)]
    with pytest.raises(ValueError):
        compute_ei(readings, _biomass(0, math.nan, "o"), _biomass(24, 10.0, "c"),
                   PERIOD_START, PERIOD_END, EiConfig(), VERSION)


def test_reversed_or_empty_period_raises():
    readings = [_reading("m", 0, 100.0)]
    with pytest.raises(ValueError):
        compute_ei(readings, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                   PERIOD_END, PERIOD_START, EiConfig(), VERSION)  # start > end
    with pytest.raises(ValueError):
        compute_ei(readings, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                   PERIOD_START, PERIOD_START, EiConfig(), VERSION)  # start == end


# --- 8) 빈 readings → 분자 0, EI 는 Δ 유효 시 0 -------------------------------
def test_empty_readings_zero_numerator():
    result = compute_ei([], _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                        PERIOD_START, PERIOD_END, EiConfig(), VERSION)
    assert result.total_power_kwh == 0.0
    assert result.ei_total == 0.0
    assert result.included_reading_count == 0
    assert result.source_meter_ids == ()


# --- 9) 결과 불변성(frozen) 확인 ---------------------------------------------
def test_result_is_frozen():
    result = compute_ei([_reading("m", 0, 100.0)], _biomass(0, 0.0, "o"),
                        _biomass(24, 10.0, "c"), PERIOD_START, PERIOD_END, EiConfig(), VERSION)
    with pytest.raises(FrozenInstanceError):
        result.ei_total = 1.0  # type: ignore[misc]
