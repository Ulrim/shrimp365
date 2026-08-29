"""사이트 목록/멀티사이트 벤치마크 API — phase-3.md 4절.

`GET /sites`: `auth.org_id` 소속 site 요약 목록. 플랜 게이팅 없음(단일 site 조직도 자기
site 목록을 볼 권리는 있다 — START/PRO 에서도 유용, 온보딩 7.2절에서도 필요).

`GET /sites/kpi-benchmark`: org 의 모든 site 에 기존 `compute_site_kpi_results` 를 반복
호출(신규 엔진 없음, Rule 1 위반 아님 — 조립 반복일 뿐, 4.2절). ENTERPRISE 전용.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_auth_context, get_db, require_plan
from app.models.site import Site
from app.schemas.kpi import KpiPeriod
from app.schemas.site import (
    SiteBenchmarkEntry,
    SiteBenchmarkMetrics,
    SiteKpiBenchmarkResponse,
    SiteListResponse,
    SiteSummaryResponse,
)
from app.services.kpi_service import compute_site_kpi_results

router = APIRouter(tags=["sites"])

_ENTERPRISE = ("ENTERPRISE",)


@router.get(
    "/sites",
    response_model=SiteListResponse,
    summary="org 소속 site 목록(플랜 게이팅 없음, 4.2절).",
)
def list_sites(
    auth: AuthContext = Depends(get_auth_context),
    session: Session = Depends(get_db),
) -> SiteListResponse:
    rows = session.execute(
        select(Site).where(Site.org_id == auth.org_id).order_by(Site.id)
    ).scalars().all()
    return SiteListResponse(
        items=[SiteSummaryResponse.model_validate(r) for r in rows], total=len(rows)
    )


@router.get(
    "/sites/kpi-benchmark",
    response_model=SiteKpiBenchmarkResponse,
    response_model_by_alias=True,
    summary="org 의 모든 site KPI 벤치마크(ENTERPRISE, 신규 산식 없음, 4.2절).",
)
def get_sites_kpi_benchmark(
    from_: datetime = Query(..., alias="from", description="기간 시작(ISO8601, 포함)"),
    to: datetime = Query(..., description="기간 끝(ISO8601, 반열림 상한)"),
    auth: AuthContext = Depends(require_plan(*_ENTERPRISE)),
    session: Session = Depends(get_db),
) -> SiteKpiBenchmarkResponse:
    if from_ >= to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="'from' must be strictly before 'to'",
        )

    rows = session.execute(
        select(Site).where(Site.org_id == auth.org_id).order_by(Site.id)
    ).scalars().all()

    entries: list[SiteBenchmarkEntry] = []
    for site in rows:
        # Rule 1 준수: compute_site_kpi_results(kpi_service, data-kpi-engineer 엔진 호출만)를
        # site 마다 반복 호출한다 — 신규 산식/엔진이 아니라 조립 반복(4.2절).
        comp = compute_site_kpi_results(session, site.id, from_, to)
        entries.append(
            SiteBenchmarkEntry(
                site_id=site.id,
                site_name=site.name,
                config_version=comp.config_version,
                metrics=SiteBenchmarkMetrics(
                    ei_total=comp.ei.ei_total,
                    ei_aeration=comp.ei.ei_aeration,
                    oei=comp.oei.oei if comp.oei is not None else None,
                    fcr=comp.fcr.fcr,
                    mortality_rate=comp.mortality.cumulative_rate_pct,
                ),
            )
        )

    return SiteKpiBenchmarkResponse(
        period=KpiPeriod(**{"from": from_, "to": to, "granularity": "period"}),
        sites=entries,
    )
