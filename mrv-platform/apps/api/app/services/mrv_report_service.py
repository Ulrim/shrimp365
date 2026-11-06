"""MRV 리포트 생성 서비스 — phase-3.md 1.5절 처리(3~10단계, ★Phase 3 헤드라인).

★ Rule 1: Scope2 산식은 `culiver_kpi.compute_scope2_reduction` 을 호출만 한다(mrv.py 가
단일 진실 공급원). 이 모듈의 책임은 순수 조립(assembly):
  3) locked baseline 조회
  4) emission_factor 로드(지정/활성)
  5~6) after 기간 4종 KPI 산출 + kpi_snapshots 영속화
  7) Scope2Input 조립 → compute_scope2_reduction 호출
  8) before_json/after_json/boundary_json 조립(1.4/1.6절)
  9) PDF 렌더링(1.8절, ADR 0004)
  10) mrv_reports 삽입 + audit_logs(Rule 9)

1단계(3중 테넌시+플랜 게이트)/2단계(기간 422)/11단계(커밋)는 라우터가 담당한다(커밋은
호출자가 수행 — snapshots.py/audit.py 와 동일한 관례).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from culiver_kpi import Scope2Input, Scope2Result, compute_scope2_reduction
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.baseline import Baseline
from app.models.emission_factor import EmissionFactor
from app.models.kpi_snapshot import KpiSnapshot
from app.models.mrv_report import MrvReport
from app.models.site import Site
from app.services import pdf_render
from app.services.audit import record_audit
from app.services.kpi_service import SiteKpiComputation, compute_site_kpi_results
from app.services.snapshots import persist_kpi_snapshot

# 1.6절: assumptions 는 고정 문자열 템플릿(코드 상수) — 사용자가 편집하지 않는다(재현성).
_ASSUMPTIONS_TEMPLATE: tuple[str, ...] = (
    "전력사용량은 site 전체 전력계(main+blower 서브미터) 합산 기준이다.",
    "생산량은 harvest_logs 개시/마감 시점 biomass_kg 차이로 정의한다(Δbiomass).",
    "감축량은 After 기간 실제 생산량을 기준으로 정규화했다(생산량 증가 효과 배제).",
)


def _load_locked_baseline(session: Session, site_id: str) -> Baseline:
    """locked baseline 조회. 없으면 404(comparison.py 와 동일 문구 재사용, 1.5절 3단계)."""
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
    return bsl


def _load_emission_factor(
    session: Session, emission_factor_id: str | None
) -> EmissionFactor:
    """지정 시 존재 확인(404), 미지정 시 활성(effective_from 내림차순 최신) 배출계수 로드
    (없으면 404, 1.5절 4단계 — Rule 5: 값 부재를 묵시적 0으로 처리하지 않는다)."""
    if emission_factor_id is not None:
        ef = session.get(EmissionFactor, emission_factor_id)
        if ef is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="emission factor not found",
            )
        return ef
    ef = session.execute(
        select(EmissionFactor).order_by(EmissionFactor.effective_from.desc())
    ).scalars().first()
    if ef is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="no emission factor configured",
        )
    return ef


def _baseline_ei_inputs(session: Session, bsl: Baseline) -> dict:
    """baseline.kpi_snapshot_id 에서 EI 근거(total_power_kwh 등)를 그대로 복사(재계산 금지,
    ADR 0002 와 동일 정신 — before_json 은 baseline 스냅샷에서 복사만 한다, 1.4절)."""
    empty = {
        "total_power_kwh": None,
        "aeration_power_kwh": None,
        "biomass_delta_kg": None,
        "source_meter_ids": [],
        "source_biomass_refs": [],
    }
    if bsl.kpi_snapshot_id is None:
        return empty
    snap = session.get(KpiSnapshot, bsl.kpi_snapshot_id)
    if snap is None:
        return empty
    ei_inputs = (snap.inputs_json or {}).get("ei", {}) or {}
    provenance = snap.provenance_json or {}
    return {
        "total_power_kwh": ei_inputs.get("total_power_kwh"),
        "aeration_power_kwh": ei_inputs.get("aeration_power_kwh"),
        "biomass_delta_kg": ei_inputs.get("biomass_delta_kg"),
        "source_meter_ids": list(provenance.get("source_meter_ids") or []),
        "source_biomass_refs": list(provenance.get("source_biomass_refs") or []),
    }


@dataclass(frozen=True)
class GeneratedMrvReport:
    """생성 결과 묶음. 라우터가 커밋 후 응답을 조립하는 데 필요한 부가정보 포함."""

    report: MrvReport
    emission_factor: EmissionFactor
    pdf_rendered: bool


def generate_mrv_report(
    session: Session,
    *,
    site: Site,
    org_id: str,
    user_id: str,
    after_period_from: datetime,
    after_period_to: datetime,
    emission_factor_id: str | None,
) -> GeneratedMrvReport:
    """1.5절 3~10단계. 호출 전 3중 테넌시 방어(resolve_site_for_org)로 site 소유권이
    검증되어 있어야 한다. flush 까지만 수행하고 커밋은 라우터가 담당(11단계)."""

    # 3) locked baseline.
    bsl = _load_locked_baseline(session, site.id)

    # 4) emission_factor.
    ef = _load_emission_factor(session, emission_factor_id)

    # 5~6) after 기간 4종 산출 + 스냅샷 영속화(EI 외 3종도 함께 — drill-down 대비).
    comp: SiteKpiComputation = compute_site_kpi_results(
        session, site.id, after_period_from, after_period_to
    )
    after_snapshot_id = persist_kpi_snapshot(
        session,
        site_id=site.id,
        org_id=org_id,
        period_start=after_period_from,
        period_end=after_period_to,
        comp=comp,
    )

    before_inputs = _baseline_ei_inputs(session, bsl)
    baseline_power_mwh = (
        before_inputs["total_power_kwh"] / 1000.0
        if before_inputs["total_power_kwh"] is not None
        else None
    )
    after_power_mwh = comp.ei.total_power_kwh / 1000.0

    # 7) Scope2Input 조립 → compute_scope2_reduction 호출만(Rule 1).
    scope2_inputs = Scope2Input(
        baseline_ei_total=bsl.ei_total,
        after_ei_total=comp.ei.ei_total,
        after_biomass_delta_kg=comp.ei.biomass_delta_kg,
        baseline_power_mwh=baseline_power_mwh,
        after_power_mwh=after_power_mwh,
        emission_factor_tco2e_per_mwh=ef.factor_tco2e_per_mwh,
        emission_factor_source=ef.source,
        emission_factor_year=ef.year,
        emission_factor_version=ef.version,
    )
    try:
        scope2: Scope2Result = compute_scope2_reduction(scope2_inputs)
    except ValueError as exc:
        # after_biomass_delta_kg<=0 등 값 방어(엔진 규약) → 422(입력값 문제로 흡수).
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from None

    # 8) before_json/after_json 조립(1.4절 구조 그대로).
    before_json = {
        "period": {
            "from": bsl.period_start.isoformat(),
            "to": bsl.period_end.isoformat(),
        },
        "config_version": bsl.config_version,
        "ei_total": bsl.ei_total,
        "ei_aeration": bsl.ei_aeration,
        "total_power_kwh": before_inputs["total_power_kwh"] or 0.0,
        "aeration_power_kwh": before_inputs["aeration_power_kwh"] or 0.0,
        "biomass_delta_kg": before_inputs["biomass_delta_kg"] or 0.0,
        "scope2_tco2e": scope2.scope2_tco2e_baseline,
        "kpi_snapshot_id": bsl.kpi_snapshot_id,
    }
    after_json = {
        "period": {
            "from": after_period_from.isoformat(),
            "to": after_period_to.isoformat(),
        },
        "config_version": comp.config_version,
        "ei_total": comp.ei.ei_total,
        "ei_aeration": comp.ei.ei_aeration,
        "total_power_kwh": comp.ei.total_power_kwh,
        "aeration_power_kwh": comp.ei.aeration_power_kwh,
        "biomass_delta_kg": comp.ei.biomass_delta_kg,
        "scope2_tco2e": scope2.scope2_tco2e_after,
        "kpi_snapshot_id": after_snapshot_id,
    }

    # boundary_json(1.6절 — 자동 생성, 자유 입력 아님).
    included_meter_ids = sorted(
        set(before_inputs["source_meter_ids"]) | set(comp.ei.source_meter_ids)
    )
    ei_config_params = (comp.params_out or {}).get("ei", {}) or {}
    included_quality_flags = list(ei_config_params.get("included_quality_flags", ["ok"]))
    boundary_json = {
        "site_id": site.id,
        "site_name": site.name,
        "included_meter_ids": included_meter_ids,
        "included_quality_flags": included_quality_flags,
        "biomass_source_refs": {
            "before": before_inputs["source_biomass_refs"],
            "after": list(comp.ei.source_biomass_refs),
        },
        "config_version": {"before": bsl.config_version, "after": comp.config_version},
        "assumptions": list(_ASSUMPTIONS_TEMPLATE),
    }

    report_id = f"mrv-{uuid4().hex}"
    generated_at = datetime.now(UTC)

    # 9) PDF 렌더링(1.8절, ADR 0004). 실패해도 리포트 생성 자체는 계속(HTML 폴백).
    ei_chart_svg = pdf_render.render_comparison_bar_svg(
        label_before="Before",
        value_before=bsl.ei_total,
        label_after="After",
        value_after=comp.ei.ei_total,
        unit="kWh/kg",
    )
    html_context = {
        "report": {
            "id": report_id,
            "site_id": site.id,
            "org_id": org_id,
            "baseline_id": bsl.id,
            "period": {
                "from": after_period_from.isoformat(),
                "to": after_period_to.isoformat(),
            },
            "reduction_tco2e": scope2.reduction_tco2e,
            "formula_text": scope2.formula_text,
            "generated_by": user_id,
            "generated_at": generated_at.isoformat(),
        },
        "before": before_json,
        "after": after_json,
        "emission_factor": {"version": ef.version, "source": ef.source, "year": ef.year},
        "boundary": boundary_json,
        "ei_chart_svg": ei_chart_svg,
    }
    html = pdf_render.render_mrv_report_html(html_context)
    settings = get_settings()
    pdf_path, pdf_rendered = pdf_render.render_pdf(
        report_id, html, settings.mrv_reports_dir
    )

    # 10) mrv_reports 삽입 + audit_logs(Rule 9).
    mrv = MrvReport(
        id=report_id,
        site_id=site.id,
        org_id=org_id,
        baseline_id=bsl.id,
        period_start=after_period_from,
        period_end=after_period_to,
        emission_factor_id=ef.id,
        after_kpi_snapshot_id=after_snapshot_id,
        before_json=before_json,
        after_json=after_json,
        reduction_tco2e=scope2.reduction_tco2e,
        formula_text=scope2.formula_text,
        boundary_json=boundary_json,
        pdf_path=pdf_path,
        generated_by=user_id,
        generated_at=generated_at,
    )
    session.add(mrv)
    session.flush()

    record_audit(
        session,
        org_id=org_id,
        actor_id=user_id,
        entity="mrv_reports",
        entity_id=report_id,
        action="generate",
        diff={
            "before": None,
            "after": {
                "id": report_id,
                "site_id": site.id,
                "baseline_id": bsl.id,
                "period": {
                    "from": after_period_from.isoformat(),
                    "to": after_period_to.isoformat(),
                },
                "emission_factor_id": ef.id,
                "reduction_tco2e": scope2.reduction_tco2e,
                "pdf_rendered": pdf_rendered,
            },
        },
    )

    return GeneratedMrvReport(report=mrv, emission_factor=ef, pdf_rendered=pdf_rendered)


def pdf_is_available(mrv: MrvReport) -> bool:
    """pdf_path 가 실제 PDF 렌더링 성공 결과(.pdf 확장자)인지 여부(HTML 폴백과 구분)."""
    return mrv.pdf_path is not None and mrv.pdf_path.endswith(".pdf")
