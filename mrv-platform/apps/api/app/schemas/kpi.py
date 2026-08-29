"""KpiResponse Pydantic 스키마 — sprint-0 2.2절 계약 + phase-1 4종 확장.

FE 는 산식을 모르고 metrics + inputs + provenance 만 소비한다(2.4절).
모든 수치는 inputs/provenance 로 근거 역추적 가능해야 한다(재현성 NFR).

phase-1 확장(슬라이스 A/B/D-BE): EI 외 FCR/OEI/mortality metrics 를 채우고,
근거(inputs/provenance)를 4종으로 확장한다. 기존 EI 필드는 **불변**(하위호환),
신규 지표 근거는 **선택(Optional) 서브객체**로 추가해 기존 소비자를 깨지 않는다.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

KpiMetricStatus = Literal["green", "amber", "red", "na"]


class KpiMetric(BaseModel):
    """단일 KPI 지표 슬롯. value=null 이면 산출 불가(status='na')."""

    value: float | None = Field(..., description="산출값. null=산출 불가")
    unit: str = Field(..., description="단위(예: kWh/kg)")
    status: KpiMetricStatus = Field(..., description="신호등(green/amber/red/na)")


class KpiPeriod(BaseModel):
    from_: datetime = Field(..., alias="from")
    to: datetime
    granularity: str = "period"

    model_config = {"populate_by_name": True}


class KpiConfigInfo(BaseModel):
    version: str
    params: dict


class KpiMetrics(BaseModel):
    """4종 지표 슬롯. 값 있으면 green, null 이면 na(2.2절 status 규칙)."""

    ei_total: KpiMetric | None = None
    ei_aeration: KpiMetric | None = None
    oei: KpiMetric | None = None          # phase-1 D-BE(index)
    fcr: KpiMetric | None = None          # phase-1 A(kg/kg)
    mortality_rate: KpiMetric | None = None  # phase-1 B(%)


# --- phase-1 지표별 근거 서브객체(drill-down; 선택) ---


class FcrInputs(BaseModel):
    """FCR 산출 근거/중간값(검증 추적)."""

    total_feed_kg: float
    biomass_start_kg: float
    biomass_end_kg: float
    biomass_delta_kg: float
    included_feed_count: int
    excluded_feed_count: int


class OeiInputs(BaseModel):
    """OEI 산출 근거/중간값(ADR 0003; 제안 스케일 계수 근거 포함)."""

    do_in_band_fraction: float | None
    do_total_samples: int
    do_in_band_samples: int
    do_excluded_samples: int
    aeration_power_kwh: float
    biomass_delta_kg: float
    band_min: float
    band_max: float
    oei_raw: float | None
    scale_factor: float
    method: str


class MortalityDailyPoint(BaseModel):
    """일일 폐사(UTC 일 버킷) drill-down."""

    date: date
    dead_count: int
    daily_rate_pct: float | None


class MortalityMovingAvgPoint(BaseModel):
    """7일(창) 이동평균 drill-down."""

    date: date
    ma_rate_pct: float | None


class MortalityInputs(BaseModel):
    """폐사율 산출 근거 + 일일/이동평균 시계열(카드는 누적률만, drill-down 위해 전량 반환)."""

    cumulative_rate_pct: float | None
    total_dead_count: int
    stocked_count: int
    daily: list[MortalityDailyPoint]
    moving_avg: list[MortalityMovingAvgPoint]


class KpiInputs(BaseModel):
    """산출 근거/중간값(검증 추적성).

    EI 필드는 sprint-0 계약 그대로(필수). phase-1 지표 근거는 선택 서브객체로 추가.
    """

    # --- EI (sprint-0, 필수) ---
    total_power_kwh: float
    aeration_power_kwh: float
    biomass_start_kg: float
    biomass_end_kg: float
    biomass_delta_kg: float
    included_reading_count: int
    excluded_reading_count: int
    # --- phase-1 확장(선택) ---
    fcr: FcrInputs | None = None
    oei: OeiInputs | None = None
    mortality: MortalityInputs | None = None


class KpiProvenance(BaseModel):
    """검증 drill-down(MASTER 3.3, 7장)."""

    source_meter_ids: list[str]
    source_biomass_refs: list[str]
    kpi_snapshot_id: str | None = None  # 스냅샷 영속화는 lock/worker 경로에서만 채움
    # --- phase-1 확장(선택 근거) ---
    source_feed_refs: list[str] | None = None
    source_do_meter_ids: list[str] | None = None
    source_aeration_meter_ids: list[str] | None = None
    source_mortality_refs: list[str] | None = None
    stocked_count: int | None = None


class KpiResponse(BaseModel):
    """GET /sites/{site_id}/kpi 응답 (2.2절 + phase-1 확장)."""

    site_id: str
    org_id: str
    period: KpiPeriod
    kpi_config: KpiConfigInfo
    metrics: KpiMetrics
    inputs: KpiInputs
    provenance: KpiProvenance
    generated_at: datetime

    model_config = {"populate_by_name": True}
