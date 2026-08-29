"""추천(운전 레시피) 엔진 — MASTER 3.2 하단 "추천 로직", phase-2 슬라이스 K.

급이(feed)·산소(oxygen)·순환(circulation) 3종 룰 기반 추천을 산출한다. architect(phase-2.md
2.2절)는 입출력 형태(`RecommendationInput`/`RecommendationOutput`/`compute_recommendation`
시그니처)만 못 박았고, 판정 규칙(어떤 조건에 어떤 값을 권장하는지)은 이 모듈에서
data-kpi-engineer 가 확정한다.

★ 이 모듈은 추천 산식의 단일 진실 공급원이다(Rule 1). 다른 곳에 판정 로직을 중복하지 말 것.
순수·결정론(Rule 6): 동일 입력 → 동일 출력(rationale 문자열까지 동일). now()/난수 금지.
근거 부족 시에도 에러 없이 값=None + rationale 사유로 반환(대시보드 "추천 불가" 표시용).

--- 판정 규칙 요약(잠정, 실증 튜닝 대상 — RecommendConfig 로 파라미터화, Rule 2 버전 관리) ---

1) 급이(feed_kg_per_day):
   - 필요 근거: feed_history(기간 내 quality_flag 포함분 1건 이상) + biomass_latest_kg(>0).
     둘 중 하나라도 없으면 None(사유: "이력 없음"/"생체량 없음").
   - recent_avg_feed_kg_per_day = Σ(포함 feed_kg) / 포함된 서로 다른 UTC 일수
     (feed.py/mortality.py 와 동일 반열림+quality_flag 필터 규약 재사용).
   - target_feed_kg = biomass_latest_kg * config.target_feed_rate_pct_of_biomass.
   - 최근 평균에서 목표 방향으로 이동하되, 1회 조정폭을 recent_avg 의
     ±config.max_feed_adjustment_ratio 로 제한(급격한 변경 방지 — 실무적 안전장치).
   - feed_kg_per_day = recent_avg + clamp(target - recent_avg, -cap, +cap).

2) 산소(oxygen_target_do_mg_l):
   - 필요 근거: do_latest 존재. 없으면 None(사유: "DO 계측값 없음").
   - do_latest.do_mg_l <= do_band.do_min + margin_low  → 목표를 do_band.do_max 로 상향
     (하한 근접 = 위험, 여유 확보를 위해 목표를 상단으로 올려 폭기 강화 유도).
   - do_latest.do_mg_l >= do_band.do_max - margin_high → 목표를 대역 중앙으로 하향
     (상한 근접 = 과폭기 가능성, 에너지 절감 위해 목표를 낮춤).
   - 그 외(대역 중앙권) → 목표를 대역 하한으로 유지(불필요한 과폭기 방지, 최소 안전선 유지).

3) 순환(circulation_setting): 'normal' | 'increase' | 'reduce'.
   - 필요 근거: water_temp_latest 또는 do_latest 중 하나라도 있어야 함. 둘 다 없으면 None.
   - water_temp_latest >= config.high_water_temp_c → 'increase'(고수온 스트레스, 최우선 판단).
   - 그 외 do_latest 존재 시: 하한 근접(margin_low) → 'increase', 상한 근접(margin_high) →
     'reduce', 그 외 → 'normal'.
   - water_temp_latest 만 있고 do_latest 없고 고수온도 아니면 → 'normal'.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timezone
from typing import Sequence

from .types import (
    DoBand,
    DoReading,
    FeedReading,
    RecommendationInput,
    RecommendationOutput,
    RecommendConfig,
)


def _utc_date(ts: datetime) -> date:
    """계측 시각 → UTC 기준 일자(mortality.py 와 동일 규약, 결정론적 버킷팅)."""
    if ts.tzinfo is not None:
        return ts.astimezone(timezone.utc).date()
    return ts.date()


def _feed_included(reading: FeedReading, period_start: datetime, period_end: datetime,
                    config: RecommendConfig) -> bool:
    """급이 이력의 기간 [start, end) 반열림 + quality_flag 화이트리스트 필터(feed.py 규약 재사용)."""
    if reading.quality_flag not in config.included_feed_quality_flags:
        return False
    if reading.ts < period_start:
        return False
    if reading.ts >= period_end:
        return False
    return True


def _clamp(value: float, lo: float, hi: float) -> float:
    """단순 상하한 클램프(결정론적, 부작용 없음)."""
    if value < lo:
        return lo
    if value > hi:
        return hi
    return value


def _recommend_feed(
    feed_history: Sequence[FeedReading],
    biomass_latest_kg: float | None,
    period_start: datetime,
    period_end: datetime,
    config: RecommendConfig,
) -> tuple[float | None, str, tuple[str, ...]]:
    """급이 추천값 + rationale 조각 + source_refs 산출. 근거 부족 시 (None, 사유, ())."""
    included: list[FeedReading] = []
    included_refs: set[str] = set()
    days: set[date] = set()
    total_feed_kg = 0.0

    for reading in feed_history:
        if not _feed_included(reading, period_start, period_end, config):
            continue
        if not math.isfinite(reading.feed_kg):
            raise ValueError(
                f"included feed has non-finite feed_kg: source_ref={reading.source_ref!r} "
                f"feed_kg={reading.feed_kg!r}"
            )
        if reading.feed_kg < 0.0:
            raise ValueError(
                f"included feed has negative feed_kg: source_ref={reading.source_ref!r} "
                f"feed_kg={reading.feed_kg!r}"
            )
        included.append(reading)
        included_refs.add(reading.source_ref)
        days.add(_utc_date(reading.ts))
        total_feed_kg += reading.feed_kg

    source_refs = tuple(sorted(included_refs))

    if not included:
        return None, "최근 급이 이력이 없어 급이 추천을 산출할 수 없습니다.", source_refs
    if biomass_latest_kg is None or not math.isfinite(biomass_latest_kg) or biomass_latest_kg <= 0.0:
        return None, "최근 생체량 데이터가 없어 급이 추천을 산출할 수 없습니다.", source_refs

    day_count = len(days)
    recent_avg_feed_kg_per_day = total_feed_kg / day_count
    target_feed_kg = biomass_latest_kg * config.target_feed_rate_pct_of_biomass

    cap = recent_avg_feed_kg_per_day * config.max_feed_adjustment_ratio
    diff = _clamp(target_feed_kg - recent_avg_feed_kg_per_day, -cap, cap)
    feed_kg_per_day = recent_avg_feed_kg_per_day + diff

    rationale = (
        f"최근 {day_count}일 평균 급이량 {recent_avg_feed_kg_per_day:.2f}kg/일, "
        f"생체량 {biomass_latest_kg:.2f}kg 기준 목표 급이율 "
        f"{config.target_feed_rate_pct_of_biomass * 100:.1f}%(={target_feed_kg:.2f}kg/일) 대비 "
        f"1회 조정폭 상한 {config.max_feed_adjustment_ratio * 100:.1f}%를 적용해 "
        f"{feed_kg_per_day:.2f}kg/일을 권장합니다."
    )
    return feed_kg_per_day, rationale, source_refs


def _recommend_oxygen(
    do_latest: DoReading | None,
    do_band: DoBand,
    config: RecommendConfig,
) -> tuple[float | None, str, tuple[str, ...]]:
    """산소(DO 목표) 추천값 + rationale 조각 + source_refs 산출. 근거 부족 시 (None, 사유, ())."""
    if do_latest is None:
        return None, "현재 DO 계측값이 없어 산소 목표 추천을 산출할 수 없습니다.", ()
    if not math.isfinite(do_latest.do_mg_l):
        raise ValueError(f"do_latest.do_mg_l must be finite, got {do_latest.do_mg_l!r}")

    source_refs = (do_latest.meter_id,)
    do_mg_l = do_latest.do_mg_l

    if do_mg_l <= do_band.do_min + config.do_low_margin_mg_l:
        target = do_band.do_max
        rationale = (
            f"현재 DO {do_mg_l:.2f}mg/L 가 목표대역 하한({do_band.do_min:.2f}mg/L) 근접(여유폭 "
            f"{config.do_low_margin_mg_l:.2f}mg/L 이내)이므로 안전 여유 확보를 위해 목표를 "
            f"상한 {target:.2f}mg/L 로 상향 조정합니다."
        )
    elif do_mg_l >= do_band.do_max - config.do_high_margin_mg_l:
        target = (do_band.do_min + do_band.do_max) / 2.0
        rationale = (
            f"현재 DO {do_mg_l:.2f}mg/L 가 목표대역 상한({do_band.do_max:.2f}mg/L) 근접(여유폭 "
            f"{config.do_high_margin_mg_l:.2f}mg/L 이내)이므로 과폭기 방지를 위해 목표를 "
            f"대역 중앙 {target:.2f}mg/L 로 하향 조정합니다."
        )
    else:
        target = do_band.do_min
        rationale = (
            f"현재 DO {do_mg_l:.2f}mg/L 가 목표대역 중앙권이므로 불필요한 과폭기를 방지하기 "
            f"위해 목표를 대역 하한 {target:.2f}mg/L 로 유지합니다."
        )

    return target, rationale, source_refs


def _recommend_circulation(
    do_latest: DoReading | None,
    do_band: DoBand,
    water_temp_latest: float | None,
    config: RecommendConfig,
) -> tuple[str | None, str]:
    """순환 추천('normal'|'increase'|'reduce') + rationale 조각. 근거 부족 시 (None, 사유)."""
    if do_latest is None and water_temp_latest is None:
        return None, "현재 DO/수온 계측값이 모두 없어 순환 추천을 산출할 수 없습니다."

    if water_temp_latest is not None:
        if not math.isfinite(water_temp_latest):
            raise ValueError(f"water_temp_latest must be finite, got {water_temp_latest!r}")
        if water_temp_latest >= config.high_water_temp_c:
            return "increase", (
                f"현재 수온 {water_temp_latest:.2f}°C 가 고수온 기준"
                f"({config.high_water_temp_c:.2f}°C) 이상이므로 순환을 강화합니다."
            )

    if do_latest is not None:
        if not math.isfinite(do_latest.do_mg_l):
            raise ValueError(f"do_latest.do_mg_l must be finite, got {do_latest.do_mg_l!r}")
        do_mg_l = do_latest.do_mg_l
        if do_mg_l <= do_band.do_min + config.do_low_margin_mg_l:
            return "increase", (
                f"현재 DO {do_mg_l:.2f}mg/L 가 목표대역 하한 근접이므로 순환을 강화합니다."
            )
        if do_mg_l >= do_band.do_max - config.do_high_margin_mg_l:
            return "reduce", (
                f"현재 DO {do_mg_l:.2f}mg/L 가 목표대역 상한 근접이므로 순환을 완화합니다."
            )

    return "normal", "현재 수온/DO 가 안정 범위이므로 순환 설정을 유지합니다."


def compute_recommendation(
    inputs: RecommendationInput,
    config: RecommendConfig,
    config_version: str,
) -> RecommendationOutput:
    """급이·산소·순환 룰 기반 추천(MASTER 3.2 하단 "추천 로직"). 순수·결정론(Rule 6).

    세 항목을 독립적으로 산출하고 각 rationale 문장을 이어붙여 전체 rationale 을 구성한다.
    모든 값 산출 불가 시에도 에러 없이 RecommendationOutput(값 None, rationale 에 사유)을
    반환한다(대시보드가 "추천 불가"를 표시할 수 있게, phase-2.md 2.2절).

    방어(데이터 정합):
      - period_start >= period_end → ValueError(빈/역전 기간).
      - do_band.do_min >= do_band.do_max → ValueError(대역 정의 불가, oxygen.py 규약 재사용).
      - 포함된 feed_kg/DO/수온이 비유한 또는 feed_kg 음수 → ValueError.
    """
    if inputs.period_start >= inputs.period_end:
        raise ValueError(
            "period_start must be strictly before period_end: "
            f"{inputs.period_start!r} >= {inputs.period_end!r}"
        )
    if not math.isfinite(inputs.do_band.do_min) or not math.isfinite(inputs.do_band.do_max):
        raise ValueError(f"DO band bounds must be finite: {inputs.do_band!r}")
    if inputs.do_band.do_min >= inputs.do_band.do_max:
        raise ValueError(
            "do_band.do_min must be strictly less than do_band.do_max: "
            f"{inputs.do_band.do_min!r} >= {inputs.do_band.do_max!r}"
        )

    feed_value, feed_rationale, feed_refs = _recommend_feed(
        inputs.feed_history, inputs.biomass_latest_kg,
        inputs.period_start, inputs.period_end, config,
    )
    oxygen_value, oxygen_rationale, do_refs = _recommend_oxygen(
        inputs.do_latest, inputs.do_band, config,
    )
    circulation_value, circulation_rationale = _recommend_circulation(
        inputs.do_latest, inputs.do_band, inputs.water_temp_latest, config,
    )

    rationale = " ".join((
        f"[급이] {feed_rationale}",
        f"[산소] {oxygen_rationale}",
        f"[순환] {circulation_rationale}",
    ))

    source_refs = {
        "feed": feed_refs,
        "do": do_refs,
    }

    return RecommendationOutput(
        feed_kg_per_day=feed_value,
        oxygen_target_do_mg_l=oxygen_value,
        circulation_setting=circulation_value,
        rationale=rationale,
        source_refs=source_refs,
        config_version=config_version,
    )
