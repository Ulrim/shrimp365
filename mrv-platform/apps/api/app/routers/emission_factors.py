"""emission_factors 등록/조회 API — phase-3.md 1.1절(Rule 5: 배출계수 하드코딩 금지).

POST /emission-factors : owner 전용(조직 전역 설정 변경 리스크, `require_writer` 는 operator
까지 통과시켜 관대하므로 재사용하지 않는다 — organizations.py 4절 `require_owner` 와 동형).
GET  /emission-factors : 인증된 사용자 누구나 조회(전역 설정 열람은 쓰기보다 위험도가 낮다 —
MRV 리포트 생성 화면의 배출계수 선택 UI가 이 목록을 소비한다, 갭 보강).
수정/삭제 엔드포인트는 만들지 않는다(append-only — baseline 과 동일 철학, 1.1절).
"""

from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_auth_context, get_db, require_owner
from app.models.emission_factor import EmissionFactor
from app.schemas.emission_factor import (
    EmissionFactorCreateRequest,
    EmissionFactorListResponse,
    EmissionFactorResponse,
)
from app.services.audit import record_audit

router = APIRouter(tags=["emission-factors"])


@router.get(
    "/emission-factors",
    response_model=EmissionFactorListResponse,
    summary="전력 배출계수 목록 조회(effective_from 내림차순, 갭 보강).",
)
def list_emission_factors(
    _auth: AuthContext = Depends(get_auth_context),
    session: Session = Depends(get_db),
) -> EmissionFactorListResponse:
    rows = session.execute(
        select(EmissionFactor).order_by(EmissionFactor.effective_from.desc())
    ).scalars().all()
    return EmissionFactorListResponse(
        items=[EmissionFactorResponse.model_validate(r) for r in rows]
    )


@router.post(
    "/emission-factors",
    response_model=EmissionFactorResponse,
    status_code=status.HTTP_201_CREATED,
    summary="전력 배출계수 등록(owner 전용, append-only, 1.1절).",
)
def create_emission_factor(
    payload: EmissionFactorCreateRequest,
    auth: AuthContext = Depends(require_owner),
    session: Session = Depends(get_db),
) -> EmissionFactorResponse:
    """emission_factors 는 org 전역 설정(org_id 없음, RLS 비대상 — kpi_config 와 동형)이지만
    감사 로그(Rule 9)는 요청자의 org_id 로 남긴다(누가 등록했는지 추적)."""
    ef_id = f"ef-{uuid4().hex}"
    ef = EmissionFactor(
        id=ef_id,
        factor_tco2e_per_mwh=payload.factor_tco2e_per_mwh,
        source=payload.source,
        year=payload.year,
        version=payload.version,
        effective_from=payload.effective_from,
    )
    session.add(ef)

    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="an emission factor with this version already exists",
        ) from None

    record_audit(
        session,
        org_id=auth.org_id,
        actor_id=auth.user_id,
        entity="emission_factors",
        entity_id=ef_id,
        action="create",
        diff={
            "before": None,
            "after": {
                "factor_tco2e_per_mwh": payload.factor_tco2e_per_mwh,
                "source": payload.source,
                "year": payload.year,
                "version": payload.version,
                "effective_from": payload.effective_from.isoformat(),
            },
        },
    )
    session.commit()

    return EmissionFactorResponse.model_validate(ef)
