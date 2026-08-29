"""audit_logs — 제어/설정 변경 감사 로그(Rule 9).

phase-1 4절 표에는 없으나 baseline lock·수기입력이 감사 기록을 요구한다(Rule 9 보강).
컬럼: id, org_id, actor_id, entity, entity_id, action, diff_json, ts.
- diff_json 은 {before, after} 형태의 변경 diff(생성은 before=null).
- append-only(수정하지 않는다). org_id 비정규화(RLS 를 조인 없이 적용).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

# postgres 는 JSONB, 그 외(sqlite)는 JSON 으로 폴백(멀티백엔드 호환).
JsonType = JSON().with_variant(JSONB(), "postgresql")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # org_id 비정규화(RLS 앵커).
    org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # 행위 주체(JWT user_id). users FK 를 강제하지 않는다(클레임 기반 sprint-0 관례).
    actor_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # 대상 엔터티 종류(예: 'baselines', 'feed_logs', 'mortality_logs').
    entity: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # 액션(예: 'lock', 'create').
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    # 변경 diff({before, after}). 생성은 before=null.
    diff_json: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    # 사유/비고(선택).
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
