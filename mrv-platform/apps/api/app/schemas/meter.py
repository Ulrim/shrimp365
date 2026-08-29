"""계측기(meter) 등록/조회 스키마 — phase-3.md 7.2절(온보딩 "설치키트→센서매핑" 단계).

수정/삭제는 이번 Phase 범위 밖(설계서 명시 — 계측기 교체는 운영 이벤트라 신중해야 하고
과설계 회피). 생성(POST)/목록(GET)만 제공.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

MeterType = Literal["power", "do", "temp", "ph", "orp", "ec"]


class MeterCreateRequest(BaseModel):
    """POST /sites/{site_id}/meters 요청 바디(7.2절)."""

    type: MeterType
    unit: str
    is_aeration: bool = False
    tank_id: str | None = None
    label: str | None = None
    # MASTER 9장 규제훅(IoT/무선기기 KCC, 전기안전 KC 인증정보) "자리만". 선택, 자유 JSON.
    certification_info: dict[str, Any] | None = None


class MeterResponse(BaseModel):
    id: str
    site_id: str
    org_id: str
    type: str
    unit: str
    is_aeration: bool
    tank_id: str | None = None
    label: str | None = None
    certification_info: dict[str, Any] | None = None

    model_config = {"from_attributes": True}


class MeterListResponse(BaseModel):
    items: list[MeterResponse]
    total: int
