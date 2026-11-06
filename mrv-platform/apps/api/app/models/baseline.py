"""baselines — 기준선(잠금 후 불변). MRV 'Before' 기준(ADR 0002).

phase-1 2.1절 컬럼 전부: id, site_id, org_id, period_start/end,
  ei_total/ei_aeration/oei/fcr/mortality_rate(NULL 허용), config_version,
  kpi_snapshot_id(FK), status[draft|locked], locked_by/locked_at/created_at.

불변성(ADR 0002, Postgres): BEFORE UPDATE/DELETE 트리거로 locked 행 차단 +
  부분 유니크 인덱스 ux_baselines_one_locked(site_id) WHERE status='locked'.
  → 트리거/부분유니크는 마이그레이션에서 정의(Postgres 전용). sqlite 는 서비스 가드.
- org_id 비정규화(RLS 를 조인 없이 적용).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, String, event, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.orm.attributes import get_history

from app.db.base import Base


class BaselineImmutableError(Exception):
    """locked baseline 에 대한 UPDATE/DELETE 시도(ADR 0002 위반)."""


class Baseline(Base):
    __tablename__ = "baselines"
    __table_args__ = (
        # status 는 'draft' | 'locked' 만 허용(2.1절 CHECK 제약).
        CheckConstraint(
            "status IN ('draft', 'locked')", name="ck_baselines_status"
        ),
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
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # 잠금 스냅샷 스칼라값(None='산출 불가' 허용, 2.1절).
    ei_total: Mapped[float | None] = mapped_column(Float, nullable=True)
    ei_aeration: Mapped[float | None] = mapped_column(Float, nullable=True)
    oei: Mapped[float | None] = mapped_column(Float, nullable=True)
    fcr: Mapped[float | None] = mapped_column(Float, nullable=True)
    mortality_rate: Mapped[float | None] = mapped_column(Float, nullable=True)

    # 잠금 시점 kpi_config version 고정(MRV 'Before' 무결성, 2.4절).
    config_version: Mapped[str] = mapped_column(String(32), nullable=False)
    # 전체 근거(inputs/provenance) 영속 참조.
    kpi_snapshot_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("kpi_snapshots.id", ondelete="RESTRICT"), nullable=True,
    )
    # 상태: 'draft' | 'locked'. Phase 1 은 lock 이 유일 writer → 곧바로 'locked'.
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    # 잠금 주체(JWT user_id) / 잠금 시각.
    locked_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


def _committed_status(target: Baseline) -> str:
    """ORM 인스턴스의 '변경 전' status 값을 복원(트리거의 OLD.status 대응)."""
    hist = get_history(target, "status")
    if hist.deleted:
        return hist.deleted[0]
    if hist.unchanged:
        return hist.unchanged[0]
    return target.status


@event.listens_for(Baseline, "before_update")
def _prevent_locked_update(mapper, connection, target: Baseline) -> None:
    """ADR 0002 sqlite 폴백: locked 행 UPDATE 차단(Postgres 는 DB 트리거).

    Postgres 는 BEFORE UPDATE 트리거가 물리적으로 막지만, sqlite(테스트/로컬)는
    트리거가 없으므로 ORM 이벤트 가드로 동일 불변성을 강제한다.
    """
    if _committed_status(target) == "locked":
        raise BaselineImmutableError(
            f"baseline {target.id} is locked and immutable (ADR 0002)"
        )


@event.listens_for(Baseline, "before_delete")
def _prevent_locked_delete(mapper, connection, target: Baseline) -> None:
    """ADR 0002 sqlite 폴백: locked 행 DELETE 차단."""
    if target.status == "locked":
        raise BaselineImmutableError(
            f"baseline {target.id} is locked and immutable (ADR 0002)"
        )
