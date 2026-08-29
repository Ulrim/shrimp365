"""emission_factors — 전력 배출계수(Rule 5: 하드코딩 금지, 버전 저장소).

phase-3.md 1.1절: `kpi_config` 와 동일 패턴(org 전역 설정, org_id 없음, RLS 비대상 — 국가
전력 배출계수는 테넌트별로 다르지 않다). append-only(수정/삭제 엔드포인트 없음, baseline과
동일 철학 — 과거 리포트가 참조한 배출계수 값이 사후 변경되면 증빙 무결성이 깨진다).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class EmissionFactor(Base):
    __tablename__ = "emission_factors"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # 전력 배출계수(tCO2e/MWh). 하드코딩 금지(Rule 5) — 이 테이블이 유일한 값 출처.
    factor_tco2e_per_mwh: Mapped[float] = mapped_column(Float, nullable=False)
    # 출처(예: "환경부 온실가스종합정보센터(GIR)"). 검증 가능성(Rule 5).
    source: Mapped[str] = mapped_column(String(255), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    # 버전 문자열(예: '2024-GIR-v1'). 리포트가 고정 참조(재현성).
    version: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    effective_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
