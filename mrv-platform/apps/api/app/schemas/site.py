"""사이트 목록/멀티사이트 벤치마크 스키마 — phase-3.md 4.2절(`GET /sites`, 온보딩 7.2절이 참조,
`GET /sites/kpi-benchmark` ENTERPRISE)."""

from __future__ import annotations

from pydantic import BaseModel

from app.schemas.kpi import KpiPeriod


class SiteSummaryResponse(BaseModel):
    id: str
    name: str
    region: str | None = None
    ras_type: str | None = None

    model_config = {"from_attributes": True}


class SiteListResponse(BaseModel):
    items: list[SiteSummaryResponse]
    total: int


class SiteBenchmarkMetrics(BaseModel):
    """4.2절 metrics — 신규 산식 없음(compute_site_kpi_results 반복 호출 결과 투영)."""

    ei_total: float | None
    ei_aeration: float | None
    oei: float | None
    fcr: float | None
    mortality_rate: float | None


class SiteBenchmarkEntry(BaseModel):
    site_id: str
    site_name: str
    config_version: str
    metrics: SiteBenchmarkMetrics


class SiteKpiBenchmarkResponse(BaseModel):
    """GET /sites/kpi-benchmark 응답(4.2절). 정렬/랭킹은 FE 몫."""

    period: KpiPeriod
    sites: list[SiteBenchmarkEntry]

    model_config = {"populate_by_name": True}
