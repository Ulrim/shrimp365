"""Aggregate v1 API router.

모든 경로가 서비스 키를 요구한다. 원본에 있던 /auth 와 /farms 는 없다 —
로그인은 shrimp365 가, 양식장·수조는 shrimp365 의 표가 소유한다.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import require_service_key
from app.api.v1 import alerts, cameras, counts

api_router = APIRouter()

_protected = [Depends(require_service_key)]
api_router.include_router(
    cameras.router, prefix="/cameras", tags=["cameras"], dependencies=_protected
)
api_router.include_router(
    counts.router, prefix="/counts", tags=["counts"], dependencies=_protected
)
api_router.include_router(
    alerts.router, prefix="/alerts", tags=["alerts"], dependencies=_protected
)


@api_router.get("/ping", tags=["meta"])
async def ping() -> dict[str, str]:
    return {"message": "pong"}
