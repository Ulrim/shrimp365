"""kpi_snapshots — 산출 결과 영속(append-only). baseline 의 전체 근거 저장소.

phase-1 4절: id, site_id, tank_id?, org_id, period_start, period_end,
  ei_total, ei_aeration, oei, fcr, mortality_rate, config_version,
  inputs_json, provenance_json, generated_at.
- append-only: 생성 후 수정하지 않는다(불변). 스칼라 지표 + 근거 JSON(drill-down).
- 지표 컬럼은 NULL 허용('산출 불가'=None 을 그대로 영속).
- inputs_json/provenance_json 은 엔진 결과의 근거 필드 직렬화(리포트 재현성).
- org_id 비정규화(RLS 를 조인 없이 적용).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

# postgres 는 JSONB, 그 외(sqlite)는 JSON 으로 폴백(멀티백엔드 호환; kpi_config 와 동일).
JsonType = JSON().with_variant(JSONB(), "postgresql")


class KpiSnapshot(Base):
    __tablename__ = "kpi_snapshots"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    site_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    # 수조 단위 스냅샷일 때만 사용(사이트 집계면 NULL).
    tank_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("tanks.id", ondelete="SET NULL"), nullable=True,
    )
    # org_id 비정규화(RLS 앵커).
    org_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # 4종 KPI 스칼라값(None='산출 불가' 허용).
    ei_total: Mapped[float | None] = mapped_column(Float, nullable=True)
    ei_aeration: Mapped[float | None] = mapped_column(Float, nullable=True)
    oei: Mapped[float | None] = mapped_column(Float, nullable=True)
    fcr: Mapped[float | None] = mapped_column(Float, nullable=True)
    mortality_rate: Mapped[float | None] = mapped_column(Float, nullable=True)

    # 산출 시점 kpi_config version(추적 메타데이터).
    config_version: Mapped[str] = mapped_column(String(32), nullable=False)
    # 엔진 입력/근거 직렬화(drill-down·재현성). append-only.
    inputs_json: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    provenance_json: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
