"""Energy Intensity (EI) — MASTER 3.2 ① 산식 구현.

EI = 기간 내 총 전력사용량(kWh) / 기간 내 생산량(kg) = Σ(power_kWh) / Δbiomass_kg
단위: kWh/kg. 총전력 EI(ei_total)와 폭기전력 EI(ei_aeration)를 동시에 산출한다.

★ 이 모듈은 산식의 단일 진실 공급원이다(Rule 1). API/FE 어디에도 산식을 중복하지 말 것.
순수·결정론(Rule 6): 동일 입력 → 동일 출력. now()/난수/외부 상태 금지.
입력 전제: PowerReading.kwh 는 ADR 0001 로 이미 interval kWh 로 정규화되어 있다.
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Sequence

from .types import BiomassPoint, EiConfig, EiResult, PowerReading


def _is_included(reading: PowerReading, period_start: datetime, period_end: datetime,
                 config: EiConfig) -> bool:
    """기간 [period_start, period_end) 반열림 + quality_flag 화이트리스트 필터.

    반열림(end 미포함)으로 인접 기간 경계에서 reading 이 중복 집계되지 않게 한다.
    """
    if reading.quality_flag not in config.included_quality_flags:
        return False
    if reading.ts < period_start:
        return False
    if reading.ts >= period_end:  # end 는 미포함(반열림)
        return False
    return True


def compute_ei(
    power_readings: Sequence[PowerReading],
    biomass_start: BiomassPoint,
    biomass_end: BiomassPoint,
    period_start: datetime,
    period_end: datetime,
    config: EiConfig,
    config_version: str,
) -> EiResult:
    """총전력 EI 와 폭기전력 EI 를 동시에 산출(MASTER 3.2 ①).

    순수·결정론: 동일 입력 → 동일 출력. now()/난수 금지.

    규칙:
      - [period_start, period_end) 범위 밖 또는 quality_flag ∉ included 인 reading 은 제외.
      - total_power_kwh    = 포함된 모든 reading.kwh 합.
      - aeration_power_kwh = 포함된 reading 중 is_aeration=True 의 kwh 합.
      - biomass_delta_kg   = biomass_end.biomass_kg - biomass_start.biomass_kg.
      - biomass_delta_kg <= config.min_biomass_delta_kg 이면 ei_total/ei_aeration = None
        (0/음수 나눗셈 방지: 생산량이 없거나 감소했으면 EI 는 정의되지 않음).

    방어(데이터 정합):
      - 포함된 reading 의 kwh 나 생체량이 유한(finite)하지 않으면(NaN/inf) ValueError.
        비유한 값은 EI 를 조용히 오염(NaN 전파)시키므로 산출 자체를 거부한다.
      - period_start >= period_end 이면 ValueError(빈/역전 기간).
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

    total_power_kwh = 0.0
    aeration_power_kwh = 0.0
    included_count = 0
    excluded_count = 0
    included_meter_ids: set[str] = set()

    for reading in power_readings:
        if not _is_included(reading, period_start, period_end, config):
            excluded_count += 1
            continue
        if not math.isfinite(reading.kwh):
            raise ValueError(
                f"included reading has non-finite kwh: meter_id={reading.meter_id!r} "
                f"ts={reading.ts!r} kwh={reading.kwh!r}"
            )
        included_count += 1
        total_power_kwh += reading.kwh
        if reading.is_aeration:
            aeration_power_kwh += reading.kwh
        included_meter_ids.add(reading.meter_id)

    biomass_delta_kg = biomass_end.biomass_kg - biomass_start.biomass_kg

    if biomass_delta_kg <= config.min_biomass_delta_kg:
        # 산출 불가: 생산량이 없거나(0) 감소(음수)했거나 임계 미달.
        ei_total = None
        ei_aeration = None
    else:
        ei_total = total_power_kwh / biomass_delta_kg
        ei_aeration = aeration_power_kwh / biomass_delta_kg

    # source_meter_ids: 정렬·중복제거로 결정론적 순서 보장(drill-down 근거).
    source_meter_ids = tuple(sorted(included_meter_ids))
    source_biomass_refs = (biomass_start.source_ref, biomass_end.source_ref)

    return EiResult(
        ei_total=ei_total,
        ei_aeration=ei_aeration,
        total_power_kwh=total_power_kwh,
        aeration_power_kwh=aeration_power_kwh,
        biomass_start_kg=biomass_start.biomass_kg,
        biomass_end_kg=biomass_end.biomass_kg,
        biomass_delta_kg=biomass_delta_kg,
        period_start=period_start,
        period_end=period_end,
        included_reading_count=included_count,
        excluded_reading_count=excluded_count,
        source_meter_ids=source_meter_ids,
        source_biomass_refs=source_biomass_refs,
        config_version=config_version,
    )
