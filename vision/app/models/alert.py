"""경보 설정(vision_alert_configs) + shrimp365 알림함(alerts) 매핑.

원본에는 alert_history 라는 자체 경보 이력 표가 있었다. 통합판에서는 만들지
않는다 — 발생한 경보를 shrimp365 의 `alerts` 에 적어야 헤더 알림함·웹푸시·
관제센터가 수질 경보와 똑같이 다룬다. 개체수 경보만 다른 곳에 쌓이면
사용자는 알림을 두 군데서 확인해야 한다.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow

ALERT_TYPES = ("count_drop", "count_spike", "offline", "threshold")

# shrimp365 alerts.parameter 에 적는 값. 수질 항목(temperature·ph…)과 같은
# 자리에 들어가므로, 화면이 개체수 경보를 골라낼 수 있게 이름을 고정한다.
COUNT_PARAMETER = "shrimp_count"


class AlertConfig(Base):
    __tablename__ = "vision_alert_configs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    camera_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("vision_cameras.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    alert_type: Mapped[str] = mapped_column(String, nullable=False)
    threshold_value: Mapped[float | None] = mapped_column(Float)
    threshold_pct: Mapped[float | None] = mapped_column(Float)
    window_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    notify_email: Mapped[str | None] = mapped_column(String)
    notify_webhook: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class ShrimpAlert(Base):
    """shrimp365 의 통합 알림함(public.alerts).

    이 서비스는 여기에 **쓰기만** 한다. 해제(resolved)는 사용자가 화면에서
    하거나 수질 경보 쪽 로직이 하므로 건드리지 않는다.
    """

    __tablename__ = "alerts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tank_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)  # danger / warning / info
    parameter: Mapped[str | None] = mapped_column(String)
    value: Mapped[float | None] = mapped_column(Float)
    threshold: Mapped[float | None] = mapped_column(Float)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
