"""emission_factors 스키마 — phase-3.md 1.1절.

`POST`/`GET /emission-factors` 요청/응답. 수정/삭제 스키마는 없다(append-only, 1.1절).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class EmissionFactorCreateRequest(BaseModel):
    """POST /emission-factors 요청 바디(1.1절 컬럼 그대로)."""

    factor_tco2e_per_mwh: float = Field(..., gt=0)
    source: str = Field(..., max_length=255)
    year: int
    version: str = Field(..., max_length=32)
    effective_from: datetime


class EmissionFactorResponse(BaseModel):
    """201 응답 + GET 재사용(내부 조회용)."""

    id: str
    factor_tco2e_per_mwh: float
    source: str
    year: int
    version: str
    effective_from: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class EmissionFactorListResponse(BaseModel):
    """GET /emission-factors 응답 — effective_from 내림차순(활성값이 items[0])."""

    items: list[EmissionFactorResponse]
