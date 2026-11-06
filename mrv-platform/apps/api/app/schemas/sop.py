"""SOP 라이브러리 스키마 — phase-3.md 2절 계약.

`GET /sop`(목록)/`GET /sop/{id}`(상세)는 정적 콘텐츠(app/content/sop) 투영이고,
`POST/GET .../sop/checklist-runs` 는 `sop_checklist_runs` 실행 기록(2.2절) 투영이다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

SopCategory = Literal["normal", "water_quality", "do_drop", "mortality_spike"]


class SopChecklistItemSchema(BaseModel):
    id: str
    label: str


class SopSummaryResponse(BaseModel):
    """GET /sop 목록 항목."""

    id: str
    title: str
    category: SopCategory
    summary: str


class SopListResponse(BaseModel):
    items: list[SopSummaryResponse]


class SopDetailResponse(BaseModel):
    """GET /sop/{id} 상세."""

    id: str
    title: str
    category: SopCategory
    body_markdown: str
    checklist_items: list[SopChecklistItemSchema]


class ChecklistRunItemInput(BaseModel):
    """POST checklist-runs 요청 바디의 항목 하나."""

    item_id: str
    checked: bool
    note: str | None = None


class ChecklistRunCreateRequest(BaseModel):
    items: list[ChecklistRunItemInput]


class ChecklistRunItemResponse(BaseModel):
    item_id: str
    checked: bool
    note: str | None = None


class ChecklistRunResponse(BaseModel):
    """POST(201)/목록 항목 공용 shape."""

    id: str
    site_id: str
    org_id: str
    sop_id: str
    items: list[ChecklistRunItemResponse]
    performed_by: str
    performed_at: datetime


class ChecklistRunListResponse(BaseModel):
    items: list[ChecklistRunResponse]
    total: int
