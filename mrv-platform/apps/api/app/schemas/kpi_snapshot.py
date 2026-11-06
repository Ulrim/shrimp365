"""kpi_snapshots 조회 스키마 — phase-3.md 1.7절(검증 추적성 갭 보강).

`GET /kpi-snapshots/{id}`: 저장된 행 그대로 반환(스칼라 5종 + inputs_json + provenance_json
+ config_version). drill-down 종착점 — 이 아래 단계(원시 reading)는 기존
`GET /sites/{id}/readings`로 이미 가능(신규 엔드포인트 불요, phase-2 4.1절 재사용).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.schemas.kpi import KpiPeriod


class KpiSnapshotResponse(BaseModel):
    """kpi_snapshots 1행 그대로(1.7절)."""

    id: str
    site_id: str
    tank_id: str | None
    org_id: str
    period: KpiPeriod
    ei_total: float | None
    ei_aeration: float | None
    oei: float | None
    fcr: float | None
    mortality_rate: float | None
    config_version: str
    inputs_json: dict
    provenance_json: dict
    generated_at: datetime

    model_config = {"populate_by_name": True}
