"""CountRecord ORM model (count_records).

원본은 TimescaleDB 하이퍼테이블이라 기본키가 없었고, SQLAlchemy 매핑을 위해
(time, camera_id) 를 억지로 복합키로 삼았다. 통합판은 Supabase 의 일반
테이블이고 마이그레이션에서 (camera_id, time) 을 진짜 기본키로 선언하므로
여기 매핑과 DB 가 정확히 일치한다.

tank_id·farm_id 는 카메라에서 유도할 수 있지만 같이 적는다 — 조회가 거의 전부
수조·양식장 단위라, 수백만 행에 매번 조인을 붙이지 않기 위해서다.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class CountRecord(Base):
    __tablename__ = "count_records"

    camera_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    time: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    tank_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    farm_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False)
    confidence_avg: Mapped[float | None] = mapped_column(Float)
    frame_path: Mapped[str | None] = mapped_column(String)
    model_version: Mapped[str | None] = mapped_column(String)
    inference_ms: Mapped[int | None] = mapped_column(Integer)
    #: 이 프레임에서 잰 몸길이의 가운뎃값(cm). 먹이망 격자로 축척을 잡은
    #: 장비에서만 들어온다 — 안 잡았으면 NULL 이다. 상자에서 잰 추정값이라
    #: 개별 한 마리의 자를 대신하지 못한다(app/services/tuning.py 머리말).
    length_cm: Mapped[float | None] = mapped_column(Float)
