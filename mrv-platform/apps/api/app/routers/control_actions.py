"""승인형 제어 콘솔 API — phase-3.md 3절(★핵심: DB CHECK 제약으로 승인 게이트 물리적 강제).

POST /control-actions               : 제안 등록(require_writer + ENTERPRISE).
POST /control-actions/{id}/approve  : pending → approved 만 허용(그 외 409).
POST /control-actions/{id}/reject   : pending → rejected 만 허용(그 외 409).
POST /control-actions/{id}/apply    : ★ approved 일 때만 허용(그 외 409 "control action not
                                       approved" — 승인 게이트의 핵심 실행 지점).
GET  /control-actions?site_id=&status=  : 대기열 조회(ENTERPRISE 만, viewer 도 조회 가능).
GET  /control-actions/{id}              : 단건 조회(ENTERPRISE 만, viewer 도 조회 가능).

DB CHECK 제약(`control_actions` 마이그레이션 0012)이 최종 방어선이다 — 이 라우터의 상태
전이 검사는 그 위에 얹힌 API 계층 이중 방어(3.1절).
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_db, require_plan, require_writer
from app.models.control_action import ControlAction
from app.models.recipe import Recipe
from app.schemas.control_action import (
    ControlActionApplyRequest,
    ControlActionCreateRequest,
    ControlActionListResponse,
    ControlActionRejectRequest,
    ControlActionResponse,
)
from app.services.audit import record_audit
from app.services.tenancy import (
    resolve_control_action_for_org,
    resolve_recipe_version_for_org,
    resolve_site_for_org,
    resolve_tank_for_org,
)

router = APIRouter(tags=["control-actions"])

_ENTERPRISE = ("ENTERPRISE",)


@router.post(
    "/control-actions",
    response_model=ControlActionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="제어 액션 제안 등록(require_writer + ENTERPRISE, 3.2절).",
)
def propose_control_action(
    payload: ControlActionCreateRequest,
    auth: AuthContext = Depends(require_writer),
    _plan_auth: AuthContext = Depends(require_plan(*_ENTERPRISE)),
    session: Session = Depends(get_db),
) -> ControlActionResponse:
    # 3중 방어(3번째): tank/recipe_version 소유권 각각 재검증(403/404).
    tank = resolve_tank_for_org(session, payload.tank_id, auth.org_id)
    recipe_version = resolve_recipe_version_for_org(
        session, payload.recipe_version_id, auth.org_id
    )

    # 같은 org 라도 tank 와 recipe(recipe_version의 부모)가 서로 다른 site 소속이면
    # "다른 site 의 물/설비 데이터로 산출된 추천을 엉뚱한 site 의 tank 에 적용" 하는
    # 도메인 오류가 된다(org 격리는 통과하지만 의미상 무효 — Rule 4 와는 별개의 방어).
    recipe = session.execute(
        select(Recipe).where(Recipe.id == recipe_version.recipe_id)
    ).scalar_one()
    if recipe.site_id != tank.site_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="tank and recipe_version belong to different sites",
        )

    # 등록 시점 스냅샷 복사(이후 recipe 가 새 버전으로 바뀌어도 이 행은 불변).
    recommended_json = dict(recipe_version.params_json)

    ca_id = f"ca-{uuid4().hex}"
    ca = ControlAction(
        id=ca_id,
        tank_id=tank.id,
        recipe_version_id=recipe_version.id,
        site_id=tank.site_id,
        org_id=auth.org_id,
        recommended_json=recommended_json,
        status="pending",
    )
    session.add(ca)
    session.flush()

    record_audit(
        session,
        org_id=auth.org_id,
        actor_id=auth.user_id,
        entity="control_actions",
        entity_id=ca_id,
        action="propose",
        diff={
            "before": None,
            "after": {
                "tank_id": tank.id,
                "recipe_version_id": recipe_version.id,
                "site_id": tank.site_id,
                "status": "pending",
                "recommended_json": recommended_json,
            },
        },
    )
    session.commit()
    session.refresh(ca)
    return ControlActionResponse.model_validate(ca)


@router.post(
    "/control-actions/{control_action_id}/approve",
    response_model=ControlActionResponse,
    summary="pending → approved 만 허용(그 외 409, require_writer + ENTERPRISE, 3.2절).",
)
def approve_control_action(
    control_action_id: str,
    auth: AuthContext = Depends(require_writer),
    _plan_auth: AuthContext = Depends(require_plan(*_ENTERPRISE)),
    session: Session = Depends(get_db),
) -> ControlActionResponse:
    ca = resolve_control_action_for_org(session, control_action_id, auth.org_id)

    if ca.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="invalid transition"
        )

    before_status = ca.status
    ca.approved_by = auth.user_id
    ca.approved_at = datetime.now(UTC)
    ca.status = "approved"
    session.flush()

    record_audit(
        session,
        org_id=auth.org_id,
        actor_id=auth.user_id,
        entity="control_actions",
        entity_id=ca.id,
        action="approve",
        diff={
            "before": {"status": before_status},
            "after": {
                "status": "approved",
                "approved_by": ca.approved_by,
                "approved_at": ca.approved_at.isoformat(),
            },
        },
    )
    session.commit()
    session.refresh(ca)
    return ControlActionResponse.model_validate(ca)


@router.post(
    "/control-actions/{control_action_id}/reject",
    response_model=ControlActionResponse,
    summary="pending → rejected 만 허용(그 외 409, require_writer + ENTERPRISE, 3.2절).",
)
def reject_control_action(
    control_action_id: str,
    payload: ControlActionRejectRequest,
    auth: AuthContext = Depends(require_writer),
    _plan_auth: AuthContext = Depends(require_plan(*_ENTERPRISE)),
    session: Session = Depends(get_db),
) -> ControlActionResponse:
    ca = resolve_control_action_for_org(session, control_action_id, auth.org_id)

    if ca.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="invalid transition"
        )

    before_status = ca.status
    ca.status = "rejected"
    session.flush()

    # 승인 거부 사유는 result_json 이 아니라 audit_logs.note 로만 남긴다(3.2절, 오염 방지).
    record_audit(
        session,
        org_id=auth.org_id,
        actor_id=auth.user_id,
        entity="control_actions",
        entity_id=ca.id,
        action="reject",
        diff={"before": {"status": before_status}, "after": {"status": "rejected"}},
        note=payload.note,
    )
    session.commit()
    session.refresh(ca)
    return ControlActionResponse.model_validate(ca)


@router.post(
    "/control-actions/{control_action_id}/apply",
    response_model=ControlActionResponse,
    summary="★approved 일 때만 허용(그 외 409, 승인 게이트 핵심 실행 지점, 3.2절).",
)
def apply_control_action(
    control_action_id: str,
    payload: ControlActionApplyRequest,
    auth: AuthContext = Depends(require_writer),
    _plan_auth: AuthContext = Depends(require_plan(*_ENTERPRISE)),
    session: Session = Depends(get_db),
) -> ControlActionResponse:
    ca = resolve_control_action_for_org(session, control_action_id, auth.org_id)

    # ★ 승인 게이트의 핵심 실행 지점: approved 가 아니면 무조건 409(경합/우회 시도 포함).
    if ca.status != "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="control action not approved",
        )

    before_status = ca.status
    ca.applied_at = datetime.now(UTC)
    ca.result_json = payload.result_json
    ca.status = "applied"
    session.flush()

    record_audit(
        session,
        org_id=auth.org_id,
        actor_id=auth.user_id,
        entity="control_actions",
        entity_id=ca.id,
        action="apply",
        diff={
            "before": {"status": before_status},
            "after": {
                "status": "applied",
                "applied_at": ca.applied_at.isoformat(),
                "result_json": payload.result_json,
            },
        },
    )
    session.commit()
    session.refresh(ca)
    return ControlActionResponse.model_validate(ca)


@router.get(
    "/control-actions",
    response_model=ControlActionListResponse,
    summary="대기열 조회(ENTERPRISE, viewer 도 조회 가능 — require_writer 불요, 3.2절).",
)
def list_control_actions(
    site_id: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    auth: AuthContext = Depends(require_plan(*_ENTERPRISE)),
    session: Session = Depends(get_db),
) -> ControlActionListResponse:
    query = select(ControlAction).where(ControlAction.org_id == auth.org_id)

    if site_id is not None:
        # site 소유권 재검증(403/404) — org 소속이 아닌 site_id 로 필터링 시도 차단.
        resolve_site_for_org(session, site_id, auth.org_id)
        query = query.where(ControlAction.site_id == site_id)

    if status_filter is not None and status_filter != "all":
        query = query.where(ControlAction.status == status_filter)

    rows = session.execute(
        query.order_by(ControlAction.created_at.desc())
    ).scalars().all()

    return ControlActionListResponse(
        items=[ControlActionResponse.model_validate(r) for r in rows], total=len(rows)
    )


@router.get(
    "/control-actions/{control_action_id}",
    response_model=ControlActionResponse,
    summary="단건 조회(ENTERPRISE, viewer 도 조회 가능, 3.2절).",
)
def get_control_action(
    control_action_id: str,
    auth: AuthContext = Depends(require_plan(*_ENTERPRISE)),
    session: Session = Depends(get_db),
) -> ControlActionResponse:
    ca = resolve_control_action_for_org(session, control_action_id, auth.org_id)
    return ControlActionResponse.model_validate(ca)
