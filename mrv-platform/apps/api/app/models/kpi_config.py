"""kpi_config — EI 산출 파라미터/버전(Rule 2·5 버전 추적).

sprint-0 2.5절: id, version, params_json, effective_from.
params_json 은 culiver_kpi.config.ei_config_from_params 로 EiConfig 에 매핑된다.
※ 이 테이블은 org 전역 설정이므로 org_id 를 두지 않는다(RLS 비대상).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

# postgres 는 JSONB, 그 외(sqlite)는 JSON 으로 폴백(멀티백엔드 호환).
JsonType = JSON().with_variant(JSONB(), "postgresql")


class KpiConfig(Base):
    __tablename__ = "kpi_config"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # 산출 버전(예: '2026.1.0'). 결과에 실려 추적되는 메타데이터.
    version: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    # EiConfig 파라미터(included_quality_flags, min_biomass_delta_kg 등).
    params_json: Mapped[dict] = mapped_column(JsonType, nullable=False, default=dict)
    # 이 버전이 유효해지는 시점.
    effective_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
