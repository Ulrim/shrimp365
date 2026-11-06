"""batches 조회 — 수기입력 폼(급이/폐사)의 배치 선택 드롭다운 지원(FE 요청).

GET /sites/{site_id}/batches : site 의 batches 목록. 읽기이므로 모든 역할 허용.
3중 테넌시 방어(deps→RLS→resolve_site_for_org). batches 는 tanks 를 경유해 site 스코프.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_auth_context, get_db
from app.models.batch import Batch
from app.models.tank import Tank
from app.services.tenancy import resolve_site_for_org

router = APIRouter(tags=["batches"])


class BatchResponse(BaseModel):
    """배치 요약(드롭다운 표시용 최소 필드)."""

    id: str
    tank_id: str
    species: str
    stocked_count: int
    stocked_at: datetime
    closed_at: datetime | None


@router.get(
    "/sites/{site_id}/batches",
    response_model=list[BatchResponse],
    summary="site 의 배치 목록(수기입력 폼 배치 선택). 읽기: 전 역할 허용.",
)
def list_batches(
    site_id: str,
    auth: AuthContext = Depends(get_auth_context),
    session: Session = Depends(get_db),
) -> list[BatchResponse]:
    """site 소속 batches 를 tank 경유로 조회해 반환(org 스코프)."""
    resolve_site_for_org(session, site_id, auth.org_id)
    rows = session.execute(
        select(Batch)
        .join(Tank, Batch.tank_id == Tank.id)
        .where(Tank.site_id == site_id)
        .order_by(Batch.stocked_at, Batch.id)
    ).scalars().all()
    return [
        BatchResponse(
            id=b.id,
            tank_id=b.tank_id,
            species=b.species,
            stocked_count=b.stocked_count,
            stocked_at=b.stocked_at,
            closed_at=b.closed_at,
        )
        for b in rows
    ]
