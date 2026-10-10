"""comparison 스키마 — phase-2 슬라이스 J(docs/design/phase-2.md 3.2절)."""

from __future__ import annotations

from pydantic import BaseModel

from app.schemas.kpi import KpiPeriod


class ComparisonPeriodMetrics(BaseModel):
    """baseline/current 공용: 기간 + config_version + 5개 스칼라 지표값."""

    period: KpiPeriod
    config_version: str
    metrics: dict[str, float | None]


class ComparisonRow(BaseModel):
    """단일 지표의 비교 결과(compare_metric 출력 그대로 직렬화)."""

    delta: float | None
    improvement_pct: float | None
    direction: str


class ComparisonProvenance(BaseModel):
    baseline_id: str
    current_kpi_snapshot_id: str | None = None


class ComparisonResponse(BaseModel):
    """GET /sites/{site_id}/comparison 응답(3.2절)."""

    site_id: str
    baseline: ComparisonPeriodMetrics
    current: ComparisonPeriodMetrics
    comparison: dict[str, ComparisonRow]
    provenance: ComparisonProvenance
