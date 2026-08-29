"""shrimp365 수질 측정값(water_quality_readings)의 읽기 전용 매핑.

복합 경보(개체수 급감 + 용존산소 급락)를 판정할 때만 쓴다. 이 서비스는 수질
값을 쓰지 않는다 — 그건 센서 수집 경로(shrimp365 app/api/sensors/data)의 몫이다.

shrimp365 쪽 컬럼이 계속 늘고 있어(전도체·유량·차압…) 전부 옮겨 적지 않는다.
필요한 셋만 선언하면 저쪽에 컬럼이 추가돼도 이 서비스가 깨지지 않는다.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Numeric, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WaterQualityReading(Base):
    __tablename__ = "water_quality_readings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    tank_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    temperature: Mapped[float | None] = mapped_column(Numeric)
    ph: Mapped[float | None] = mapped_column(Numeric)
    do_level: Mapped[float | None] = mapped_column(Numeric)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
