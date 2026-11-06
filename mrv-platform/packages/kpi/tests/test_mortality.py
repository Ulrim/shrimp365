"""Unit tests for compute_mortality (폐사율, MASTER 3.2 ④). phase-1 슬라이스 B 고정.

경계조건: 누적률 정상, stocked=0 → None, UTC 일 버킷 정확, 7일 이동평균 결정론,
음수 dead_count/stocked 방어, 기간 밖 제외, 기간역전 방어, source_refs 정렬·중복제거.
"""

from __future__ import annotations

from dataclasses import FrozenInstanceError
from datetime import date, datetime, timezone

import pytest

from culiver_kpi import MortalityConfig, MortalityReading, compute_mortality

UTC = timezone.utc
PERIOD_START = datetime(2026, 6, 1, 0, 0, 0, tzinfo=UTC)
PERIOD_END = datetime(2026, 6, 8, 0, 0, 0, tzinfo=UTC)  # 7일, end 미포함
VERSION = "2026.1.0"


def _m(ref: str, day: int, hour: int, dead: int, batch_id: str = "batch-1") -> MortalityReading:
    return MortalityReading(
        source_ref=ref,
        batch_id=batch_id,
        ts=datetime(2026, 6, day, hour, 0, 0, tzinfo=UTC),
        dead_count=dead,
    )


# --- 1) 누적 폐사율 정상 -----------------------------------------------------
def test_cumulative_rate_normal():
    readings = [_m("r1", 1, 0, 10), _m("r2", 2, 0, 20), _m("r3", 4, 0, 5)]
    r = compute_mortality(readings, 1000, PERIOD_START, PERIOD_END, MortalityConfig(), VERSION)
    assert r.total_dead_count == 35
    assert r.stocked_count == 1000
    assert r.cumulative_rate_pct == pytest.approx(3.5)  # 35/1000*100
    assert r.source_refs == ("r1", "r2", "r3")
    assert r.config_version == VERSION


# --- 2) 경계: stocked = 0 → 모든 rate None ----------------------------------
def test_stocked_zero_yields_none_rates():
    readings = [_m("r1", 1, 0, 10)]
    r = compute_mortality(readings, 0, PERIOD_START, PERIOD_END, MortalityConfig(), VERSION)
    assert r.cumulative_rate_pct is None
    assert r.total_dead_count == 10          # 근거(개수)는 여전히 채워짐
    assert len(r.daily) == 1
    assert r.daily[0].dead_count == 10
    assert r.daily[0].daily_rate_pct is None
    assert r.moving_avg[0].ma_rate_pct is None


# --- 3) UTC 일 버킷 정확성 ---------------------------------------------------
def test_daily_bucketing_utc():
    # 같은 날(06-01) 두 기록 합산, 06-02 별도 버킷.
    readings = [
        _m("a", 1, 1, 4),
        _m("b", 1, 23, 6),   # 같은 UTC 일(06-01) → 합산 10
        _m("c", 2, 12, 20),  # 06-02
    ]
    r = compute_mortality(readings, 1000, PERIOD_START, PERIOD_END, MortalityConfig(), VERSION)
    assert [d.date for d in r.daily] == [date(2026, 6, 1), date(2026, 6, 2)]
    assert [d.dead_count for d in r.daily] == [10, 20]
    assert r.daily[0].daily_rate_pct == pytest.approx(1.0)   # 10/1000*100
    assert r.daily[1].daily_rate_pct == pytest.approx(2.0)   # 20/1000*100


# --- 4) 7일 이동평균 결정론 + 값 검증 ---------------------------------------
def test_moving_average_values_and_determinism():
    # 06-01:10, 06-02:20, 06-04:5 (06-03 결측 → 0)
    readings = [_m("r1", 1, 0, 10), _m("r2", 2, 0, 20), _m("r3", 4, 0, 5)]
    cfg = MortalityConfig(moving_avg_window_days=7)
    r1 = compute_mortality(readings, 1000, PERIOD_START, PERIOD_END, cfg, VERSION)
    r2 = compute_mortality(list(reversed(readings)), 1000, PERIOD_START, PERIOD_END, cfg, VERSION)
    assert r1 == r2  # 입력 순서 무관 → 결정론

    ma = {p.date: p.ma_rate_pct for p in r1.moving_avg}
    # 각 일자에서 최근 7일 daily_rate 평균 = (Σ7일 dead / stocked *100) / 7
    assert ma[date(2026, 6, 1)] == pytest.approx(1.0 / 7)   # dead 10
    assert ma[date(2026, 6, 2)] == pytest.approx(3.0 / 7)   # dead 10+20=30
    assert ma[date(2026, 6, 4)] == pytest.approx(3.5 / 7)   # dead 10+20+5=35
    # moving_avg 일자축은 daily 와 동일
    assert [p.date for p in r1.moving_avg] == [d.date for d in r1.daily]


def test_moving_average_window_size_effect():
    # 창=1 이면 MA = 당일 daily_rate
    readings = [_m("r1", 1, 0, 10), _m("r2", 2, 0, 20)]
    cfg1 = MortalityConfig(moving_avg_window_days=1)
    r = compute_mortality(readings, 1000, PERIOD_START, PERIOD_END, cfg1, VERSION)
    ma = {p.date: p.ma_rate_pct for p in r.moving_avg}
    assert ma[date(2026, 6, 1)] == pytest.approx(1.0)   # 10/1000*100 / 1
    assert ma[date(2026, 6, 2)] == pytest.approx(2.0)


# --- 5) 기간 밖 제외 + 반열림 경계 ------------------------------------------
def test_out_of_period_excluded():
    before = MortalityReading("b", "batch-1", datetime(2026, 5, 31, 23, tzinfo=UTC), 100)
    at_start = MortalityReading("s", "batch-1", PERIOD_START, 3)          # 포함(>=start)
    at_end = MortalityReading("e", "batch-1", PERIOD_END, 7)              # 제외(>=end)
    r = compute_mortality([before, at_start, at_end], 1000, PERIOD_START, PERIOD_END,
                          MortalityConfig(), VERSION)
    assert r.total_dead_count == 3
    assert r.source_refs == ("s",)
    assert len(r.daily) == 1


# --- 6) 방어: 음수 dead_count → ValueError ----------------------------------
def test_negative_dead_count_raises():
    readings = [_m("r1", 1, 0, -5)]
    with pytest.raises(ValueError):
        compute_mortality(readings, 1000, PERIOD_START, PERIOD_END, MortalityConfig(), VERSION)


def test_excluded_negative_dead_count_does_not_raise():
    # 기간 밖 음수는 산출 전에 제외되므로 오류가 아니다(필터 후 검증).
    out = MortalityReading("x", "batch-1", datetime(2026, 5, 1, tzinfo=UTC), -999)
    inside = _m("r1", 1, 0, 10)
    r = compute_mortality([out, inside], 1000, PERIOD_START, PERIOD_END,
                          MortalityConfig(), VERSION)
    assert r.total_dead_count == 10


# --- 7) 방어: 음수 stocked / 잘못된 창 / 기간역전 → ValueError ---------------
def test_negative_stocked_raises():
    readings = [_m("r1", 1, 0, 10)]
    with pytest.raises(ValueError):
        compute_mortality(readings, -1, PERIOD_START, PERIOD_END, MortalityConfig(), VERSION)


def test_window_less_than_one_raises():
    readings = [_m("r1", 1, 0, 10)]
    with pytest.raises(ValueError):
        compute_mortality(readings, 1000, PERIOD_START, PERIOD_END,
                          MortalityConfig(moving_avg_window_days=0), VERSION)


def test_reversed_or_empty_period_raises():
    readings = [_m("r1", 1, 0, 10)]
    with pytest.raises(ValueError):
        compute_mortality(readings, 1000, PERIOD_END, PERIOD_START, MortalityConfig(), VERSION)
    with pytest.raises(ValueError):
        compute_mortality(readings, 1000, PERIOD_START, PERIOD_START, MortalityConfig(), VERSION)


# --- 8) source_refs 정렬·중복제거 -------------------------------------------
def test_source_refs_sorted_deduped():
    readings = [_m("r3", 1, 0, 1), _m("r1", 2, 0, 1), _m("r1", 3, 0, 1), _m("r2", 4, 0, 1)]
    r = compute_mortality(readings, 1000, PERIOD_START, PERIOD_END, MortalityConfig(), VERSION)
    assert r.source_refs == ("r1", "r2", "r3")


# --- 9) 빈 readings → 누적 0%, daily 비어있음 -------------------------------
def test_empty_readings():
    r = compute_mortality([], 1000, PERIOD_START, PERIOD_END, MortalityConfig(), VERSION)
    assert r.total_dead_count == 0
    assert r.cumulative_rate_pct == pytest.approx(0.0)
    assert r.daily == ()
    assert r.moving_avg == ()
    assert r.source_refs == ()


# --- 10) 결과 불변성(frozen) -------------------------------------------------
def test_result_is_frozen():
    r = compute_mortality([_m("r1", 1, 0, 10)], 1000, PERIOD_START, PERIOD_END,
                          MortalityConfig(), VERSION)
    with pytest.raises(FrozenInstanceError):
        r.cumulative_rate_pct = 1.0  # type: ignore[misc]
