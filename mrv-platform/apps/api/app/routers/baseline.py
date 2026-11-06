"""baseline lock/조회 — phase-1 슬라이스 C(★ Phase 1 헤드라인, ADR 0002).

POST /sites/{site_id}/baseline/lock : 원자적 산출+영속화+잠금(불변).
GET  /sites/{site_id}/baseline      : 현재 locked baseline(없으면 404).

수정/삭제 엔드포인트는 만들지 않는다(ADR 0002 API 계약 계층 방어).
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_auth_context, get_db, require_writer
from app.models.baseline import Baseline
from app.schemas.baseline import (
    BaselineKpiConfig,
    BaselineLockRequest,
    BaselineMetrics,
    BaselineProvenance,
    BaselineResponse,
)
from app.schemas.kpi import KpiMetric, KpiPeriod
from app.services.audit import record_audit
from app.services.kpi_service import SiteKpiComputation, compute_site_kpi_results
from app.services.snapshots import persist_kpi_snapshot
from app.services.tenancy import resolve_site_for_org

router = APIRouter(tags=["baseline"])


def _metric(value: float | None, unit: str) -> KpiMetric:
    return KpiMetric(value=value, unit=unit, status="green" if value is not None else "na")


def _metrics_from_scalars(
    ei_total: float | None,
    ei_aeration: float | None,
    oei: float | None,
    fcr: float | None,
    mortality_rate: float | None,
) -> BaselineMetrics:
    return BaselineMetrics(
        ei_total=_metric(ei_total, "kWh/kg"),
        ei_aeration=_metric(ei_aeration, "kWh/kg"),
        oei=_metric(oei, "index"),
        fcr=_metric(fcr, "kg/kg"),
        mortality_rate=_metric(mortality_rate, "%"),
    )


def _row_to_response(bsl: Baseline) -> BaselineResponse:
    """저장된 baseline 행 → 응답(스칼라 5값 기반)."""
    return BaselineResponse(
        id=bsl.id,
        site_id=bsl.site_id,
        org_id=bsl.org_id,
        period=KpiPeriod(
            **{"from": bsl.period_start, "to": bsl.period_end, "granularity": "period"}
        ),
        status=bsl.status,
        metrics=_metrics_from_scalars(
            bsl.ei_total, bsl.ei_aeration, bsl.oei, bsl.fcr, bsl.mortality_rate
        ),
        kpi_config=BaselineKpiConfig(version=bsl.config_version),
        provenance=BaselineProvenance(kpi_snapshot_id=bsl.kpi_snapshot_id),
        locked_by=bsl.locked_by,
        locked_at=bsl.locked_at,
    )


@router.post(
    "/sites/{site_id}/baseline/lock",
    response_model=BaselineResponse,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
    summary="기준선 잠금(4종 KPI 산출→스냅샷 영속화→locked 삽입, 불변; ADR 0002).",
)
def lock_baseline(
    site_id: str,
    payload: BaselineLockRequest,
    auth: AuthContext = Depends(require_writer),
    session: Session = Depends(get_db),
) -> BaselineResponse:
    """단일 트랜잭션: 테넌시→기존 locked 확인(409)→4종 산출→스냅샷→locked 삽입→audit."""
    period_from = payload.period.from_
    period_to = payload.period.to
    # 422: 기간 파라미터 오류(역전/동일).
    if period_from >= period_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="'from' must be strictly before 'to'",
        )

    # 3중 방어(3번째): site 소유권 재검증(403/404).
    resolve_site_for_org(session, site_id, auth.org_id)

    # 기존 locked baseline 존재 → 선제적 409(재잠금 금지).
    existing = session.execute(
        select(Baseline)
        .where(Baseline.site_id == site_id)
        .where(Baseline.status == "locked")
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="a locked baseline already exists for this site",
        )

    # 4종 KPI 를 한 번 산출.
    comp: SiteKpiComputation = compute_site_kpi_results(
        session, site_id, period_from, period_to
    )

    # 스냅샷 영속화 → snapshot_id.
    snapshot_id = persist_kpi_snapshot(
        session,
        site_id=site_id,
        org_id=auth.org_id,
        period_start=period_from,
        period_end=period_to,
        comp=comp,
    )

    oei_value = comp.oei.oei if comp.oei is not None else None
    baseline_id = f"bsl-{uuid4().hex}"
    locked_at = datetime.now(UTC)
    bsl = Baseline(
        id=baseline_id,
        site_id=site_id,
        org_id=auth.org_id,
        period_start=period_from,
        period_end=period_to,
        ei_total=comp.ei.ei_total,
        ei_aeration=comp.ei.ei_aeration,
        oei=oei_value,
        fcr=comp.fcr.fcr,
        mortality_rate=comp.mortality.cumulative_rate_pct,
        config_version=comp.config_version,
        kpi_snapshot_id=snapshot_id,
        status="locked",
        locked_by=auth.user_id,
        locked_at=locked_at,
    )
    session.add(bsl)

    # 감사 로그(Rule 9): 잠금은 before=null, after=요약.
    after_summary = {
        "id": baseline_id,
        "status": "locked",
        "period": {"from": period_from.isoformat(), "to": period_to.isoformat()},
        "config_version": comp.config_version,
        "kpi_snapshot_id": snapshot_id,
        "metrics": {
            "ei_total": comp.ei.ei_total,
            "ei_aeration": comp.ei.ei_aeration,
            "oei": oei_value,
            "fcr": comp.fcr.fcr,
            "mortality_rate": comp.mortality.cumulative_rate_pct,
        },
    }
    record_audit(
        session,
        org_id=auth.org_id,
        actor_id=auth.user_id,
        entity="baselines",
        entity_id=baseline_id,
        action="lock",
        diff={"before": None, "after": after_summary},
    )

    try:
        session.commit()
    except IntegrityError:
        # 경합(race)으로 부분 유니크 위반 시 → 409 로 변환(Postgres).
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="a locked baseline already exists for this site",
        ) from None

    return _row_to_response(bsl)


@router.get(
    "/sites/{site_id}/baseline",
    response_model=BaselineResponse,
    response_model_by_alias=True,
    summary="현재 locked baseline 조회(없으면 404). Phase 2 A/B 비교의 입력.",
)
def get_baseline(
    site_id: str,
    auth: AuthContext = Depends(get_auth_context),
    session: Session = Depends(get_db),
) -> BaselineResponse:
    """site 의 현재 locked baseline 을 반환. 없으면 404."""
    resolve_site_for_org(session, site_id, auth.org_id)
    bsl = session.execute(
        select(Baseline)
        .where(Baseline.site_id == site_id)
        .where(Baseline.status == "locked")
    ).scalar_one_or_none()
    if bsl is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="no locked baseline for this site",
        )
    return _row_to_response(bsl)
