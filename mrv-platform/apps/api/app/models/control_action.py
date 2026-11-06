"""control_actions — 승인형 제어 콘솔(phase-3.md 3절, 화면11 ENTERPRISE).

★ 승인 게이트 물리적 강제(사용자 명시 요구, 3.1절): "운영자가 추천값을 실제 설비에 물리적으로
반영한 뒤, 그 사실과 결과를 시스템에 기록하는" human-in-the-loop 흐름(3.0절). 상태 전이
pending → approved → applied 를 DB CHECK 제약으로 물리적으로 막는다(ADR 0002 "관례만으로는
부족하다" 철학 재사용):
  - status='applied' 인데 approved_at 이 NULL → CHECK 위반(적용은 반드시 승인 시각을 동반).
  - status='approved' 인데 approved_by 가 NULL → CHECK 위반(승인은 반드시 승인자를 동반).
이 두 CHECK 는 Postgres/SQLite 양쪽에서 공통으로 지원되므로(과설계 없이) 방언 분기 없이
__table_args__ 에 직접 선언한다 — baseline 의 BEFORE UPDATE 트리거(Postgres 전용)와 달리
CHECK 제약은 sqlite 도 네이티브로 강제하므로 애플리케이션 버그·수동 SQL 우회 시도를 테스트
DB(sqlite)에서도 그대로 검증할 수 있다.

API 계층 이중 방어(1차): `apply` 엔드포인트는 현재 status 가 정확히 'approved' 일 때만
전이를 허용하고 그 외는 전부 409(3.2절).

recommended_json 은 제안 등록 시점 `recipe_versions.params_json` 스냅샷(불변, baseline 과
동일 스냅샷 철학 — 이후 recipe 가 새 버전으로 바뀌어도 이 행은 영향받지 않는다).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

# postgres 는 JSONB, 그 외(sqlite)는 JSON 으로 폴백(기존 패턴 재사용).
JsonType = JSON().with_variant(JSONB(), "postgresql")


class ControlAction(Base):
    __tablename__ = "control_actions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'applied')",
            name="ck_control_actions_status",
        ),
        # ★ 승인 게이트 물리적 강제(3.1절) — Postgres/SQLite 공통 CHECK.
        CheckConstraint(
            "status != 'applied' OR approved_at IS NOT NULL",
            name="ck_control_actions_applied_requires_approved_at",
        ),
        CheckConstraint(
            "status != 'approved' OR approved_by IS NOT NULL",
            name="ck_control_actions_approved_requires_approved_by",
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tank_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("tanks.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    recipe_version_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("recipe_versions.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    # RLS 앵커(보강, tanks 경유 조회 비용 줄이기 위한 비정규화, 3.1절).
    site_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # 후보 등록 시점 recipe_versions.params_json 스냅샷(불변).
    recommended_json: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    # 'pending' | 'approved' | 'rejected' | 'applied'.
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", index=True
    )
    approved_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    applied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 적용 후 운영자가 기록한 관측/결과. 승인 거부 사유는 여기 담지 않는다(audit_logs.note).
    result_json: Mapped[dict | None] = mapped_column(JsonType, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
