"""MRV 리포트 API — phase-3.md 1.5절(★Phase 3 헤드라인).

POST /sites/{site_id}/mrv-reports/generate : require_writer + require_plan(PRO+).
GET  /mrv-reports/{id}                     : 재조회(POST 응답과 동일 shape).
GET  /mrv-reports/{id}/pdf                 : PDF 파일 스트림(Content-Type: application/pdf).
GET  /sites/{site_id}/mrv-reports          : 이력 목록(PRO+).

3중 테넌시 방어 전부 적용. mrv_reports 생성 로직(3~10단계)은
`app.services.mrv_report_service.generate_mrv_report` 에 위임하고, 이 라우터는 1/2/11단계
(플랜/역할 게이트, 기간 검증, 커밋)와 응답 조립만 담당한다.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.deps import AuthContext, get_auth_context, get_db, require_plan, require_writer
from app.models.emission_factor import EmissionFactor
from app.models.mrv_report import MrvReport
from app.schemas.kpi import KpiPeriod
from app.schemas.mrv_report import (
    EmissionFactorRefResponse,
    MrvBoundary,
    MrvPeriodSummary,
    MrvReportGenerateRequest,
    MrvReportListResponse,
    MrvReportResponse,
)
from app.services.mrv_report_service import (
    GeneratedMrvReport,
    generate_mrv_report,
    pdf_is_available,
)
from app.services.tenancy import resolve_site_for_org

router = APIRouter(tags=["mrv-reports"])

_PRO_PLUS = ("PRO", "ENTERPRISE")


def _period_summary(period_dict: dict, summary: dict) -> MrvPeriodSummary:
    return MrvPeriodSummary(
        period=KpiPeriod(
            **{
                "from": period_dict["from"],
                "to": period_dict["to"],
                "granularity": "period",
            }
        ),
        config_version=summary["config_version"],
        ei_total=summary["ei_total"],
        ei_aeration=summary["ei_aeration"],
        total_power_kwh=summary["total_power_kwh"],
        aeration_power_kwh=summary["aeration_power_kwh"],
        biomass_delta_kg=summary["biomass_delta_kg"],
        scope2_tco2e=summary["scope2_tco2e"],
        kpi_snapshot_id=summary.get("kpi_snapshot_id"),
    )


def _row_to_response(session: Session, mrv: MrvReport) -> MrvReportResponse:
    """저장된 mrv_reports 행 → 응답(재조회/생성 응답 공용 shape, 1.5절)."""
    ef = session.get(EmissionFactor, mrv.emission_factor_id)
    if ef is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="referenced emission factor missing",
        )
    before = mrv.before_json
    after = mrv.after_json
    boundary = mrv.boundary_json

    return MrvReportResponse(
        id=mrv.id,
        site_id=mrv.site_id,
        org_id=mrv.org_id,
        baseline_id=mrv.baseline_id,
        period=KpiPeriod(
            **{
                "from": mrv.period_start,
                "to": mrv.period_end,
                "granularity": "period",
            }
        ),
        before=_period_summary(before["period"], before),
        after=_period_summary(after["period"], after),
        reduction_tco2e=mrv.reduction_tco2e,
        formula_text=mrv.formula_text,
        emission_factor=EmissionFactorRefResponse(
            version=ef.version, source=ef.source, year=ef.year
        ),
        boundary=MrvBoundary(
            site_id=boundary["site_id"],
            site_name=boundary["site_name"],
            included_meter_ids=boundary["included_meter_ids"],
            included_quality_flags=boundary["included_quality_flags"],
            biomass_source_refs=boundary["biomass_source_refs"],
            config_version=boundary["config_version"],
            assumptions=boundary["assumptions"],
        ),
        pdf_available=pdf_is_available(mrv),
        generated_by=mrv.generated_by,
        generated_at=mrv.generated_at,
    )


@router.post(
    "/sites/{site_id}/mrv-reports/generate",
    response_model=MrvReportResponse,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
    summary="MRV 리포트 생성(★Phase 3 헤드라인, PRO+, 1.5절 1~11단계).",
)
def generate_mrv_report_endpoint(
    site_id: str,
    payload: MrvReportGenerateRequest,
    auth: AuthContext = Depends(require_writer),
    _plan_auth: AuthContext = Depends(require_plan(*_PRO_PLUS)),
    session: Session = Depends(get_db),
) -> MrvReportResponse:
    # 1단계(3중 테넌시+플랜+역할 게이트)는 require_writer/require_plan Depends 로 이미 적용됨
    # (recommendations.py 의 동일 조합 패턴 재사용).

    # 2단계: 기간 검증(422).
    period_from = payload.after_period.from_
    period_to = payload.after_period.to
    if period_from >= period_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="'from' must be strictly before 'to'",
        )

    # 3중 방어(3번째): site 소유권 재검증(403/404).
    site = resolve_site_for_org(session, site_id, auth.org_id)

    # 3~10단계: 서비스 위임(Rule 1 — compute_scope2_reduction 호출은 서비스 내부).
    result: GeneratedMrvReport = generate_mrv_report(
        session,
        site=site,
        org_id=auth.org_id,
        user_id=auth.user_id,
        after_period_from=period_from,
        after_period_to=period_to,
        emission_factor_id=payload.emission_factor_id,
    )

    # 11단계: 커밋.
    session.commit()

    return _row_to_response(session, result.report)


@router.get(
    "/mrv-reports/{report_id}",
    response_model=MrvReportResponse,
    response_model_by_alias=True,
    summary="MRV 리포트 재조회(POST 응답과 동일 shape, 1.5절).",
)
def get_mrv_report(
    report_id: str,
    auth: AuthContext = Depends(get_auth_context),
    session: Session = Depends(get_db),
) -> MrvReportResponse:
    mrv = session.get(MrvReport, report_id)
    if mrv is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"mrv report not found: {report_id}",
        )
    # 3중 방어(3번째): site_id 로 org 재검증(RLS-on 이면 애초에 조회 안 됨 → 404).
    resolve_site_for_org(session, mrv.site_id, auth.org_id)
    return _row_to_response(session, mrv)


@router.get(
    "/mrv-reports/{report_id}/pdf",
    summary="MRV 리포트 PDF 다운로드(Content-Type: application/pdf, 1.8절).",
)
def get_mrv_report_pdf(
    report_id: str,
    auth: AuthContext = Depends(get_auth_context),
    session: Session = Depends(get_db),
) -> FileResponse:
    mrv = session.get(MrvReport, report_id)
    if mrv is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"mrv report not found: {report_id}",
        )
    resolve_site_for_org(session, mrv.site_id, auth.org_id)

    if not pdf_is_available(mrv):
        # WeasyPrint 미구성 환경에서 HTML 폴백만 저장된 경우(1.8절 사용자 지시).
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PDF 렌더링 환경 미구성(서버에 WeasyPrint 네이티브 의존성이 설치되지 "
            "않았습니다). 리포트 데이터는 GET /mrv-reports/{id} 로 조회 가능합니다.",
        )
    return FileResponse(
        path=mrv.pdf_path,
        media_type="application/pdf",
        filename=f"{mrv.id}.pdf",
    )


@router.get(
    "/sites/{site_id}/mrv-reports",
    response_model=MrvReportListResponse,
    response_model_by_alias=True,
    summary="MRV 리포트 이력 목록(화면10, PRO+).",
)
def list_mrv_reports(
    site_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_plan(*_PRO_PLUS)),
    session: Session = Depends(get_db),
) -> MrvReportListResponse:
    resolve_site_for_org(session, site_id, auth.org_id)

    total = session.execute(
        select(func.count(MrvReport.id)).where(MrvReport.site_id == site_id)
    ).scalar_one()
    rows = session.execute(
        select(MrvReport)
        .where(MrvReport.site_id == site_id)
        .order_by(MrvReport.generated_at.desc())
        .limit(limit)
        .offset(offset)
    ).scalars().all()

    return MrvReportListResponse(
        items=[_row_to_response(session, r) for r in rows], total=total
    )
