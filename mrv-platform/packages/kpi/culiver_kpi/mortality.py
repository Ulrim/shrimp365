"""Mortality Rate (폐사율) — MASTER 3.2 ④ 산식 구현.

폐사율(%) = (기간 내 폐사 개체수 / 기초 입식 개체수) × 100
누적 폐사율 / 일일 폐사율 / 7일 이동평균 모두 산출한다. 낮을수록 우수.

★ 이 모듈은 산식의 단일 진실 공급원이다(Rule 1). API/FE 어디에도 산식을 중복하지 말 것.
순수·결정론(Rule 6): 동일 입력 → 동일 출력. now()/난수/외부 상태 금지.
일/7일 시계열은 UTC 일 경계로 버킷팅한다(kpi_service 가 ts 를 UTC 정규화해 전달, phase-1 1.3).
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from typing import Sequence

from .types import (
    DailyMortality,
    MortalityConfig,
    MortalityReading,
    MortalityResult,
    MovingAvgPoint,
)


def _utc_date(ts: datetime) -> date:
    """계측 시각 → UTC 기준 일자. 결정론적 버킷팅(tz-aware 는 UTC 로 환산).

    입력 전제(phase-1 1.3): 서비스가 ts 를 UTC 로 정규화해 전달한다. tz-aware 면 UTC 로
    환산 후 date 를 취하고, naive 면 이미 UTC 로 간주해 그대로 date 를 취한다.
    """
    if ts.tzinfo is not None:
        return ts.astimezone(timezone.utc).date()
    return ts.date()


def _in_period(ts: datetime, period_start: datetime, period_end: datetime) -> bool:
    """기간 [period_start, period_end) 반열림 판정(end 미포함)."""
    return period_start <= ts < period_end


def compute_mortality(
    mortality_readings: Sequence[MortalityReading],
    stocked_count: int,
    period_start: datetime,
    period_end: datetime,
    config: MortalityConfig,
    config_version: str,
) -> MortalityResult:
    """MASTER 3.2 ④ (폐사율). 순수·결정론.

    규칙:
      - [period_start, period_end) 밖 record 는 제외.
      - cumulative_rate_pct = Σdead / stocked_count * 100.
      - stocked_count <= 0 → 모든 rate(cumulative/daily/ma) = None(0 나눗셈 방지).
      - daily: UTC 일 버킷 dead_count 합 → daily_rate_pct(일자 오름차순).
      - moving_avg: 각 daily 일자에서 최근 window_days(캘린더 일) daily_rate 평균.
        버킷이 없는 캘린더 일은 dead=0(rate=0)으로 간주 → 결정론적.

    방어(데이터 정합):
      - dead_count 음수/비유한 → ValueError(폐사 개체수는 음수일 수 없음).
      - stocked_count 음수 → ValueError. (0 은 '산출 불가'로 None 처리, 오류 아님)
      - moving_avg_window_days < 1 → ValueError.
      - period_start >= period_end → ValueError(빈/역전 기간).
    """
    if period_start >= period_end:
        raise ValueError(
            f"period_start must be strictly before period_end: {period_start!r} >= {period_end!r}"
        )
    if stocked_count < 0:
        raise ValueError(f"stocked_count must be >= 0, got {stocked_count!r}")
    window_days = config.moving_avg_window_days
    if window_days < 1:
        raise ValueError(f"moving_avg_window_days must be >= 1, got {window_days!r}")

    # UTC 일 버킷: date → dead_count 합. 결정론적(dict 조회는 순서 무관).
    daily_bucket: dict[date, int] = {}
    total_dead_count = 0
    included_refs: set[str] = set()

    for reading in mortality_readings:
        if not _in_period(reading.ts, period_start, period_end):
            continue
        dc = reading.dead_count
        # 비유한 방어(float 로 잘못 전달된 NaN/inf 도 차단).
        if isinstance(dc, float) and not math.isfinite(dc):
            raise ValueError(
                f"dead_count must be finite: source_ref={reading.source_ref!r} "
                f"ts={reading.ts!r} dead_count={dc!r}"
            )
        if dc < 0:
            raise ValueError(
                f"dead_count must be >= 0 (physically impossible negative): "
                f"source_ref={reading.source_ref!r} ts={reading.ts!r} dead_count={dc!r}"
            )
        bucket_date = _utc_date(reading.ts)
        daily_bucket[bucket_date] = daily_bucket.get(bucket_date, 0) + dc
        total_dead_count += dc
        included_refs.add(reading.source_ref)

    have_stock = stocked_count > 0

    # --- 누적 폐사율 ---
    if have_stock:
        cumulative_rate_pct: float | None = total_dead_count / stocked_count * 100.0
    else:
        cumulative_rate_pct = None

    # --- 일일 시계열(일자 오름차순) ---
    sorted_dates = sorted(daily_bucket.keys())
    daily: list[DailyMortality] = []
    for d in sorted_dates:
        dead = daily_bucket[d]
        rate = (dead / stocked_count * 100.0) if have_stock else None
        daily.append(DailyMortality(date=d, dead_count=dead, daily_rate_pct=rate))

    # --- 7일(창) 이동평균: 각 daily 일자에서 최근 window_days 캘린더 일 daily_rate 평균 ---
    # 평균(daily_rate over window) = (Σ window dead / stocked * 100) / window_days.
    # 버킷 없는 캘린더 일은 dead=0 → daily_bucket.get(..., 0) 로 결정론적으로 처리.
    moving_avg: list[MovingAvgPoint] = []
    for d in sorted_dates:
        if not have_stock:
            moving_avg.append(MovingAvgPoint(date=d, ma_rate_pct=None))
            continue
        window_dead = 0
        for k in range(window_days):
            window_dead += daily_bucket.get(d - timedelta(days=k), 0)
        ma_rate = (window_dead / stocked_count * 100.0) / window_days
        moving_avg.append(MovingAvgPoint(date=d, ma_rate_pct=ma_rate))

    source_refs = tuple(sorted(included_refs))

    return MortalityResult(
        cumulative_rate_pct=cumulative_rate_pct,
        total_dead_count=total_dead_count,
        stocked_count=stocked_count,
        daily=tuple(daily),
        moving_avg=tuple(moving_avg),
        period_start=period_start,
        period_end=period_end,
        source_refs=source_refs,
        config_version=config_version,
    )
