"""추천(운전 레시피) 스키마 — phase-2 슬라이스 K(docs/design/phase-2.md 2.3절)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

RecipeType = Literal["feed", "oxygen", "circulation"]


class RecommendationItem(BaseModel):
    """단일 타입(feed/oxygen/circulation) 추천 산출 결과(2.3절 응답 shape).

    `source_refs` 는 2.3절 예시 JSON 에는 없으나 MASTER 11장 "룰셋/버전이력" 증빙의
    drill-down 근거 추적성(architect 서문 "판정 근거를 언제나 응답에 포함")을 위해 추가한
    필드다 — 계약을 깨지 않는 순수 additive 필드.
    """

    type: RecipeType
    recipe_id: str
    current_version: int
    params: dict[str, Any]
    rationale: str
    source_refs: list[str] = Field(default_factory=list)
    config_version: str
    generated_at: datetime


class RecommendationsResponse(BaseModel):
    """GET /sites/{site_id}/recommendations 응답(2.3절)."""

    site_id: str
    items: list[RecommendationItem]
    status: Literal["recommend_only"] = "recommend_only"


class RecipeVersionCreate(BaseModel):
    """POST /recipes/{id}/versions 요청 바디(2.3절 하단, 수동 버전 추가)."""

    params: dict[str, Any]
    rationale: str

    model_config = {"extra": "forbid"}


class RecipeVersionResponse(BaseModel):
    """POST /recipes/{id}/versions 응답(201, 새 recipe_versions 행)."""

    id: str
    recipe_id: str
    version: int
    params: dict[str, Any]
    rationale: str
    created_by: str
    created_at: datetime
