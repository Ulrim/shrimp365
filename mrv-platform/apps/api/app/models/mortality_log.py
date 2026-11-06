"""mortality_logs — 폐사 기록. 폐사율 분자(Σ dead_count) 근거.

phase-1 4절: id, batch_id, org_id, ts, dead_count, cause_note.
- dead_count: 폐사 개체수(음수 불가는 서비스/엔진에서 검증, phase-1 1.3절).
- cause_note: 원인 메모(선택).
- org_id 비정규화(RLS 를 조인 없이 적용).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MortalityLog(Base):
    __tablename__ = "mortality_logs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    batch_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("batches.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # org_id 비정규화(RLS 앵커).
    org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # 폐사 개체수(음수 불가). 폐사율 분자 합산 대상.
    dead_count: Mapped[int] = mapped_column(Integer, nullable=False)
    # 폐사 원인 메모(선택).
    cause_note: Mapped[str | None] = mapped_column(Text, nullable=True)
