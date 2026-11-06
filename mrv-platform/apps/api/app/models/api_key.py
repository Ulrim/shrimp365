"""api_keys — ingestion 게이트웨이 인증(phase-1 3.3절).

phase-1 4절: id, org_id, site_id, key_hash, label, revoked, created_at.
- 원문 키는 저장 금지 — key_hash(단방향 해시)만 보관(비밀값 유출 방지).
- (org_id, site_id) 스코프로 ingestion 시 tenancy 를 확정(토픽/바디 불신).
- org_id 비정규화(RLS 를 조인 없이 적용).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, false, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # org_id 비정규화(RLS 앵커).
    org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    site_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # 키 원문의 단방향 해시(원문 저장 금지). 조회는 해시 비교로 수행.
    key_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    # 사람이 읽는 라벨(예: '서산 게이트웨이 A').
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 폐기 여부(True 면 인증 거부).
    revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
