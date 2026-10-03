"""ingestion 수집 스키마 — POST /ingest/readings(phase-1 3.3절).

배치 재전송 안전(at-least-once). 스키마 위반(빈 배치·필수필드 결측·타입)은
pydantic 이 422 를 자동 반환한다. 개별 원소의 스코프/kind 판정은 서비스가 rejected[] 로.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ReadingIn(BaseModel):
    """수집 배치의 원소 1건. reading_kind 가 정규화 방식을 결정한다(ADR 0001)."""

    meter_id: str
    ts: datetime
    value: float
    reading_kind: str = Field(
        ..., description="cumulative_kwh|instant_kw|interval_kwh|do_mg_l"
    )
    seq: int | None = Field(default=None, description="게이트웨이 순번(롤오버/순서 보조)")


class IngestRequest(BaseModel):
    """POST /ingest/readings 요청 바디. tenancy 는 X-API-Key 스코프가 진실(gateway_id 불신)."""

    gateway_id: str
    readings: list[ReadingIn] = Field(..., min_length=1, description="1건 이상")


class RejectedItem(BaseModel):
    index: int
    reason: str


class IngestResponse(BaseModel):
    """수집 결과. accepted=신규 저장, deduped=중복 흡수, rejected=부분 거부 목록."""

    accepted: int
    deduped: int
    rejected: list[RejectedItem]
