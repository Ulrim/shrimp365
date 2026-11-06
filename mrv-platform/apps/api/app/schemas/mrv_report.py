"""MRV 리포트 스키마 — phase-3.md 1.4/1.5/1.6절 계약.

`POST /sites/{site_id}/mrv-reports/generate` 요청/응답, `GET /mrv-reports/{id}`(재조회 동일
shape), `GET /sites/{site_id}/mrv-reports`(이력 목록).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.kpi import KpiPeriod


class MrvPeriodInput(BaseModel):
    """After 기간 입력({from, to})."""

    from_: datetime = Field(..., alias="from")
    to: datetime

    model_config = {"populate_by_name": True}


class MrvReportGenerateRequest(BaseModel):
    """POST /mrv-reports/generate 요청 바디(1.5절)."""

    after_period: MrvPeriodInput
    # 생략 시 활성(최신 effective_from) 배출계수 사용.
    emission_factor_id: str | None = None


class MrvPeriodSummary(BaseModel):
    """1.4절 before_json/after_json 구조."""

    period: KpiPeriod
    config_version: str
    ei_total: float | None
    ei_aeration: float | None
    total_power_kwh: float
    aeration_power_kwh: float
    biomass_delta_kg: float
    scope2_tco2e: float | None
    kpi_snapshot_id: str | None = None


class EmissionFactorRefResponse(BaseModel):
    """리포트에 실린 배출계수 근거 투영(1.5절 응답)."""

    version: str
    source: str
    year: int


class MrvBoundary(BaseModel):
    """측정경계·가정(1.6절 — 자동 생성, 자유 입력 아님)."""

    site_id: str
    site_name: str
    included_meter_ids: list[str]
    included_quality_flags: list[str]
    biomass_source_refs: dict[str, list[str]]
    config_version: dict[str, str]
    assumptions: list[str]


class MrvReportResponse(BaseModel):
    """POST .../generate(201) · GET /mrv-reports/{id}(200) 공용 응답(1.5절)."""

    id: str
    site_id: str
    org_id: str
    baseline_id: str
    period: KpiPeriod
    before: MrvPeriodSummary
    after: MrvPeriodSummary
    reduction_tco2e: float | None
    formula_text: str
    emission_factor: EmissionFactorRefResponse
    boundary: MrvBoundary
    pdf_available: bool
    generated_by: str
    generated_at: datetime

    model_config = {"populate_by_name": True}


class MrvReportListResponse(BaseModel):
    """GET /sites/{site_id}/mrv-reports 응답(화면10 이력 목록)."""

    items: list[MrvReportResponse]
    total: int
