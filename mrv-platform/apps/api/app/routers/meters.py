"""계측기(meter) 등록/조회 API — phase-3.md 7.2절(온보딩 "설치키트→센서매핑" 단계, 현재 갭 보강).

POST /sites/{site_id}/meters : require_writer. tank_id 지정 시 site 소속 재검증(3중 방어).
GET  /sites/{site_id}/meters : 목록 조회(센서 매핑 화면이 현재 등록된 계측기를 보여주는 데 필요).

수정/삭제 엔드포인트는 만들지 않는다(설계서 명시 — 계측기 교체는 운영 이벤트라 신중해야 함).
"""

from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_auth_context, get_db, require_writer
from app.models.meter import Meter
from app.schemas.meter import MeterCreateRequest, MeterListResponse, MeterResponse
from app.services.audit import record_audit
from app.services.tenancy import resolve_site_for_org, resolve_tank_for_site

router = APIRouter(tags=["meters"])


@router.post(
    "/sites/{site_id}/meters",
    response_model=MeterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="계측기 등록(온보딩 센서매핑 단계, require_writer, 7.2절).",
)
def create_meter(
    site_id: str,
    payload: MeterCreateRequest,
    auth: AuthContext = Depends(require_writer),
    session: Session = Depends(get_db),
) -> MeterResponse:
    resolve_site_for_org(session, site_id, auth.org_id)
    if payload.tank_id is not None:
        # 3중 방어: tank_id 가 지정되면 동일 site/org 소속인지 재검증(404/403).
        resolve_tank_for_site(session, payload.tank_id, site_id, auth.org_id)

    meter_id = f"mtr-{uuid4().hex}"
    meter = Meter(
        id=meter_id,
        site_id=site_id,
        org_id=auth.org_id,
        type=payload.type,
        unit=payload.unit,
        is_aeration=payload.is_aeration,
        tank_id=payload.tank_id,
        label=payload.label,
        certification_info=payload.certification_info,
    )
    session.add(meter)
    session.flush()

    record_audit(
        session,
        org_id=auth.org_id,
        actor_id=auth.user_id,
        entity="meters",
        entity_id=meter_id,
        action="create",
        diff={
            "before": None,
            "after": {
                "type": payload.type,
                "unit": payload.unit,
                "is_aeration": payload.is_aeration,
                "tank_id": payload.tank_id,
                "label": payload.label,
                "certification_info": payload.certification_info,
            },
        },
    )
    session.commit()

    return MeterResponse.model_validate(meter)


@router.get(
    "/sites/{site_id}/meters",
    response_model=MeterListResponse,
    summary="계측기 목록 조회(센서 매핑 화면, 7.2절).",
)
def list_meters(
    site_id: str,
    auth: AuthContext = Depends(get_auth_context),
    session: Session = Depends(get_db),
) -> MeterListResponse:
    resolve_site_for_org(session, site_id, auth.org_id)

    rows = session.execute(
        select(Meter).where(Meter.site_id == site_id).order_by(Meter.id)
    ).scalars().all()

    return MeterListResponse(
        items=[MeterResponse.model_validate(r) for r in rows], total=len(rows)
    )
