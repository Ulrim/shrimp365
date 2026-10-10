"""tanks — 수조. DO 목표대역(OEI band 근거) 보유.

phase-1 4절: id, site_id, org_id, name, volume_m3, target_do_min, target_do_max.
- target_do_min/max 는 OEI 산출의 DoBand(목표대역) 근거(phase-1 1.2절).
- org_id 비정규화(RLS 를 조인 없이 적용).
"""

from __future__ import annotations

from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Tank(Base):
    __tablename__ = "tanks"

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
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # 수조 용적(m^3). 선택.
    volume_m3: Mapped[float | None] = mapped_column(Float, nullable=True)
    # DO 목표대역 하한/상한(mg/L). OEI DoBand 근거. 선택(미설정 시 OEI 산출 불가).
    target_do_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_do_max: Mapped[float | None] = mapped_column(Float, nullable=True)
