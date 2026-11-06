"""Unit tests for compute_oei (OEI 산식, MASTER 3.2 ②, ADR 0003). phase-1 슬라이스 D 고정.

경계조건: 유효 DO 0, aeration_kwh=0, biomass_delta<=min → None. in_band_fraction 정확성,
scale_factor/clamp 적용, band 역전·비유한·기간역전 방어, 결정론, source ids 정렬·중복제거.
"""

from __future__ import annotations

import math
from dataclasses import FrozenInstanceError
from datetime import datetime, timedelta, timezone

import pytest

from culiver_kpi import (
    BiomassPoint,
    DoBand,
    DoReading,
    OeiConfig,
    PowerReading,
    compute_oei,
)

UTC = timezone.utc
PERIOD_START = datetime(2026, 6, 1, 0, 0, 0, tzinfo=UTC)
PERIOD_END = datetime(2026, 6, 8, 0, 0, 0, tzinfo=UTC)
VERSION = "2026.1.0"
BAND = DoBand(do_min=5.0, do_max=8.0)


def _do(meter_id: str, hours: int, do_mg_l: float, quality_flag: str = "ok") -> DoReading:
    return DoReading(
        meter_id=meter_id,
        ts=PERIOD_START + timedelta(hours=hours),
        do_mg_l=do_mg_l,
        quality_flag=quality_flag,
    )


def _aer(meter_id: str, hours: int, kwh: float, is_aeration: bool = True,
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


# --- 1) 정상 산출 + in_band_fraction 정확 -----------------------------------
def test_normal_computation_values():
    # 10 유효 샘플 중 8개 대역 내(5<=do<=8) → fraction 0.8
    do = (
        [_do("do1", h, 6.0) for h in range(8)]        # 8 in band
        + [_do("do1", 8, 4.0), _do("do1", 9, 9.0)]    # 2 out of band (유효)
    )
    aeration = [_aer("blow", 0, 20.0), _aer("blow", 1, 20.0)]  # 40 kWh
    b0 = _biomass(0, 0.0, "o")
    b1 = _biomass(24, 50.0, "c")  # Δ = 50
    r = compute_oei(do, aeration, b0, b1, BAND, PERIOD_START, PERIOD_END, OeiConfig(), VERSION)

    assert r.do_total_samples == 10
    assert r.do_in_band_samples == 8
    assert r.do_in_band_fraction == pytest.approx(0.8)
    assert r.aeration_power_kwh == pytest.approx(40.0)
    assert r.biomass_delta_kg == pytest.approx(50.0)
    # oei_raw = 0.8 / (40/50) = 0.8 * 50 / 40 = 1.0
    assert r.oei_raw == pytest.approx(1.0)
    assert r.oei == pytest.approx(1.0)          # scale_factor 기본 1.0
    assert r.scale_factor == pytest.approx(1.0)
    assert r.method == "sample_count"
    assert r.band_min == 5.0 and r.band_max == 8.0
    assert r.source_do_meter_ids == ("do1",)
    assert r.source_aeration_meter_ids == ("blow",)
    assert r.source_biomass_refs == ("o", "c")
    assert r.config_version == VERSION


# --- 1b) 대역 경계 포함(inclusive) ------------------------------------------
def test_band_boundaries_inclusive():
    do = [
        _do("d", 0, 5.0),   # 하한 = 포함
        _do("d", 1, 8.0),   # 상한 = 포함
        _do("d", 2, 4.999),  # 하한 미만 = 제외
        _do("d", 3, 8.001),  # 상한 초과 = 제외
    ]
    aeration = [_aer("b", 0, 10.0)]
    r = compute_oei(do, aeration, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    BAND, PERIOD_START, PERIOD_END, OeiConfig(), VERSION)
    assert r.do_total_samples == 4
    assert r.do_in_band_samples == 2
    assert r.do_in_band_fraction == pytest.approx(0.5)


# --- 2) 경계: 유효 DO 0 → None ----------------------------------------------
def test_no_valid_do_samples_yields_none():
    do = [_do("d", 0, 6.0, quality_flag="bad"), _do("d", 1, 7.0, quality_flag="suspect")]
    aeration = [_aer("b", 0, 10.0)]
    r = compute_oei(do, aeration, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    BAND, PERIOD_START, PERIOD_END, OeiConfig(), VERSION)
    assert r.do_total_samples == 0
    assert r.do_excluded_samples == 2
    assert r.do_in_band_fraction is None
    assert r.oei is None
    assert r.oei_raw is None


def test_empty_do_yields_none():
    r = compute_oei([], [_aer("b", 0, 10.0)], _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    BAND, PERIOD_START, PERIOD_END, OeiConfig(), VERSION)
    assert r.do_total_samples == 0
    assert r.oei is None


# --- 3) 경계: aeration_kwh = 0 → None ---------------------------------------
def test_zero_aeration_yields_none():
    do = [_do("d", 0, 6.0)]
    # is_aeration=False 뿐이면 폭기 전력 0 → 분모 정의 불가
    aeration = [_aer("main", 0, 100.0, is_aeration=False)]
    r = compute_oei(do, aeration, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    BAND, PERIOD_START, PERIOD_END, OeiConfig(), VERSION)
    assert r.aeration_power_kwh == 0.0
    assert r.do_in_band_fraction == pytest.approx(1.0)  # 유지율은 산출됨
    assert r.oei is None                                 # 그러나 OEI 는 불가


def test_empty_aeration_yields_none():
    do = [_do("d", 0, 6.0)]
    r = compute_oei(do, [], _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    BAND, PERIOD_START, PERIOD_END, OeiConfig(), VERSION)
    assert r.aeration_power_kwh == 0.0
    assert r.oei is None


# --- 4) 경계: biomass_delta <= min → None -----------------------------------
def test_zero_biomass_delta_yields_none():
    do = [_do("d", 0, 6.0)]
    aeration = [_aer("b", 0, 10.0)]
    r = compute_oei(do, aeration, _biomass(0, 100.0, "o"), _biomass(24, 100.0, "c"),
                    BAND, PERIOD_START, PERIOD_END, OeiConfig(), VERSION)
    assert r.biomass_delta_kg == 0.0
    assert r.oei is None


def test_below_min_biomass_yields_none():
    do = [_do("d", 0, 6.0)]
    aeration = [_aer("b", 0, 10.0)]
    cfg = OeiConfig(min_biomass_kg=10.0)
    r = compute_oei(do, aeration, _biomass(0, 0.0, "o"), _biomass(24, 5.0, "c"),
                    BAND, PERIOD_START, PERIOD_END, cfg, VERSION)  # Δ=5 <= 10
    assert r.oei is None


# --- 5) scale_factor / clamp 적용 -------------------------------------------
def test_scale_factor_applied():
    do = [_do("d", h, 6.0) for h in range(10)]  # 10/10 in band → fraction 1.0
    aeration = [_aer("b", 0, 40.0)]
    b0, b1 = _biomass(0, 0.0, "o"), _biomass(24, 40.0, "c")  # Δ=40
    # oei_raw = 1.0 * 40 / 40 = 1.0 ; scale 50 → 50
    cfg = OeiConfig(oei_scale_factor=50.0)
    r = compute_oei(do, aeration, b0, b1, BAND, PERIOD_START, PERIOD_END, cfg, VERSION)
    assert r.oei_raw == pytest.approx(1.0)
    assert r.scale_factor == pytest.approx(50.0)
    assert r.oei == pytest.approx(50.0)


def test_clamp_max_applied():
    do = [_do("d", h, 6.0) for h in range(10)]
    aeration = [_aer("b", 0, 40.0)]
    b0, b1 = _biomass(0, 0.0, "o"), _biomass(24, 40.0, "c")
    # oei_raw = 1.0 ; scale 200 → 200 → clamp 100
    cfg = OeiConfig(oei_scale_factor=200.0, clamp_max=100.0)
    r = compute_oei(do, aeration, b0, b1, BAND, PERIOD_START, PERIOD_END, cfg, VERSION)
    assert r.oei_raw == pytest.approx(1.0)
    assert r.oei == pytest.approx(100.0)  # clamp 상한
    # oei_raw 는 스케일 전 원값으로 clamp 영향 없음(검증 추적)
    assert r.oei_raw < r.oei


# --- 6) 기간 밖 제외 + 반열림 경계 ------------------------------------------
def test_out_of_period_and_half_open():
    do = [
        DoReading("d", PERIOD_START - timedelta(seconds=1), 6.0, "ok"),  # before → 제외
        DoReading("d", PERIOD_START, 6.0, "ok"),                          # 포함(>=start)
        DoReading("d", PERIOD_END, 6.0, "ok"),                            # 제외(>=end)
    ]
    aeration = [_aer("b", 0, 10.0)]
    r = compute_oei(do, aeration, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    BAND, PERIOD_START, PERIOD_END, OeiConfig(), VERSION)
    assert r.do_total_samples == 1
    assert r.do_excluded_samples == 2


# --- 7) 방어: band 역전/동일 → ValueError -----------------------------------
def test_band_reversed_raises():
    do = [_do("d", 0, 6.0)]
    aeration = [_aer("b", 0, 10.0)]
    with pytest.raises(ValueError):
        compute_oei(do, aeration, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    DoBand(do_min=8.0, do_max=5.0), PERIOD_START, PERIOD_END, OeiConfig(), VERSION)
    with pytest.raises(ValueError):
        compute_oei(do, aeration, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    DoBand(do_min=5.0, do_max=5.0), PERIOD_START, PERIOD_END, OeiConfig(), VERSION)


def test_nonfinite_band_raises():
    do = [_do("d", 0, 6.0)]
    aeration = [_aer("b", 0, 10.0)]
    with pytest.raises(ValueError):
        compute_oei(do, aeration, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    DoBand(do_min=math.nan, do_max=8.0), PERIOD_START, PERIOD_END,
                    OeiConfig(), VERSION)


def test_nonfinite_do_raises():
    do = [_do("d", 0, math.nan)]
    aeration = [_aer("b", 0, 10.0)]
    with pytest.raises(ValueError):
        compute_oei(do, aeration, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    BAND, PERIOD_START, PERIOD_END, OeiConfig(), VERSION)


def test_nonfinite_aeration_kwh_raises():
    do = [_do("d", 0, 6.0)]
    aeration = [_aer("b", 0, math.inf)]
    with pytest.raises(ValueError):
        compute_oei(do, aeration, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    BAND, PERIOD_START, PERIOD_END, OeiConfig(), VERSION)


def test_reversed_or_empty_period_raises():
    do = [_do("d", 0, 6.0)]
    aeration = [_aer("b", 0, 10.0)]
    with pytest.raises(ValueError):
        compute_oei(do, aeration, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    BAND, PERIOD_END, PERIOD_START, OeiConfig(), VERSION)
    with pytest.raises(ValueError):
        compute_oei(do, aeration, _biomass(0, 0.0, "o"), _biomass(24, 10.0, "c"),
                    BAND, PERIOD_START, PERIOD_START, OeiConfig(), VERSION)


# --- 8) 결정론 + source ids 정렬·중복제거 -----------------------------------
def test_determinism_and_sorted_sources():
    do = [_do("do2", 3, 6.0), _do("do1", 1, 6.0), _do("do2", 2, 6.0)]
    aeration = [_aer("bB", 3, 20.0), _aer("bA", 1, 20.0)]
    b0, b1 = _biomass(0, 0.0, "o"), _biomass(24, 40.0, "c")
    cfg = OeiConfig(oei_scale_factor=10.0)
    r1 = compute_oei(do, aeration, b0, b1, BAND, PERIOD_START, PERIOD_END, cfg, VERSION)
    r2 = compute_oei(do, aeration, b0, b1, BAND, PERIOD_START, PERIOD_END, cfg, VERSION)
    assert r1 == r2
    assert r1.source_do_meter_ids == ("do1", "do2")
    assert r1.source_aeration_meter_ids == ("bA", "bB")


# --- 9) 결과 불변성(frozen) --------------------------------------------------
def test_result_is_frozen():
    r = compute_oei([_do("d", 0, 6.0)], [_aer("b", 0, 10.0)], _biomass(0, 0.0, "o"),
                    _biomass(24, 10.0, "c"), BAND, PERIOD_START, PERIOD_END, OeiConfig(), VERSION)
    with pytest.raises(FrozenInstanceError):
        r.oei = 1.0  # type: ignore[misc]
