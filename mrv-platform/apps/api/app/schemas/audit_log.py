"""감사 로그 뷰어 스키마 — phase-3.md 5절 계약."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class AuditLogEntry(BaseModel):
    id: str
    entity: str
    entity_id: str
    action: str
    actor_id: str
    diff: dict
    ts: datetime


class AuditLogListResponse(BaseModel):
    items: list[AuditLogEntry]
    total: int
