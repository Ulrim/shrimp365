"""Camera ORM model (vision_cameras table).

원본의 cameras 는 farm_id 를 직접 들고 tank_number 를 정수로 적었다. 통합판은
shrimp365 의 수조를 그대로 가리킨다(tank_id) — 양식장·수조를 두 곳에서 각각
등록하는 이중 관리를 없애는 것이 통합의 핵심이라 여기서 갈라진다.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, utcnow

CAMERA_TYPES = ("picamera", "usb", "rtsp", "http")


class Camera(Base):
    __tablename__ = "vision_cameras"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tank_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("tanks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    stream_url: Mapped[str | None] = mapped_column(String)
    camera_type: Mapped[str] = mapped_column(String, nullable=False, default="usb")
    resolution_w: Mapped[int] = mapped_column(Integer, nullable=False, default=1920)
    resolution_h: Mapped[int] = mapped_column(Integer, nullable=False, default=1080)
    fps_target: Mapped[float] = mapped_column(Float, nullable=False, default=1)  # 0.5 ~ 5
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    install_height: Mapped[float | None] = mapped_column(Float)
    tank_area_m2: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
