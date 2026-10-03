"""kpi_service — readings/logs → KPI 엔진 입력 조립 + 4종 compute_* 호출.

★ Rule 1: 산식은 여기서 절대 작성하지 않는다. `culiver_kpi.compute_ei/compute_fcr/
compute_oei/compute_mortality` 를 호출만 한다. 이 서비스의 책임은 순수한 '조립(assembly)':
  1) DB 행(readings/meters/feed_logs/mortality_logs/batches/tanks/harvest/kpi_config)을
     KPI 엔진의 dataclass 로 변환.
  2) 4종 엔진을 호출.
  3) 결과를 2.2절 KpiResponse 로 매핑(status/inputs/provenance 포함).

lock/스냅샷 경로는 스칼라 응답이 아니라 원본 *Result 가 필요하므로 조립·산출을
`compute_site_kpi_results` 로 분리하고, `compute_site_kpi` 는 이를 응답으로 감싼다.

결정론(Rule 6): generated_at 은 응답 메타데이터일 뿐 산출 입력이 아니다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from culiver_kpi import (
    BiomassPoint,
    DoBand,
    DoReading,
    EiResult,
    FcrResult,
    FeedReading,
    KpiThresholds,
    MortalityReading,
    MortalityResult,
    OeiResult,
    PowerReading,
    alerting_config_from_params,
    classify_metric_status,
    compute_ei,
    compute_fcr,
    compute_mortality,
    compute_oei,
    ei_config_from_params,
    fcr_config_from_params,
    mortality_config_from_params,
    oei_config_from_params,
)
from culiver_kpi.config import (
    DEFAULT_CONFIG_VERSION,
    ei_config_to_params,
    fcr_config_to_params,
    mortality_config_to_params,
    oei_config_to_params,
)
from culiver_kpi.status import METRIC_DIRECTIONS
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.batch import Batch
from app.models.feed_log import FeedLog
from app.models.harvest_log import HarvestLog
from app.models.kpi_config import KpiConfig
from app.models.meter import Meter
from app.models.mortality_log import MortalityLog
from app.models.reading import Reading
from app.models.tank import Tank
from app.schemas.kpi import (
    FcrInputs,
    KpiConfigInfo,
    KpiInputs,
    KpiMetric,
    KpiMetrics,
    KpiPeriod,
    KpiProvenance,
    KpiResponse,
    MortalityDailyPoint,
    MortalityInputs,
    MortalityMovingAvgPoint,
    OeiInputs,
)


def _as_utc(dt: datetime) -> datetime:
    """naive datetime(예: SQLite 반환값)을 UTC-aware 로 정규화한다.

    ADR 0001/계약상 ts 는 UTC 저장이다. Postgres(timestamptz)는 aware 로 오지만
    SQLite 는 tzinfo 를 잃어 naive 로 온다. 산식 입력 전 표현 계층에서 통일한다
    (엔진의 aware/naive 비교 오류 방지 — 산식은 건드리지 않는다).
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _load_active_kpi_config(session: Session) -> KpiConfig | None:
    """가장 최근 effective_from 의 kpi_config 를 활성 설정으로 사용."""
    return session.execute(
        select(KpiConfig).order_by(KpiConfig.effective_from.desc())
    ).scalars().first()


def _metric(
    value: float | None, unit: str, metric_key: str, thresholds: KpiThresholds
) -> KpiMetric:
    """status 규칙(phase-2.md 1.4절 통합 지점): `classify_metric_status` 호출만 한다(Rule 1).

    value=None → 'na'(임계 판정 이전). 그 외에는 `metric_key`의 방향(`METRIC_DIRECTIONS`)과
    `thresholds`(kpi_config.alerting.thresholds, culiver_kpi.status 소관)로 4단계 분류한다.
    """
    direction = METRIC_DIRECTIONS[metric_key]
    metric_thresholds = getattr(thresholds, metric_key)
    status = classify_metric_status(value, direction, metric_thresholds)
    return KpiMetric(value=value, unit=unit, status=status)


@dataclass(frozen=True)
class SiteKpiComputation:
    """4종 KPI 원본 산출 결과 묶음(응답/스냅샷 공용).

    lock/스냅샷 경로는 스칼라 응답이 아니라 각 *Result 의 근거 필드가 필요하므로
    조립·산출 결과를 이 형태로 반환한다. oei 는 tank band 미설정 시 None 안전 처리.
    """

    ei: EiResult
    fcr: FcrResult
    oei: OeiResult | None
    mortality: MortalityResult
    config_version: str
    params_out: dict
    tank_id: str | None


def _pick_biomass_bounds(
    harvests: list[HarvestLog],
) -> tuple[BiomassPoint, BiomassPoint]:
    """기간 내 harvest_logs(오름차순)에서 개시/마감 생체량 시점을 고른다.

    - 2행 이상: 가장 이른 시점=개시, 가장 늦은 시점=마감.
    - 1행: 개시=마감 → biomass_delta=0 → 산출 불가(엔진이 None 반환).
    - 0행: 둘 다 0kg 더미(delta=0) → 산출 불가.
    결정론적(입력 순서 고정)이며 산식이 아니라 '데이터 선택' 이다.
    """
    if len(harvests) >= 2:
        first, last = harvests[0], harvests[-1]
        return (
            BiomassPoint(ts=first.ts, biomass_kg=first.biomass_kg, source_ref=first.id),
            BiomassPoint(ts=last.ts, biomass_kg=last.biomass_kg, source_ref=last.id),
        )
    if len(harvests) == 1:
        only = harvests[0]
        point = BiomassPoint(ts=only.ts, biomass_kg=only.biomass_kg, source_ref=only.id)
        return (point, point)
    epoch = datetime(1970, 1, 1, tzinfo=UTC)
    empty = BiomassPoint(ts=epoch, biomass_kg=0.0, source_ref="none")
    return (empty, empty)


def compute_site_kpi_results(
    session: Session,
    site_id: str,
    period_from: datetime,
    period_to: datetime,
) -> SiteKpiComputation:
    """site 의 4종 KPI(EI/FCR/OEI/mortality)를 기간 [from, to) 로 산출.

    호출 전 tenancy.resolve_site_for_org 로 site 소유권이 검증되어 있어야 한다.
    """
    # --- 1) kpi_config 로드 → 지표별 서브키 config(1.4절 nested; 평면 폴백 지원) ---
    cfg_row = _load_active_kpi_config(session)
    if cfg_row is not None:
        config_version = cfg_row.version
        params = cfg_row.params_json or {}
    else:
        config_version = DEFAULT_CONFIG_VERSION
        params = {}

    ei_config = ei_config_from_params(params)
    fcr_config = fcr_config_from_params(params)
    oei_config = oei_config_from_params(params)
    mortality_config = mortality_config_from_params(params)

    if params:
        params_out = dict(params)
    else:
        # cfg 부재 폴백: 엔진 기본값을 nested 문서로 재구성(추적성 유지).
        params_out = {
            "ei": ei_config_to_params(ei_config),
            "fcr": fcr_config_to_params(fcr_config),
            "oei": oei_config_to_params(oei_config),
            "mortality": mortality_config_to_params(mortality_config),
        }

    # --- 2) meters 로드(type 으로 power/do 분기) ---
    meters = session.execute(
        select(Meter).where(Meter.site_id == site_id)
    ).scalars().all()
    meter_type = {m.id: m.type for m in meters}
    aeration_by_meter = {m.id: m.is_aeration for m in meters}
    meter_ids = list(meter_type.keys())

    # --- 3) readings 로드 → PowerReading / DoReading 조립 ---
    power_readings: list[PowerReading] = []
    do_readings: list[DoReading] = []
    if meter_ids:
        rows = session.execute(
            select(Reading)
            .where(Reading.meter_id.in_(meter_ids))
            .where(Reading.time >= period_from)
            .where(Reading.time <= period_to)
            .order_by(Reading.time)
        ).scalars().all()
        for r in rows:
            mtype = meter_type.get(r.meter_id)
            if mtype == "power":
                power_readings.append(
                    PowerReading(
                        meter_id=r.meter_id,
                        ts=_as_utc(r.time),
                        kwh=r.value,
                        is_aeration=bool(aeration_by_meter.get(r.meter_id, False)),
                        quality_flag=r.quality_flag,
                    )
                )
            elif mtype == "do":
                do_readings.append(
                    DoReading(
                        meter_id=r.meter_id,
                        ts=_as_utc(r.time),
                        do_mg_l=r.value,
                        quality_flag=r.quality_flag,
                    )
                )

    # --- 4) harvest_logs → BiomassPoint(개시/마감; EI/FCR/OEI 공용 Δbiomass) ---
    harvests = session.execute(
        select(HarvestLog)
        .where(HarvestLog.site_id == site_id)
        .where(HarvestLog.ts >= period_from)
        .where(HarvestLog.ts <= period_to)
        .order_by(HarvestLog.ts)
    ).scalars().all()
    biomass_start, biomass_end = _pick_biomass_bounds(harvests)

    # --- 5) batches(site 의 tank 소속) → feed/mortality readings + stocked_count ---
    batches = session.execute(
        select(Batch)
        .join(Tank, Batch.tank_id == Tank.id)
        .where(Tank.site_id == site_id)
    ).scalars().all()
    batch_ids = [b.id for b in batches]
    stocked_count = sum(int(b.stocked_count) for b in batches)

    feed_readings: list[FeedReading] = []
    mortality_readings: list[MortalityReading] = []
    if batch_ids:
        feed_rows = session.execute(
            select(FeedLog).where(FeedLog.batch_id.in_(batch_ids)).order_by(FeedLog.ts)
        ).scalars().all()
        for f in feed_rows:
            feed_readings.append(
                FeedReading(
                    source_ref=f.id,
                    batch_id=f.batch_id,
                    ts=_as_utc(f.ts),
                    feed_kg=f.feed_kg,
                    quality_flag=f.quality_flag,
                )
            )
        mort_rows = session.execute(
            select(MortalityLog)
            .where(MortalityLog.batch_id.in_(batch_ids))
            .order_by(MortalityLog.ts)
        ).scalars().all()
        for m in mort_rows:
            mortality_readings.append(
                MortalityReading(
                    source_ref=m.id,
                    batch_id=m.batch_id,
                    ts=_as_utc(m.ts),
                    dead_count=m.dead_count,
                )
            )

    # --- 6) tank band(OEI DoBand). 단일/첫 tank 의 유효 대역 사용(시드 tank 1개) ---
    tanks = session.execute(
        select(Tank).where(Tank.site_id == site_id).order_by(Tank.id)
    ).scalars().all()
    band: DoBand | None = None
    tank_id: str | None = None
    for t in tanks:
        if t.target_do_min is not None and t.target_do_max is not None:
            band = DoBand(do_min=t.target_do_min, do_max=t.target_do_max)
            tank_id = t.id
            break

    # --- 7) 산식 호출(Rule 1: compute_* 만 호출) ---
    ei_result = compute_ei(
        power_readings=power_readings,
        biomass_start=biomass_start,
        biomass_end=biomass_end,
        period_start=period_from,
        period_end=period_to,
        config=ei_config,
        config_version=config_version,
    )
    fcr_result = compute_fcr(
        feed_readings=feed_readings,
        biomass_start=biomass_start,
        biomass_end=biomass_end,
        period_start=period_from,
        period_end=period_to,
        config=fcr_config,
        config_version=config_version,
    )
    mortality_result = compute_mortality(
        mortality_readings=mortality_readings,
        stocked_count=stocked_count,
        period_start=period_from,
        period_end=period_to,
        config=mortality_config,
        config_version=config_version,
    )
    oei_result: OeiResult | None = None
    if band is not None:
        # aeration_readings 는 power_readings 를 그대로 전달(엔진이 is_aeration 필터).
        oei_result = compute_oei(
            do_readings=do_readings,
            aeration_readings=power_readings,
            biomass_start=biomass_start,
            biomass_end=biomass_end,
            band=band,
            period_start=period_from,
            period_end=period_to,
            config=oei_config,
            config_version=config_version,
        )

    return SiteKpiComputation(
        ei=ei_result,
        fcr=fcr_result,
        oei=oei_result,
        mortality=mortality_result,
        config_version=config_version,
        params_out=params_out,
        tank_id=tank_id,
    )


def _mortality_inputs(mort: MortalityResult) -> MortalityInputs:
    """MortalityResult → 응답 근거(일일/이동평균 시계열 포함, drill-down)."""
    return MortalityInputs(
        cumulative_rate_pct=mort.cumulative_rate_pct,
        total_dead_count=mort.total_dead_count,
        stocked_count=mort.stocked_count,
        daily=[
            MortalityDailyPoint(
                date=d.date, dead_count=d.dead_count, daily_rate_pct=d.daily_rate_pct
            )
            for d in mort.daily
        ],
        moving_avg=[
            MortalityMovingAvgPoint(date=p.date, ma_rate_pct=p.ma_rate_pct)
            for p in mort.moving_avg
        ],
    )


def compute_site_kpi(
    session: Session,
    site_id: str,
    org_id: str,
    period_from: datetime,
    period_to: datetime,
) -> KpiResponse:
    """site 의 4종 KPI 를 기간 [from, to) 로 산출해 2.2절 KpiResponse 로 반환.

    호출 전 tenancy.resolve_site_for_org 로 site 소유권이 검증되어 있어야 한다.
    live read-only 계산이므로 provenance.kpi_snapshot_id 는 None(영속화는 lock/worker).
    """
    comp = compute_site_kpi_results(session, site_id, period_from, period_to)
    ei = comp.ei
    fcr = comp.fcr
    oei = comp.oei
    mort = comp.mortality

    # comp.params_out 은 항상 지표별 서브키 nested 문서(ei/fcr/oei/mortality 키 보유) —
    # 'alerting' 서브키가 없으면 alerting_config_from_params 가 기본 임계값으로 폴백한다.
    thresholds = alerting_config_from_params(comp.params_out).thresholds

    metrics = KpiMetrics(
        ei_total=_metric(ei.ei_total, "kWh/kg", "ei_total", thresholds),
        ei_aeration=_metric(ei.ei_aeration, "kWh/kg", "ei_aeration", thresholds),
        oei=_metric(oei.oei if oei is not None else None, "index", "oei", thresholds),
        fcr=_metric(fcr.fcr, "kg/kg", "fcr", thresholds),
        mortality_rate=_metric(mort.cumulative_rate_pct, "%", "mortality_rate", thresholds),
    )

    inputs = KpiInputs(
        total_power_kwh=ei.total_power_kwh,
        aeration_power_kwh=ei.aeration_power_kwh,
        biomass_start_kg=ei.biomass_start_kg,
        biomass_end_kg=ei.biomass_end_kg,
        biomass_delta_kg=ei.biomass_delta_kg,
        included_reading_count=ei.included_reading_count,
        excluded_reading_count=ei.excluded_reading_count,
        fcr=FcrInputs(
            total_feed_kg=fcr.total_feed_kg,
            biomass_start_kg=fcr.biomass_start_kg,
            biomass_end_kg=fcr.biomass_end_kg,
            biomass_delta_kg=fcr.biomass_delta_kg,
            included_feed_count=fcr.included_feed_count,
            excluded_feed_count=fcr.excluded_feed_count,
        ),
        oei=(
            OeiInputs(
                do_in_band_fraction=oei.do_in_band_fraction,
                do_total_samples=oei.do_total_samples,
                do_in_band_samples=oei.do_in_band_samples,
                do_excluded_samples=oei.do_excluded_samples,
                aeration_power_kwh=oei.aeration_power_kwh,
                biomass_delta_kg=oei.biomass_delta_kg,
                band_min=oei.band_min,
                band_max=oei.band_max,
                oei_raw=oei.oei_raw,
                scale_factor=oei.scale_factor,
                method=oei.method,
            )
            if oei is not None
            else None
        ),
        mortality=_mortality_inputs(mort),
    )

    provenance = KpiProvenance(
        source_meter_ids=list(ei.source_meter_ids),
        source_biomass_refs=list(ei.source_biomass_refs),
        kpi_snapshot_id=None,
        source_feed_refs=list(fcr.source_feed_refs),
        source_do_meter_ids=list(oei.source_do_meter_ids) if oei is not None else None,
        source_aeration_meter_ids=(
            list(oei.source_aeration_meter_ids) if oei is not None else None
        ),
        source_mortality_refs=list(mort.source_refs),
        stocked_count=mort.stocked_count,
    )

    return KpiResponse(
        site_id=site_id,
        org_id=org_id,
        period=KpiPeriod(**{"from": period_from, "to": period_to, "granularity": "period"}),
        kpi_config=KpiConfigInfo(version=comp.config_version, params=comp.params_out),
        metrics=metrics,
        inputs=inputs,
        provenance=provenance,
        generated_at=datetime.now(UTC),
    )
