"""shrimp365 가 소유한 표(farms·tanks)의 읽기 전용 매핑.

이 서비스는 양식장과 수조를 만들지 않는다 — 등록은 shrimp365 화면에서 한 번만
한다. 여기서는 "이 카메라가 달린 수조가 실제로 있는가", "그 수조의 양식장은
어디인가"를 확인하는 데만 쓴다. 그래서 shrimp365 쪽 컬럼을 전부 옮겨 적지
않고 필요한 것만 선언한다 — 저쪽에 컬럼이 늘어도 이 서비스가 깨지지 않는다.
"""
from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Farm(Base):
    __tablename__ = "farms"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)


class Tank(Base):
    __tablename__ = "tanks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    farm_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("farms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
