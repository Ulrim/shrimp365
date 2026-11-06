"""batches — 입식 사이클. stocked_count 는 mortality 분모 근거.

phase-1 4절: id, tank_id, org_id, species, stocked_count, stocked_at, closed_at.
- stocked_count: 기초 입식 개체수(폐사율 분모, phase-1 1.3절).
- closed_at: 마감 시각(진행 중이면 NULL).
- org_id 비정규화(RLS 를 조인 없이 적용).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Batch(Base):
    __tablename__ = "batches"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tank_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("tanks.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # org_id 비정규화(RLS 앵커).
    org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # 사육 품종(예: 'litopenaeus_vannamei' 흰다리새우).
    species: Mapped[str] = mapped_column(String(64), nullable=False)
    # 기초 입식 개체수(폐사율 분모). 음수 불가는 서비스/엔진에서 검증.
    stocked_count: Mapped[int] = mapped_column(Integer, nullable=False)
    stocked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # 마감 시각(진행 중이면 NULL).
    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
