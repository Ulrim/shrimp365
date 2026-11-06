"""alerts — 임계치 배치 평가 결과(phase-2 슬라이스 H, docs/design/phase-2.md 1.1절).

append-only + status 전이(open→ack)만 허용. baseline 처럼 물리적 불변까지는 과설계
(ack 는 감사 대상 상태 변경일 뿐 '산출값' 수정이 아니므로 트리거 방어 불요, 1.1절).
status 변경은 반드시 audit_logs 에 diff 기록(Rule 9, 라우터에서 수행).

- org_id 비정규화(RLS 앵커, phase-1 패턴 그대로).
- type/severity/status CHECK 제약(1.1절 그대로).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

# postgres 는 JSONB, 그 외(sqlite 테스트)는 JSON.
_JsonType = JSON().with_variant(JSONB(), "postgresql")


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (
        CheckConstraint(
            "type IN ('do_low', 'mortality_spike', 'kpi_red')", name="ck_alerts_type"
        ),
        CheckConstraint(
            "severity IN ('info', 'warning', 'critical')", name="ck_alerts_severity"
        ),
        CheckConstraint("status IN ('open', 'ack')", name="ck_alerts_status"),
    )

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
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    # 판정 근거(트리거값·임계값·source refs — drill-down).
    payload_json: Mapped[dict] = mapped_column(_JsonType, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    acked_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    acked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
