"""GET /sites/{site_id}/kpi — sprint-0 2.2절 계약 라우터.

3중 방어 흐름:
  1) get_auth_context: JWT → org_id/role/user_id (deps.py).
  2) get_db: 세션에 SET app.current_org_id (RLS, deps.py/session.py).
  3) resolve_site_for_org: 서비스 레이어 재검증(tenancy.py) → 403/404.
그 뒤 kpi_service.compute_site_kpi 가 compute_ei 를 호출해 응답을 조립한다.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_auth_context, get_db
from app.schemas.kpi import KpiResponse
from app.services.kpi_service import compute_site_kpi
from app.services.tenancy import resolve_site_for_org

router = APIRouter(tags=["kpi"])


@router.get(
    "/sites/{site_id}/kpi",
    response_model=KpiResponse,
    response_model_by_alias=True,
    summary="사이트 KPI 산출(EI). 산출 파라미터·기간·근거 참조 ID 포함(MASTER 7장).",
)
def get_site_kpi(
    site_id: str,
    from_: datetime = Query(
        ..., alias="from", description="기간 시작(ISO8601, 포함)"
    ),
    to: datetime = Query(..., description="기간 끝(ISO8601, 반열림 상한)"),
    auth: AuthContext = Depends(get_auth_context),
    session: Session = Depends(get_db),
) -> KpiResponse:
    """기간 [from, to) 의 EI(ei_total/ei_aeration)를 산출해 KpiResponse 반환."""
    # 422: 기간 파라미터 오류(역전/동일).
    if from_ >= to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="'from' must be strictly before 'to'",
        )

    # 3번째 방어: site 소유권 재검증(403/404).
    resolve_site_for_org(session, site_id, auth.org_id)

    return compute_site_kpi(
        session=session,
        site_id=site_id,
        org_id=auth.org_id,
        period_from=from_,
        period_to=to,
    )
