"""alerts 스키마 — phase-2 슬라이스 H(docs/design/phase-2.md 1.6/1.7절)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

AlertType = Literal["do_low", "mortality_spike", "kpi_red"]
AlertSeverity = Literal["info", "warning", "critical"]
AlertStatus = Literal["open", "ack"]


class AlertItem(BaseModel):
    """단일 alert 행(1.6절 응답 shape)."""

    id: str
    type: AlertType
    severity: AlertSeverity
    payload: dict[str, Any]
    status: AlertStatus
    created_at: datetime
    acked_by: str | None = None
    acked_at: datetime | None = None


class AlertListResponse(BaseModel):
    """GET /sites/{site_id}/alerts 응답(1.6절)."""

    site_id: str
    org_id: str
    items: list[AlertItem]
    total: int


class AlertSubscriptionUpdate(BaseModel):
    """PATCH /sites/{site_id}/alert-subscriptions 요청 바디(1.7절).

    부분 갱신(전달된 키만 갱신). 알 수 없는 type 키는 422(Pydantic extra="forbid").
    """

    do_low: bool | None = Field(default=None)
    mortality_spike: bool | None = Field(default=None)
    kpi_red: bool | None = Field(default=None)

    model_config = {"extra": "forbid"}


class AlertSubscriptionResponse(BaseModel):
    """PATCH 응답: 갱신된 스위치 상태 전체(1.7절)."""

    site_id: str
    alert_enabled_types: dict[str, bool]
