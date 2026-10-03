"""sop_checklist_runs — SOP 체크리스트 실행 기록(phase-3.md 2.2절). append-only.

SOP 문서 콘텐츠(제목/본문/체크리스트 정의) 자체는 DB 밖 정적 파일
(`apps/api/app/content/sop/manifest.json` + `{id}.md`)로 관리한다(2.1절 — 커스터마이즈
요구가 없으므로 테이블화하지 않는다). 이 테이블은 "누가 언제 무엇을 점검했는가"라는
증빙(MASTER 11장 "SOP PDF + 점검 체크리스트")만 최소로 영속화한다.

- sop_id: 정적 콘텐츠의 id. 콘텐츠가 DB 밖에 있으므로 FK 가 아니라 느슨한 참조(2.2절).
- site_id/org_id: RLS 앵커(비정규화, mrv_reports 와 동일 패턴).
- items_json: `[{ "item_id": "...", "checked": true, "note": "..." }]`.
- 수정/삭제 엔드포인트 없음(재점검은 새 행 — append-only, baseline/mrv_reports 와 동일 철학).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

# postgres 는 JSONB, 그 외(sqlite)는 JSON 으로 폴백(멀티백엔드 호환; 기존 패턴 재사용).
JsonType = JSON().with_variant(JSONB(), "postgresql")


class SopChecklistRun(Base):
    __tablename__ = "sop_checklist_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    site_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # org_id 비정규화(RLS 앵커).
    org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # 정적 콘텐츠(manifest.json)의 id. FK 아님(콘텐츠가 DB 밖에 있음, 2.2절).
    sop_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    items_json: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    performed_by: Mapped[str] = mapped_column(String(64), nullable=False)
    performed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
