"""Feed Conversion Ratio (FCR) — MASTER 3.2 ③ 산식 구현.

FCR = 기간 내 총 급이량(kg) / 기간 내 증체량(kg) = Σ(feed_kg) / Δbiomass_kg
단위: 무차원(kg/kg). 낮을수록 우수.

★ 이 모듈은 산식의 단일 진실 공급원이다(Rule 1). API/FE 어디에도 산식을 중복하지 말 것.
순수·결정론(Rule 6): 동일 입력 → 동일 출력. now()/난수/외부 상태 금지.
분모 Δbiomass 는 EI(energy.py)와 동일한 BiomassPoint 개념을 재사용한다.
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Sequence

from .types import BiomassPoint, FcrConfig, FcrResult, FeedReading


def _is_included(reading: FeedReading, period_start: datetime, period_end: datetime,
                 config: FcrConfig) -> bool:
    """기간 [period_start, period_end) 반열림 + quality_flag 화이트리스트 필터.

    반열림(end 미포함)으로 인접 기간 경계에서 급이가 중복 집계되지 않게 한다(EI 와 동일 규약).
    """
    if reading.quality_flag not in config.included_quality_flags:
        return False
    if reading.ts < period_start:
        return False
    if reading.ts >= period_end:  # end 는 미포함(반열림)
        return False
    return True


def compute_fcr(
    feed_readings: Sequence[FeedReading],
    biomass_start: BiomassPoint,
    biomass_end: BiomassPoint,
    period_start: datetime,
    period_end: datetime,
    config: FcrConfig,
    config_version: str,
) -> FcrResult:
    """총 급이량 / Δ증체량 (MASTER 3.2 ③). 순수·결정론.

    규칙:
      - [period_start, period_end) 밖 또는 quality_flag ∉ included 인 feed 는 제외.
      - total_feed_kg = 포함된 feed.feed_kg 합.
      - biomass_delta_kg = biomass_end - biomass_start.
      - biomass_delta_kg <= config.min_biomass_delta_kg → fcr = None
        (0/음수 나눗셈 방지: 생산량이 없거나 감소했으면 FCR 은 정의되지 않음).

    방어(데이터 정합):
      - 포함된 feed 의 feed_kg 가 비유한(NaN/inf)/음수 → ValueError
        (급이량은 물리적으로 음수일 수 없고, 비유한값은 조용히 FCR 을 오염시킨다).
      - 생체량이 비유한 → ValueError.
      - period_start >= period_end → ValueError(빈/역전 기간).
    """
    if period_start >= period_end:
        raise ValueError(
            f"period_start must be strictly before period_end: {period_start!r} >= {period_end!r}"
        )

    for point in (biomass_start, biomass_end):
        if not math.isfinite(point.biomass_kg):
            raise ValueError(
                f"biomass_kg must be finite, got {point.biomass_kg!r} (ref={point.source_ref!r})"
            )

    total_feed_kg = 0.0
    included_count = 0
    excluded_count = 0
    included_feed_refs: set[str] = set()

    for reading in feed_readings:
        if not _is_included(reading, period_start, period_end, config):
            excluded_count += 1
            continue
        if not math.isfinite(reading.feed_kg):
            raise ValueError(
                f"included feed has non-finite feed_kg: source_ref={reading.source_ref!r} "
                f"ts={reading.ts!r} feed_kg={reading.feed_kg!r}"
            )
        if reading.feed_kg < 0.0:
            raise ValueError(
                f"included feed has negative feed_kg (physically impossible): "
                f"source_ref={reading.source_ref!r} ts={reading.ts!r} feed_kg={reading.feed_kg!r}"
            )
        included_count += 1
        total_feed_kg += reading.feed_kg
        included_feed_refs.add(reading.source_ref)

    biomass_delta_kg = biomass_end.biomass_kg - biomass_start.biomass_kg

    if biomass_delta_kg <= config.min_biomass_delta_kg:
        # 산출 불가: 생산량이 없거나(0) 감소(음수)했거나 임계 미달.
        fcr = None
    else:
        fcr = total_feed_kg / biomass_delta_kg

    # source_feed_refs: 정렬·중복제거로 결정론적 순서 보장(drill-down 근거).
    source_feed_refs = tuple(sorted(included_feed_refs))
    source_biomass_refs = (biomass_start.source_ref, biomass_end.source_ref)

    return FcrResult(
        fcr=fcr,
        total_feed_kg=total_feed_kg,
        biomass_start_kg=biomass_start.biomass_kg,
        biomass_end_kg=biomass_end.biomass_kg,
        biomass_delta_kg=biomass_delta_kg,
        period_start=period_start,
        period_end=period_end,
        included_feed_count=included_count,
        excluded_feed_count=excluded_count,
        source_feed_refs=source_feed_refs,
        source_biomass_refs=source_biomass_refs,
        config_version=config_version,
    )
