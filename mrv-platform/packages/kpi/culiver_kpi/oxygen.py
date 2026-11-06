"""Oxygen Efficiency Index (OEI) — MASTER 3.2 ② 산식 구현. ★ ADR 0003 전제.

OEI = (DO 목표대역 유지율) / (생산 kg당 폭기 전력)
    = (t_in_band / t_total) / (aeration_kWh / biomass_kg)   → 0~100 지수로 스케일링
높을수록 우수. MASTER 3.2 ② 가 명시한 '제안값'이며, 실증 1단계에서 스케일 계수를
`OeiConfig.oei_scale_factor` 로 보정한다(산식 코드 불변, kpi_config version↑ — ADR 0003).

DO 유지율 산정 규약(ADR 0003 Accepted, data-kpi-engineer 2026-07-03):
  - v1 = 유효 샘플 개수 비율(sample-count fraction). 정렬/보간 없는 순수·결정론(Rule 6).
    do_in_band_fraction = (대역 내 유효 샘플 수) / (전체 유효 샘플 수).
  - 'time_weighted' 방식은 OeiConfig.do_band_method 로 예약(불규칙 샘플 확인 시 version↑).

★ 이 모듈은 산식의 단일 진실 공급원이다(Rule 1). API/FE 어디에도 산식을 중복하지 말 것.
순수·결정론(Rule 6): 동일 입력 → 동일 출력. now()/난수/외부 상태 금지.
폭기 전력은 EI 와 동일한 PowerReading(is_aeration=True)을, 생산량은 BiomassPoint 를 재사용한다.
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Sequence

from .types import BiomassPoint, DoBand, DoReading, OeiConfig, OeiResult, PowerReading


def _do_included(reading: DoReading, period_start: datetime, period_end: datetime,
                 config: OeiConfig) -> bool:
    """DO 샘플의 기간 [start, end) 반열림 + quality_flag 화이트리스트 필터."""
    if reading.quality_flag not in config.included_quality_flags:
        return False
    if reading.ts < period_start:
        return False
    if reading.ts >= period_end:  # end 는 미포함(반열림)
        return False
    return True


def _aeration_included(reading: PowerReading, period_start: datetime, period_end: datetime,
                       config: OeiConfig) -> bool:
    """폭기 전력 reading 필터: is_aeration=True + 기간 + quality_flag.

    is_aeration=False 인 reading 은 폭기 전력(분모 항)에 기여하지 않으므로 제외한다.
    """
    if not reading.is_aeration:
        return False
    if reading.quality_flag not in config.included_quality_flags:
        return False
    if reading.ts < period_start:
        return False
    if reading.ts >= period_end:  # end 는 미포함(반열림)
        return False
    return True


def compute_oei(
    do_readings: Sequence[DoReading],
    aeration_readings: Sequence[PowerReading],   # is_aeration=True 만 분자에 유효
    biomass_start: BiomassPoint,
    biomass_end: BiomassPoint,
    band: DoBand,
    period_start: datetime,
    period_end: datetime,
    config: OeiConfig,
    config_version: str,
) -> OeiResult:
    """MASTER 3.2 ② (제안 산식). 순수·결정론. 상세 규약은 ADR 0003.

    산출:
      - do_in_band_fraction = (대역 내 유효 샘플 수) / (전체 유효 샘플 수)  [ADR 0003 v1]
        대역 내 = band.do_min <= do_mg_l <= band.do_max (양끝 포함).
      - aeration_power_kwh = 포함된 is_aeration reading.kwh 합.
      - biomass_delta_kg = biomass_end - biomass_start.
      - oei_raw = do_in_band_fraction / (aeration_power_kwh / biomass_delta_kg).
      - oei = min(oei_raw * oei_scale_factor, clamp_max)  (0~clamp_max 지수).

    경계(→ None): 유효 DO 샘플 0 / aeration_power_kwh=0 / biomass_delta<=min_biomass_kg.
    방어(→ ValueError): band.do_min>=band.do_max / 비유한 입력(band·do·kwh·biomass) / period 역전.
    """
    if period_start >= period_end:
        raise ValueError(
            f"period_start must be strictly before period_end: {period_start!r} >= {period_end!r}"
        )

    # band 방어: 비유한 + 역전(하한 >= 상한)은 대역 정의 불가 → ValueError.
    if not math.isfinite(band.do_min) or not math.isfinite(band.do_max):
        raise ValueError(f"DO band bounds must be finite: {band!r}")
    if band.do_min >= band.do_max:
        raise ValueError(
            f"band.do_min must be strictly less than band.do_max: "
            f"{band.do_min!r} >= {band.do_max!r}"
        )

    for point in (biomass_start, biomass_end):
        if not math.isfinite(point.biomass_kg):
            raise ValueError(
                f"biomass_kg must be finite, got {point.biomass_kg!r} (ref={point.source_ref!r})"
            )

    # --- DO 유지율 (개수 비율, ADR 0003 v1) ---
    do_total_samples = 0
    do_in_band_samples = 0
    do_excluded_samples = 0
    do_meter_ids: set[str] = set()

    for reading in do_readings:
        if not _do_included(reading, period_start, period_end, config):
            do_excluded_samples += 1
            continue
        if not math.isfinite(reading.do_mg_l):
            raise ValueError(
                f"included DO reading has non-finite do_mg_l: meter_id={reading.meter_id!r} "
                f"ts={reading.ts!r} do_mg_l={reading.do_mg_l!r}"
            )
        do_total_samples += 1
        do_meter_ids.add(reading.meter_id)
        if band.do_min <= reading.do_mg_l <= band.do_max:
            do_in_band_samples += 1

    # --- 폭기 전력(분모 항) ---
    aeration_power_kwh = 0.0
    aeration_meter_ids: set[str] = set()
    for reading in aeration_readings:
        if not _aeration_included(reading, period_start, period_end, config):
            continue
        if not math.isfinite(reading.kwh):
            raise ValueError(
                f"included aeration reading has non-finite kwh: meter_id={reading.meter_id!r} "
                f"ts={reading.ts!r} kwh={reading.kwh!r}"
            )
        aeration_power_kwh += reading.kwh
        aeration_meter_ids.add(reading.meter_id)

    biomass_delta_kg = biomass_end.biomass_kg - biomass_start.biomass_kg

    # --- 유지율/OEI 산출 (경계 → None) ---
    if do_total_samples == 0:
        # 유효 DO 샘플이 없으면 유지율 정의 불가.
        do_in_band_fraction = None
    else:
        do_in_band_fraction = do_in_band_samples / do_total_samples

    oei_raw: float | None
    oei: float | None
    if (
        do_in_band_fraction is None
        or aeration_power_kwh == 0.0
        or biomass_delta_kg <= config.min_biomass_kg
    ):
        # 산출 불가: 유효 DO 0 / 폭기 전력 0(분모 정의 불가) / 생산 정규화 불가.
        oei_raw = None
        oei = None
    else:
        # oei_raw = (t_in_band/t_total) / (aeration_kWh / biomass_kg)
        #         = do_in_band_fraction * biomass_delta_kg / aeration_power_kwh
        oei_raw = do_in_band_fraction * biomass_delta_kg / aeration_power_kwh
        scaled = oei_raw * config.oei_scale_factor
        # clamp_max 상한만 적용(0~clamp_max 지수). 하한은 산식상 자연히 >= 0.
        oei = scaled if scaled <= config.clamp_max else config.clamp_max

    source_do_meter_ids = tuple(sorted(do_meter_ids))
    source_aeration_meter_ids = tuple(sorted(aeration_meter_ids))
    source_biomass_refs = (biomass_start.source_ref, biomass_end.source_ref)

    return OeiResult(
        oei=oei,
        do_in_band_fraction=do_in_band_fraction,
        do_total_samples=do_total_samples,
        do_in_band_samples=do_in_band_samples,
        do_excluded_samples=do_excluded_samples,
        aeration_power_kwh=aeration_power_kwh,
        biomass_delta_kg=biomass_delta_kg,
        band_min=band.do_min,
        band_max=band.do_max,
        oei_raw=oei_raw,
        scale_factor=config.oei_scale_factor,
        method=config.do_band_method,
        period_start=period_start,
        period_end=period_end,
        source_do_meter_ids=source_do_meter_ids,
        source_aeration_meter_ids=source_aeration_meter_ids,
        source_biomass_refs=source_biomass_refs,
        config_version=config_version,
    )
