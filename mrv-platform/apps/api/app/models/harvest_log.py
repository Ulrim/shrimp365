"""harvest_logs — 생체량 시점 근거(EI 분모 Δbiomass 의 개시/마감).

sprint-0 2.5절: id, batch_id?, site_id, org_id, ts, biomass_kg, count.
- batch_id 는 nullable(스프린트 0 은 site 단위 개시/마감 2행만).
- org_id 비정규화(RLS 를 조인 없이 적용).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class HarvestLog(Base):
    __tablename__ = "harvest_logs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # 배치 식별자. Phase 1(S0)에서 batches.id FK 로 연결(기존 site 단위 행은 nullable 유지).
    batch_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("batches.id", ondelete="SET NULL"), nullable=True,
    )
    site_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # 시점 생체량(kg). EI 분모 Δbiomass 산출 근거.
    biomass_kg: Mapped[float] = mapped_column(Float, nullable=False)
    # 개체 수(선택).
    count: Mapped[int | None] = mapped_column(Integer, nullable=True)
