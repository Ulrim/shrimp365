"""Count endpoints: latest values + bucketed history.

CSV 내보내기는 여기 없다. 화면(Next.js)이 Supabase 를 직접 읽으므로 내보내기도
거기서 한다 — 같은 데이터를 두 경로로 뽑으면 열 구성이 갈라진다.
이 서비스가 개체수 조회를 남겨 두는 이유는 **메모리 캐시** 때문이다.
방금 처리한 프레임의 값은 아직 DB 왕복 전이라 여기가 가장 빠르다.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.deps import SessionDep
from app.database import ensure_utc
from app.models import Camera, CountRecord
from app.schemas import CountBucketSchema, CountLatestSchema
from app.services.aggregation_service import aggregation_service
from app.services.stream_service import frame_store

router = APIRouter()

Interval = Literal["1m", "5m", "1h", "1d"]


async def _latest_for_camera(session, camera: Camera) -> CountLatestSchema | None:
    cached = frame_store.latest_count(camera.id)
    if cached is not None:
        return CountLatestSchema(
            camera_id=camera.id,
            tank_id=cached.tank_id,
            farm_id=cached.farm_id,
            timestamp=cached.timestamp,
            count=cached.count,
            confidence_avg=cached.confidence_avg,
        )
    row = (
        await session.execute(
            select(CountRecord)
            .where(CountRecord.camera_id == camera.id)
            .order_by(CountRecord.time.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return CountLatestSchema(
        camera_id=camera.id,
        tank_id=row.tank_id,
        farm_id=row.farm_id,
        timestamp=ensure_utc(row.time),
        count=row.count,
        confidence_avg=row.confidence_avg,
    )


@router.get("/latest", response_model=list[CountLatestSchema])
async def latest_counts(session: SessionDep) -> list[CountLatestSchema]:
    cameras = list((await session.execute(select(Camera))).scalars())
    out: list[CountLatestSchema] = []
    for camera in cameras:
        latest = await _latest_for_camera(session, camera)
        if latest is not None:
            out.append(latest)
    return out


@router.get("/{camera_id}/latest", response_model=CountLatestSchema)
async def latest_count(camera_id: uuid.UUID, session: SessionDep) -> CountLatestSchema:
    camera = await session.get(Camera, camera_id)
    if camera is None:
        raise HTTPException(status_code=404, detail="카메라를 찾을 수 없습니다.")
    latest = await _latest_for_camera(session, camera)
    if latest is None:
        raise HTTPException(status_code=404, detail="측정된 개체수 데이터가 없습니다.")
    return latest


@router.get("/{camera_id}/history", response_model=list[CountBucketSchema])
async def count_history(
    camera_id: uuid.UUID,
    session: SessionDep,
    start: datetime,
    end: datetime,
    interval: Interval = "1h",
) -> list[CountBucketSchema]:
    camera = await session.get(Camera, camera_id)
    if camera is None:
        raise HTTPException(status_code=404, detail="카메라를 찾을 수 없습니다.")
    buckets = await aggregation_service.history(session, camera_id, start, end, interval)
    return [CountBucketSchema(**b) for b in buckets]
