"""개체수 경보 **설정** 관리.

경보 이력은 여기에 없다 — 발생한 경보는 shrimp365 의 alerts 표에 적히고,
조회·해제도 거기서 한다(app/models/alert.py 주석 참고).
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import SessionDep
from app.models import AlertConfig, Camera
from app.schemas import AlertConfigCreateSchema, AlertConfigSchema
from app.services.alert_service import alert_service

router = APIRouter()


async def _validate_camera(session, camera_id: uuid.UUID | None) -> None:
    if camera_id is None:
        return
    if await session.get(Camera, camera_id) is None:
        raise HTTPException(status_code=404, detail="카메라를 찾을 수 없습니다.")


@router.get("/configs", response_model=list[AlertConfigSchema])
async def list_configs(
    session: SessionDep, user_id: uuid.UUID | None = None
) -> list[AlertConfig]:
    query = select(AlertConfig).order_by(AlertConfig.created_at)
    if user_id is not None:
        query = query.where(AlertConfig.user_id == user_id)
    result = await session.execute(query)
    return list(result.scalars())


@router.post("/configs", response_model=AlertConfigSchema, status_code=status.HTTP_201_CREATED)
async def create_config(payload: AlertConfigCreateSchema, session: SessionDep) -> AlertConfig:
    await _validate_camera(session, payload.camera_id)
    config = AlertConfig(**payload.model_dump())
    session.add(config)
    await session.commit()
    await session.refresh(config)
    alert_service.invalidate_config_cache()
    return config


@router.put("/configs/{config_id}", response_model=AlertConfigSchema)
async def update_config(
    config_id: uuid.UUID, payload: AlertConfigCreateSchema, session: SessionDep
) -> AlertConfig:
    config = await session.get(AlertConfig, config_id)
    if config is None:
        raise HTTPException(status_code=404, detail="경보 설정을 찾을 수 없습니다.")
    await _validate_camera(session, payload.camera_id)
    for key, value in payload.model_dump().items():
        setattr(config, key, value)
    await session.commit()
    await session.refresh(config)
    alert_service.invalidate_config_cache()
    return config


@router.delete("/configs/{config_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_config(config_id: uuid.UUID, session: SessionDep) -> None:
    config = await session.get(AlertConfig, config_id)
    if config is None:
        raise HTTPException(status_code=404, detail="경보 설정을 찾을 수 없습니다.")
    await session.delete(config)
    await session.commit()
    alert_service.invalidate_config_cache()
