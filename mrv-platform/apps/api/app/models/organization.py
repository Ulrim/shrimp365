"""organizations — 테넌트 루트(멀티테넌시 앵커).

sprint-0 2.5절 최소 컬럼: id, name, plan, created_at.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Organization(Base):
    __tablename__ = "organizations"

    # UUID 문자열 PK(테넌트 루트). sqlite/postgres 공통 호환 위해 String 사용.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # 구독 플랜(START/PRO 등). 스프린트 0 시드는 'START'.
    plan: Mapped[str] = mapped_column(String(32), nullable=False, default="START")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
