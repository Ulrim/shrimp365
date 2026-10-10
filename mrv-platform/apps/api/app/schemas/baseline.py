"""baseline lock/조회 스키마 — phase-1 2.3절 계약.

POST /sites/{site_id}/baseline/lock 요청/응답, GET /sites/{site_id}/baseline 응답.
metrics 는 KpiMetric(value/unit/status)을 재사용해 GET /kpi 와 동일한 표현을 유지한다.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.kpi import KpiMetric, KpiPeriod


class BaselinePeriodInput(BaseModel):
    """잠금 기간 입력({from, to})."""

    from_: datetime = Field(..., alias="from")
    to: datetime

    model_config = {"populate_by_name": True}


class BaselineLockRequest(BaseModel):
    """POST /baseline/lock 요청 바디."""

    period: BaselinePeriodInput


class BaselineMetrics(BaseModel):
    """잠금 스냅샷 5개 스칼라값(2.3절)."""

    ei_total: KpiMetric
    ei_aeration: KpiMetric
    oei: KpiMetric
    fcr: KpiMetric
    mortality_rate: KpiMetric


class BaselineKpiConfig(BaseModel):
    version: str


class BaselineProvenance(BaseModel):
    kpi_snapshot_id: str | None = None


class BaselineResponse(BaseModel):
    """POST /baseline/lock (201) · GET /baseline (200) 응답(2.3절)."""

    id: str
    site_id: str
    org_id: str
    period: KpiPeriod
    status: str
    metrics: BaselineMetrics
    kpi_config: BaselineKpiConfig
    provenance: BaselineProvenance
    locked_by: str | None
    locked_at: datetime | None

    model_config = {"populate_by_name": True}
