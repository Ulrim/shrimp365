"""readings — 시계열 계측값(TimescaleDB hypertable).

sprint-0 2.5절: time, meter_id, org_id, value, quality_flag.
- value = interval kWh(ADR 0001로 정규화된 값). KPI 엔진은 이를 단순 합산만 한다.
- hypertable 은 (time) 을 파티션 키로 쓰므로 복합 PK(time, meter_id)로 둔다.
- org_id 비정규화(RLS 를 조인 없이 적용; 2.3/2.5절).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Reading(Base):
    __tablename__ = "readings"

    # hypertable 파티션 키. 복합 PK 로 (time, meter_id) 구성.
    time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True, nullable=False
    )
    meter_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("meters.id", ondelete="CASCADE"),
        primary_key=True, nullable=False,
    )
    org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # interval kWh(ADR 0001). NULL 불가.
    value: Mapped[float] = mapped_column(Float, nullable=False)
    # 데이터 정합 플래그: 'ok' | 'suspect' | 'bad'.
    quality_flag: Mapped[str] = mapped_column(
        String(16), nullable=False, default="ok"
    )
