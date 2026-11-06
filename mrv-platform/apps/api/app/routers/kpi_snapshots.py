"""kpi_snapshots 조회 API — phase-3.md 1.7절(검증 추적성 갭 보강).

GET /kpi-snapshots/{id} : 3중 테넌시 방어(site_id 로 org 재검증) 후 저장된 행 그대로 반환.
`before.kpi_snapshot_id`(baseline 스냅샷)/`after_kpi_snapshot_id`(MRV 리포트)를 클릭해 이
엔드포인트로 drill-down 하면 근거(inputs_json/provenance_json)까지 역추적 가능하다.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_auth_context, get_db
from app.models.kpi_snapshot import KpiSnapshot
from app.schemas.kpi import KpiPeriod
from app.schemas.kpi_snapshot import KpiSnapshotResponse
from app.services.tenancy import resolve_site_for_org

router = APIRouter(tags=["kpi-snapshots"])


@router.get(
    "/kpi-snapshots/{snapshot_id}",
    response_model=KpiSnapshotResponse,
    response_model_by_alias=True,
    summary="kpi_snapshots 1행 조회(drill-down 종착점, 1.7절).",
)
def get_kpi_snapshot(
    snapshot_id: str,
    auth: AuthContext = Depends(get_auth_context),
    session: Session = Depends(get_db),
) -> KpiSnapshotResponse:
    snap = session.get(KpiSnapshot, snapshot_id)
    if snap is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"kpi snapshot not found: {snapshot_id}",
        )
    # 3중 방어(3번째 계층): site_id 로 org 재검증(RLS-on 이면 애초에 조회 안 됨).
    resolve_site_for_org(session, snap.site_id, auth.org_id)

    return KpiSnapshotResponse(
        id=snap.id,
        site_id=snap.site_id,
        tank_id=snap.tank_id,
        org_id=snap.org_id,
        period=KpiPeriod(
            **{"from": snap.period_start, "to": snap.period_end, "granularity": "period"}
        ),
        ei_total=snap.ei_total,
        ei_aeration=snap.ei_aeration,
        oei=snap.oei,
        fcr=snap.fcr,
        mortality_rate=snap.mortality_rate,
        config_version=snap.config_version,
        inputs_json=snap.inputs_json,
        provenance_json=snap.provenance_json,
        generated_at=snap.generated_at,
    )
