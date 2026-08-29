"""sites — 양식장. org 스코프 앵커.

sprint-0 2.5절 최소 컬럼: id, org_id, name, region, ras_type.
phase-2 1.7절: alert_enabled_types(JSON) — 알림 구독 on/off 스위치(채널 없음, 최소안).
"""

from __future__ import annotations

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

_JsonType = JSON().with_variant(JSONB(), "postgresql")

# 기본값: 3종 알림 타입 전부 on(phase-2.md 1.7절).
DEFAULT_ALERT_ENABLED_TYPES: dict[str, bool] = {
    "do_low": True,
    "mortality_spike": True,
    "kpi_red": True,
}


class Site(Base):
    __tablename__ = "sites"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # 테넌트 격리 앵커. RLS 정책이 이 컬럼으로 강제된다(2.3절).
    org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    region: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # RAS 유형(예: 'indoor_ras'). 스프린트 0 은 자유 문자열.
    ras_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 알림 구독 스위치(phase-2 1.7절). off 인 type 은 배치가 alert 생성 자체를 차단한다.
    alert_enabled_types: Mapped[dict] = mapped_column(
        _JsonType, nullable=False, default=lambda: dict(DEFAULT_ALERT_ENABLED_TYPES)
    )
