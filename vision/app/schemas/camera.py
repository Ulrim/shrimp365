"""Camera schemas.

원본은 farm_id + tank_number(정수) 였다. 통합판은 shrimp365 수조를 가리키는
tank_id 하나로 바뀐다 — 수조 이름·번호는 shrimp365 가 들고 있으므로 여기서
따로 적으면 두 이름이 어긋난다.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CameraType = Literal["picamera", "usb", "rtsp", "http"]
CameraStatusValue = Literal["online", "offline", "error", "running"]


class CameraCreate(BaseModel):
    tank_id: uuid.UUID
    name: str = Field(max_length=100)
    stream_url: str | None = None
    camera_type: CameraType = "usb"
    resolution_w: int = 1920
    resolution_h: int = 1080
    fps_target: float = Field(default=1, ge=0.5, le=5)
    is_active: bool = True
    install_height: float | None = None
    tank_area_m2: float | None = None
    # 이 카메라가 달린 장비 이름. 비전 서비스가 여러 대일 때 누가 맡을지 가른다.
    host_id: str | None = Field(default=None, max_length=64)


class CameraUpdate(BaseModel):
    """부분 수정. 보내지 않은 항목은 건드리지 않는다.

    수정에까지 전체 본문을 요구하면 화면이 "이름만 바꾸기"를 하려다
    fps_target 같은 값을 기본값으로 되돌려 버린다.
    """

    name: str | None = Field(default=None, max_length=100)
    stream_url: str | None = None
    camera_type: CameraType | None = None
    resolution_w: int | None = None
    resolution_h: int | None = None
    fps_target: float | None = Field(default=None, ge=0.5, le=5)
    is_active: bool | None = None
    install_height: float | None = None
    tank_area_m2: float | None = None
    host_id: str | None = Field(default=None, max_length=64)


class CameraSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tank_id: uuid.UUID
    name: str
    stream_url: str | None = None
    camera_type: CameraType
    resolution_w: int
    resolution_h: int
    fps_target: float
    is_active: bool
    install_height: float | None = None
    tank_area_m2: float | None = None
    host_id: str | None = None
    created_at: datetime


class CameraStatusSchema(BaseModel):
    camera_id: uuid.UUID
    status: CameraStatusValue
    message: str | None = None
