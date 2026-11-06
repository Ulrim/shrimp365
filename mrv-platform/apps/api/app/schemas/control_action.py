"""승인형 제어 콘솔 스키마 — phase-3.md 3.1/3.2절 계약.

`POST /control-actions`(제안) → `.../approve` | `.../reject` → `.../apply`(승인된 건만).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ControlActionCreateRequest(BaseModel):
    """POST /control-actions 요청 바디(3.2절). site_id 는 tank 에서 파생(요청에 없음)."""

    tank_id: str
    recipe_version_id: str


class ControlActionRejectRequest(BaseModel):
    """POST /control-actions/{id}/reject 요청 바디(3.2절). 사유는 audit_logs.note 로만."""

    note: str | None = None


class ControlActionApplyRequest(BaseModel):
    """POST /control-actions/{id}/apply 요청 바디(3.2절)."""

    result_json: dict


class ControlActionResponse(BaseModel):
    """control_actions 1행 응답 공용 shape(제안/승인/거부/적용/조회 전부 동일)."""

    id: str
    tank_id: str
    recipe_version_id: str
    site_id: str
    org_id: str
    recommended_json: dict
    status: str
    approved_by: str | None = None
    approved_at: datetime | None = None
    applied_at: datetime | None = None
    result_json: dict | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ControlActionListResponse(BaseModel):
    items: list[ControlActionResponse]
    total: int
