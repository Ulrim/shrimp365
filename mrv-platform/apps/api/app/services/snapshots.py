"""snapshots — 4종 KPI 산출 결과를 kpi_snapshots 로 영속화(phase-1 4.1절).

append-only: 생성만 하고 수정하지 않는다. baseline lock·worker 배치가 writer 이며,
GET /kpi 는 live 계산이라 스냅샷을 만들지 않는다(4.1절).
inputs_json/provenance_json 은 각 *Result 의 근거 필드를 그대로 직렬화해 drill-down
재현성(MASTER 3.3/7장)을 확보한다.

★ Rule 1 무관: 산식을 재현하지 않고 이미 산출된 결과(SiteKpiComputation)를 직렬화만 한다.
"""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.kpi_snapshot import KpiSnapshot
from app.services.kpi_service import SiteKpiComputation


def _ei_inputs(comp: SiteKpiComputation) -> dict:
    ei = comp.ei
    return {
        "total_power_kwh": ei.total_power_kwh,
        "aeration_power_kwh": ei.aeration_power_kwh,
        "biomass_start_kg": ei.biomass_start_kg,
        "biomass_end_kg": ei.biomass_end_kg,
        "biomass_delta_kg": ei.biomass_delta_kg,
        "included_reading_count": ei.included_reading_count,
        "excluded_reading_count": ei.excluded_reading_count,
    }


def _fcr_inputs(comp: SiteKpiComputation) -> dict:
    fcr = comp.fcr
    return {
        "total_feed_kg": fcr.total_feed_kg,
        "biomass_start_kg": fcr.biomass_start_kg,
        "biomass_end_kg": fcr.biomass_end_kg,
        "biomass_delta_kg": fcr.biomass_delta_kg,
        "included_feed_count": fcr.included_feed_count,
        "excluded_feed_count": fcr.excluded_feed_count,
    }


def _oei_inputs(comp: SiteKpiComputation) -> dict | None:
    oei = comp.oei
    if oei is None:
        return None
    return {
        "do_in_band_fraction": oei.do_in_band_fraction,
        "do_total_samples": oei.do_total_samples,
        "do_in_band_samples": oei.do_in_band_samples,
        "do_excluded_samples": oei.do_excluded_samples,
        "aeration_power_kwh": oei.aeration_power_kwh,
        "biomass_delta_kg": oei.biomass_delta_kg,
        "band_min": oei.band_min,
        "band_max": oei.band_max,
        "oei_raw": oei.oei_raw,
        "scale_factor": oei.scale_factor,
        "method": oei.method,
    }


def _mortality_inputs(comp: SiteKpiComputation) -> dict:
    mort = comp.mortality
    return {
        "cumulative_rate_pct": mort.cumulative_rate_pct,
        "total_dead_count": mort.total_dead_count,
        "stocked_count": mort.stocked_count,
        "daily": [
            {
                "date": d.date.isoformat(),
                "dead_count": d.dead_count,
                "daily_rate_pct": d.daily_rate_pct,
            }
            for d in mort.daily
        ],
        "moving_avg": [
            {"date": p.date.isoformat(), "ma_rate_pct": p.ma_rate_pct}
            for p in mort.moving_avg
        ],
    }


def persist_kpi_snapshot(
    session: Session,
    *,
    site_id: str,
    org_id: str,
    period_start: datetime,
    period_end: datetime,
    comp: SiteKpiComputation,
) -> str:
    """SiteKpiComputation 을 kpi_snapshots 에 append-only 저장하고 snapshot_id 반환.

    커밋은 호출자(예: baseline lock)가 단일 트랜잭션으로 수행한다.
    """
    snapshot_id = f"snap-{uuid4().hex}"
    ei = comp.ei
    oei = comp.oei
    mort = comp.mortality

    inputs_json = {
        "ei": _ei_inputs(comp),
        "fcr": _fcr_inputs(comp),
        "oei": _oei_inputs(comp),
        "mortality": _mortality_inputs(comp),
    }
    provenance_json = {
        "source_meter_ids": list(ei.source_meter_ids),
        "source_biomass_refs": list(ei.source_biomass_refs),
        "source_feed_refs": list(comp.fcr.source_feed_refs),
        "source_do_meter_ids": list(oei.source_do_meter_ids) if oei else None,
        "source_aeration_meter_ids": (
            list(oei.source_aeration_meter_ids) if oei else None
        ),
        "source_mortality_refs": list(mort.source_refs),
        "stocked_count": mort.stocked_count,
        "tank_id": comp.tank_id,
    }

    snap = KpiSnapshot(
        id=snapshot_id,
        site_id=site_id,
        tank_id=comp.tank_id,
        org_id=org_id,
        period_start=period_start,
        period_end=period_end,
        ei_total=ei.ei_total,
        ei_aeration=ei.ei_aeration,
        oei=oei.oei if oei is not None else None,
        fcr=comp.fcr.fcr,
        mortality_rate=mort.cumulative_rate_pct,
        config_version=comp.config_version,
        inputs_json=inputs_json,
        provenance_json=provenance_json,
    )
    session.add(snap)
    session.flush()
    return snapshot_id
