"""GET /sites/{site_id}/readings — phase-2 4.1절 계약 라우터(대시보드 실데이터 전환).

3중 방어 흐름(kpi.py 관례 재사용):
  1) get_auth_context: JWT → org_id/role/user_id (deps.py).
  2) get_db: 세션에 SET app.current_org_id (RLS, deps.py/session.py).
  3) resolve_site_for_org: 서비스 레이어 재검증(tenancy.py) → 403/404.
     + readings_service 내부에서 meter/tank 소유권 2차 재검증(403/404).

★ Rule 1 무관: 이 엔드포인트는 차트 전용 조회이며 KPI 산식과 무관하다(4.1절 명시).
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_auth_context, get_db
from app.schemas.readings import ReadingsResponse
from app.services import readings_service
from app.services.tenancy import resolve_site_for_org

router = APIRouter(tags=["readings"])

_VALID_GRANULARITIES = ("raw", "hourly", "daily")


@router.get(
    "/sites/{site_id}/readings",
    response_model=ReadingsResponse,
    summary="시계열 조회(대시보드 차트 전용, KPI 산식 미투입, phase-2 4.1절).",
)
def get_site_readings(
    site_id: str,
    meter_id: str | None = Query(
        default=None, description="단일 계측기 조회(tank_id+type 와 택일 이상)"
    ),
    tank_id: str | None = Query(
        default=None, description="수조 스코프 조회. type 과 함께 지정 필요"
    ),
    type_: str | None = Query(
        default=None, alias="type", description="tank_id 와 함께 지정하는 계측 타입"
    ),
    from_: datetime = Query(..., alias="from", description="기간 시작(ISO8601, 포함)"),
    to: datetime = Query(..., description="기간 끝(ISO8601, 반열림 상한)"),
    granularity: str = Query(
        default="raw", description="raw|hourly|daily(기본 raw)"
    ),
    auth: AuthContext = Depends(get_auth_context),
    session: Session = Depends(get_db),
) -> ReadingsResponse:
    """기간 [from, to) 시계열을 조회/집계해 ReadingsResponse 로 반환(4.1절)."""
    # 422: 파라미터 조합 오류 — meter_id 단일 또는 tank_id+type 중 하나 이상 필요.
    if not meter_id and not (tank_id and type_):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="either 'meter_id' or both 'tank_id' and 'type' are required",
        )
    # 422: granularity 값 검증.
    if granularity not in _VALID_GRANULARITIES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"granularity must be one of {_VALID_GRANULARITIES}",
        )

    # 422: 기간 파라미터 오류(역전/동일).
    if from_ >= to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="'from' must be strictly before 'to'",
        )

    # 3번째 방어: site 소유권 재검증(403/404).
    site = resolve_site_for_org(session, site_id, auth.org_id)

    return readings_service.get_site_readings(
        session=session,
        site=site,
        org_id=auth.org_id,
        meter_id=meter_id,
        tank_id=tank_id,
        type_=type_,
        period_from=from_,
        period_to=to,
        granularity=granularity,
    )
