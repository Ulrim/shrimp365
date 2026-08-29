"""수기 입력(급이/폐사) 스키마 — MASTER 화면4 백엔드.

feed_kg>0 / dead_count>=0 은 pydantic 제약(Field)으로 422 를 자동 반환한다.
batch 의 site/org 소속 검증은 서비스(tenancy.resolve_batch_for_site)가 담당한다.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class FeedLogCreate(BaseModel):
    """POST /sites/{site_id}/feed-logs 요청 바디."""

    batch_id: str
    ts: datetime
    feed_kg: float = Field(..., gt=0.0, description="급이량(kg). 0 초과")
    source: str = Field(default="manual", description="'manual'|'csv'|'device'")


class FeedLogResponse(BaseModel):
    id: str
    batch_id: str
    org_id: str
    ts: datetime
    feed_kg: float
    source: str
    quality_flag: str


class MortalityLogCreate(BaseModel):
    """POST /sites/{site_id}/mortality-logs 요청 바디."""

    batch_id: str
    ts: datetime
    dead_count: int = Field(..., ge=0, description="폐사 개체수. 음수 불가")
    cause_note: str | None = None


class MortalityLogResponse(BaseModel):
    id: str
    batch_id: str
    org_id: str
    ts: datetime
    dead_count: int
    cause_note: str | None
