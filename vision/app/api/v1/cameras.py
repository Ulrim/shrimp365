"""Camera CRUD + start/stop/status/snapshot.

카메라는 shrimp365 의 수조에 매달린다. 그래서 등록·수정 때 tank_id 가 실제로
있는 수조인지 확인하고, 그 수조의 양식장 id 를 함께 풀어 스트림에 넘긴다.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select

from app.api.deps import SessionDep
from app.models import Camera, Tank
from app.schemas import CameraCreate, CameraSchema, CameraStatusSchema, CameraUpdate
from app.services.camera_manager import MaxCamerasReachedError, camera_manager
from app.services.stream_service import frame_store

router = APIRouter()


async def _get_camera_or_404(session, camera_id: uuid.UUID) -> Camera:
    camera = await session.get(Camera, camera_id)
    if camera is None:
        raise HTTPException(status_code=404, detail="카메라를 찾을 수 없습니다.")
    return camera


async def _farm_id_of(session, tank_id: uuid.UUID) -> uuid.UUID:
    farm_id = (
        await session.execute(select(Tank.farm_id).where(Tank.id == tank_id))
    ).scalar_one_or_none()
    if farm_id is None:
        raise HTTPException(status_code=404, detail="수조를 찾을 수 없습니다.")
    return farm_id


@router.get("", response_model=list[CameraSchema])
async def list_cameras(session: SessionDep, tank_id: uuid.UUID | None = None) -> list[Camera]:
    query = select(Camera).order_by(Camera.created_at)
    if tank_id is not None:
        query = query.where(Camera.tank_id == tank_id)
    result = await session.execute(query)
    return list(result.scalars())


@router.post("", response_model=CameraSchema, status_code=status.HTTP_201_CREATED)
async def create_camera(payload: CameraCreate, session: SessionDep) -> Camera:
    await _farm_id_of(session, payload.tank_id)
    camera = Camera(**payload.model_dump())
    session.add(camera)
    await session.commit()
    await session.refresh(camera)
    return camera


@router.get("/{camera_id}", response_model=CameraSchema)
async def get_camera(camera_id: uuid.UUID, session: SessionDep) -> Camera:
    return await _get_camera_or_404(session, camera_id)


@router.patch("/{camera_id}", response_model=CameraSchema)
async def update_camera(
    camera_id: uuid.UUID, payload: CameraUpdate, session: SessionDep
) -> Camera:
    camera = await _get_camera_or_404(session, camera_id)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(camera, key, value)
    await session.commit()
    await session.refresh(camera)

    # 스트림이 도는 중에 설정이 바뀌면 돌고 있는 처리기는 옛 값을 들고 있다
    # (CameraSnapshot 은 시작 시점의 복사본이다). 껐다 켜서 새 값을 태운다.
    if camera_manager.is_running(camera_id) and changes:
        await camera_manager.stop_camera(camera_id)
        if camera.is_active:
            farm_id = await _farm_id_of(session, camera.tank_id)
            await camera_manager.start_camera(camera, farm_id)
    return camera


@router.delete("/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_camera(camera_id: uuid.UUID, session: SessionDep) -> None:
    camera = await _get_camera_or_404(session, camera_id)
    await camera_manager.stop_camera(camera_id)
    await session.delete(camera)
    await session.commit()


@router.post("/{camera_id}/start", status_code=status.HTTP_202_ACCEPTED)
async def start_camera(camera_id: uuid.UUID, session: SessionDep) -> dict[str, str]:
    camera = await _get_camera_or_404(session, camera_id)
    farm_id = await _farm_id_of(session, camera.tank_id)
    try:
        await camera_manager.start_camera(camera, farm_id)
    except MaxCamerasReachedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"detail": "스트림 추론을 시작했습니다."}


@router.post("/{camera_id}/stop", status_code=status.HTTP_202_ACCEPTED)
async def stop_camera(camera_id: uuid.UUID, session: SessionDep) -> dict[str, str]:
    await _get_camera_or_404(session, camera_id)
    stopped = await camera_manager.stop_camera(camera_id)
    detail = "스트림 추론을 중지했습니다." if stopped else "실행 중인 스트림이 없습니다."
    return {"detail": detail}


@router.get("/{camera_id}/status", response_model=CameraStatusSchema)
async def camera_status(camera_id: uuid.UUID, session: SessionDep) -> CameraStatusSchema:
    await _get_camera_or_404(session, camera_id)
    current, message = camera_manager.status_of(camera_id)
    return CameraStatusSchema(camera_id=camera_id, status=current, message=message)


@router.get(
    "/{camera_id}/snapshot",
    response_class=Response,
    responses={200: {"content": {"image/jpeg": {}}}},
)
async def camera_snapshot(camera_id: uuid.UUID, session: SessionDep) -> Response:
    await _get_camera_or_404(session, camera_id)
    jpeg = frame_store.latest_frame(camera_id)
    if jpeg is None and camera_manager.is_running(camera_id):
        jpeg = await frame_store.wait_for_frame(camera_id, timeout=3.0)
    if jpeg is None:
        raise HTTPException(
            status_code=404,
            detail="처리된 프레임이 없습니다. 스트림을 먼저 시작하세요.",
        )
    return Response(content=jpeg, media_type="image/jpeg")
