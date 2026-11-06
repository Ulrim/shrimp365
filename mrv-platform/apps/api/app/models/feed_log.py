"""feed_logs — 급이 기록. FCR 분자(Σ feed_kg) 근거.

phase-1 4절: id, batch_id, org_id, ts, feed_kg, source[manual|csv|device], quality_flag.
- source: 'manual' | 'csv' | 'device'(입력 경로).
- quality_flag: 'ok' | 'suspect' | 'bad'. FCR 엔진이 included_quality_flags 로 필터(phase-1 1.1절).
- org_id 비정규화(RLS 를 조인 없이 적용).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FeedLog(Base):
    __tablename__ = "feed_logs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    batch_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("batches.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # org_id 비정규화(RLS 앵커).
    org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # 급이량(kg). FCR 분자 합산 대상.
    feed_kg: Mapped[float] = mapped_column(Float, nullable=False)
    # 입력 경로: 'manual' | 'csv' | 'device'.
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    # 데이터 정합 플래그: 'ok' | 'suspect' | 'bad'.
    quality_flag: Mapped[str] = mapped_column(String(16), nullable=False, default="ok")
