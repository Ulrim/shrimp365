"""전·후(A/B) 비교 API — phase-2 슬라이스 J(docs/design/phase-2.md 3.2절).

GET /sites/{site_id}/comparison?compare_from&compare_to

★ Rule 1: `compare_metric`(culiver_kpi.comparison, 3.1절 — 산식 아닌 단순 산술 표시
유틸)과 `compute_site_kpi_results`(기존 4종 엔진 조립, kpi_service)를 호출만 한다.
baseline 은 잠긴 값을 그대로 조회한다(재계산 안 함 — ADR 0002 불변성).

PRO 이상만 접근(`require_plan`) + viewer 는 403(phase-2.md 3.2절 에러표 "403(viewer 또는
START 플랜)"). viewer 차단은 `require_writer`(owner/operator만 허용)를 재사용하지 않는다 —
그 헬퍼는 잠금/수기입력 같은 **쓰기** 게이트라 "admin" 등 임의 비-viewer 읽기 역할까지
과도하게 막는다. 여기서는 계약이 명시한 "viewer만" 차단하는 얕은 역할 체크를 별도로 둔다.
baseline 없으면 404(비교 불가 상태 명시).
"""

from __future__ import annotations

from datetime import datetime

from culiver_kpi.comparison import METRIC_DIRECTION, compare_metric
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_db, require_plan
from app.models.baseline import Baseline
from app.schemas.comparison import (
    ComparisonPeriodMetrics,
    ComparisonProvenance,
    ComparisonResponse,
    ComparisonRow,
)
from app.schemas.kpi import KpiPeriod
from app.services.kpi_service import compute_site_kpi_results
from app.services.tenancy import resolve_site_for_org

router = APIRouter(tags=["comparison"])

_PRO_PLUS = ("PRO", "ENTERPRISE")


def _baseline_metrics(bsl: Baseline) -> dict[str, float | None]:
    return {
        "ei_total": bsl.ei_total,
        "ei_aeration": bsl.ei_aeration,
        "oei": bsl.oei,
        "fcr": bsl.fcr,
        "mortality_rate": bsl.mortality_rate,
    }


@router.get(
    "/sites/{site_id}/comparison",
    response_model=ComparisonResponse,
    response_model_by_alias=True,
    summary="잠긴 baseline vs 현재 기간 KPI 비교(PRO 이상, phase-2.md 3.2절).",
)
def get_site_comparison(
    site_id: str,
    compare_from: datetime = Query(..., description="현재 기간 시작(ISO8601, 포함)"),
    compare_to: datetime = Query(..., description="현재 기간 끝(ISO8601, 반열림 상한)"),
    auth: AuthContext = Depends(require_plan(*_PRO_PLUS)),
    session: Session = Depends(get_db),
) -> ComparisonResponse:
    if auth.role == "viewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="viewer role cannot access comparison (phase-2.md 3.2절)",
        )
    if compare_from >= compare_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="'compare_from' must be strictly before 'compare_to'",
        )

    resolve_site_for_org(session, site_id, auth.org_id)

    bsl = session.execute(
        select(Baseline)
        .where(Baseline.site_id == site_id)
        .where(Baseline.status == "locked")
    ).scalar_one_or_none()
    if bsl is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="baseline not locked",
        )

    comp = compute_site_kpi_results(session, site_id, compare_from, compare_to)
    current_metrics: dict[str, float | None] = {
        "ei_total": comp.ei.ei_total,
        "ei_aeration": comp.ei.ei_aeration,
        "oei": comp.oei.oei if comp.oei is not None else None,
        "fcr": comp.fcr.fcr,
        "mortality_rate": comp.mortality.cumulative_rate_pct,
    }
    baseline_metrics = _baseline_metrics(bsl)

    comparison_rows: dict[str, ComparisonRow] = {}
    for metric_name, direction in METRIC_DIRECTION.items():
        result = compare_metric(
            baseline_metrics[metric_name], current_metrics[metric_name], direction
        )
        comparison_rows[metric_name] = ComparisonRow(
            delta=result.delta,
            improvement_pct=result.improvement_pct,
            direction=result.direction,
        )

    return ComparisonResponse(
        site_id=site_id,
        baseline=ComparisonPeriodMetrics(
            period=KpiPeriod(
                **{"from": bsl.period_start, "to": bsl.period_end, "granularity": "period"}
            ),
            config_version=bsl.config_version,
            metrics=baseline_metrics,
        ),
        current=ComparisonPeriodMetrics(
            period=KpiPeriod(
                **{"from": compare_from, "to": compare_to, "granularity": "period"}
            ),
            config_version=comp.config_version,
            metrics=current_metrics,
        ),
        comparison=comparison_rows,
        provenance=ComparisonProvenance(
            baseline_id=bsl.id,
            current_kpi_snapshot_id=None,
        ),
    )
