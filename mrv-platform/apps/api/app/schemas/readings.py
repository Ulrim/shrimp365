"""ReadingsResponse Pydantic 스키마 — phase-2 4.1절 계약.

`GET /sites/{site_id}/readings` 는 **차트 전용 표시값**을 반환한다. 이 응답의 `value` 는
KPI 산식(compute_ei 등)에 절대 투입되지 않는다(4.1절 명시, Rule 1 무관 — architect/
backend-engineer 소관 표시 로직).
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Granularity = Literal["raw", "hourly", "daily"]
QualityFlag = Literal["ok", "suspect", "bad"]


class ReadingPoint(BaseModel):
    """단일 표시 포인트(원본 1행 또는 집계 1버킷)."""

    ts: datetime = Field(..., description="시각(raw=원본 ts, 집계=버킷 시작 시각, UTC)")
    value: float = Field(..., description="표시값(power=합/그 외=평균). KPI 미투입")
    quality_flag: QualityFlag = Field(
        ..., description="품질 플래그. 집계 시 bad>suspect>ok 우선순위 규칙(4.1절)"
    )
    meter_id: str | None = Field(
        default=None,
        description=(
            "이 포인트의 출처 계측기 ID(additive 확장). tank_id+type 조회처럼 "
            "복수 계측기가 병합되는 경우 어느 계측기인지 구분하기 위함."
        ),
    )


class ReadingsResponse(BaseModel):
    """GET /sites/{site_id}/readings 응답(phase-2 4.1절)."""

    site_id: str
    meter_id: str | None = Field(
        default=None,
        description="meter_id 단일 조회일 때만 채움. tank_id+type 조회는 null(4.1절 확장 규칙)",
    )
    type: str = Field(..., description="계측 타입(power/do/temp/ph/orp/ec)")
    granularity: Granularity
    unit: str = Field(..., description="표시 단위(예: kWh, mg/L)")
    points: list[ReadingPoint]
