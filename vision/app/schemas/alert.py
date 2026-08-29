"""Alert config schemas.

경보 **이력** 스키마는 없다. 발생한 경보는 shrimp365 의 alerts 표에 적히고
화면도 거기서 읽는다(app/models/alert.py 주석 참고).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

AlertType = Literal["count_drop", "count_spike", "offline", "threshold"]


class AlertConfigCreateSchema(BaseModel):
    # null 이면 그 사용자의 모든 카메라에 적용되는 기본 설정.
    camera_id: uuid.UUID | None = None
    user_id: uuid.UUID
    alert_type: AlertType
    threshold_value: float | None = None
    threshold_pct: float | None = None
    window_minutes: int = 10
    is_enabled: bool = True
    notify_email: str | None = None
    notify_webhook: str | None = None


class AlertConfigSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    camera_id: uuid.UUID | None = None
    user_id: uuid.UUID
    alert_type: AlertType
    threshold_value: float | None = None
    threshold_pct: float | None = None
    window_minutes: int
    is_enabled: bool
    notify_email: str | None = None
    notify_webhook: str | None = None
    created_at: datetime
