/**
 * MRV 리포트 생성 — 원본 `apps/api/app/services/mrv_report_service.py` 의 이식본.
 *
 * ★ Scope2 산식은 `computeScope2Reduction` 을 호출만 한다. 이 모듈의 책임은 조립:
 *   1) 잠긴 기준선 조회
 *   2) 배출계수 로드(지정 또는 활성 최신)
 *   3) after 기간 4종 KPI 산출 + 스냅샷 영속화
 *   4) Scope2Input 조립 → 엔진 호출
 *   5) before_json/after_json/boundary_json 조립
 *   6) mrv_reports 삽입 + 감사 로그
 *
 * before_json 은 **재계산하지 않는다** — 기준선 스냅샷에서 값을 복사할 뿐이다.
 * 기준선을 다시 계산하면 그 사이 데이터가 보정됐을 때 'Before' 가 조용히 달라져
 * 리포트가 증빙 구실을 못 한다.
 */

import { computeScope2Reduction } from "./kpi"
import type { Scope2Input } from "./kpi"
import { HttpError } from "./http"
import { T, newId, type MrvDb } from "./db"
import { computeSiteKpiResults } from "./kpi-service"
import { persistKpiSnapshot } from "./snapshots"
import { recordAudit } from "./audit"
import type { BaselineRow } from "./baseline"
import type { SiteRow } from "./tenancy"

/** 리포트에 항상 명시되는 가정. 심사자가 경계를 판단할 수 있어야 하므로 생략하지 않는다. */
const ASSUMPTIONS = [
  "전력사용량은 site 전체 전력계(main+blower 서브미터) 합산 기준이다.",
  "생산량은 harvest_logs 개시/마감 시점 biomass_kg 차이로 정의한다(Δbiomass).",
  "감축량은 After 기간 실제 생산량을 기준으로 정규화했다(생산량 증가 효과 배제).",
] as const

export type EmissionFactorRow = {
  id: string
  factor_tco2e_per_mwh: number
  source: string
  year: number
  version: string
  effective_from: string
}

export type MrvReportRow = {
  id: string
  site_id: string
  org_id: string
  baseline_id: string
  period_start: string
  period_end: string
  emission_factor_id: string
  after_kpi_snapshot_id: string
  before_json: Record<string, unknown>
  after_json: Record<string, unknown>
  reduction_tco2e: number | null
  formula_text: string
  boundary_json: Record<string, unknown>
  pdf_path: string | null
  generated_by: string
  generated_at: string
}

async function loadLockedBaseline(db: MrvDb, siteId: string): Promise<BaselineRow> {
  const { data, error } = await db
    .from(T.baselines)
    .select("*")
    .eq("site_id", siteId)
    .eq("status", "locked")
    .maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(404, "baseline not locked")
  return data as BaselineRow
}

/**
 * 배출계수 로드. 지정하면 그것을, 아니면 활성(effective_from 최신) 값을 쓴다.
 * 어느 쪽도 없으면 404 다 — 배출계수 부재를 0 으로 처리하면 "감축량 0" 이라는
 * 그럴듯한 거짓 결과가 나온다.
 */
async function loadEmissionFactor(
  db: MrvDb,
  emissionFactorId: string | null,
): Promise<EmissionFactorRow> {
  if (emissionFactorId) {
    const { data, error } = await db
      .from(T.emissionFactors)
      .select("*")
      .eq("id", emissionFactorId)
      .maybeSingle()
    if (error) throw error
    if (!data) throw new HttpError(404, "emission factor not found")
    return data as EmissionFactorRow
  }
  const { data, error } = await db
    .from(T.emissionFactors)
    .select("*")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(404, "no emission factor configured")
  return data as EmissionFactorRow
}

type BeforeInputs = {
  total_power_kwh: number | null
  aeration_power_kwh: number | null
  biomass_delta_kg: number | null
  source_meter_ids: string[]
  source_biomass_refs: string[]
}

/** 기준선이 가리키는 스냅샷에서 EI 근거를 그대로 복사한다(재계산 금지). */
async function baselineEiInputs(db: MrvDb, bsl: BaselineRow): Promise<BeforeInputs> {
  const empty: BeforeInputs = {
    total_power_kwh: null,
    aeration_power_kwh: null,
    biomass_delta_kg: null,
    source_meter_ids: [],
    source_biomass_refs: [],
  }
  if (!bsl.kpi_snapshot_id) return empty

  const { data, error } = await db
    .from(T.kpiSnapshots)
    .select("inputs_json, provenance_json")
    .eq("id", bsl.kpi_snapshot_id)
    .maybeSingle()
  if (error) throw error
  if (!data) return empty

  const snap = data as {
    inputs_json: Record<string, unknown> | null
    provenance_json: Record<string, unknown> | null
  }
  const ei = ((snap.inputs_json ?? {}).ei ?? {}) as Record<string, unknown>
  const provenance = snap.provenance_json ?? {}
  return {
    total_power_kwh: (ei.total_power_kwh as number | null) ?? null,
    aeration_power_kwh: (ei.aeration_power_kwh as number | null) ?? null,
    biomass_delta_kg: (ei.biomass_delta_kg as number | null) ?? null,
    source_meter_ids: (provenance.source_meter_ids as string[] | null) ?? [],
    source_biomass_refs: (provenance.source_biomass_refs as string[] | null) ?? [],
  }
}

export type GeneratedMrvReport = {
  report: MrvReportRow
  emissionFactor: EmissionFactorRow
}

export async function generateMrvReport(params: {
  db: MrvDb
  site: SiteRow
  orgId: string
  userId: string
  afterPeriodFrom: Date
  afterPeriodTo: Date
  emissionFactorId: string | null
}): Promise<GeneratedMrvReport> {
  const { db, site, orgId, userId, afterPeriodFrom, afterPeriodTo, emissionFactorId } =
    params

  const bsl = await loadLockedBaseline(db, site.id)
  const ef = await loadEmissionFactor(db, emissionFactorId)

  const comp = await computeSiteKpiResults(db, site.id, afterPeriodFrom, afterPeriodTo)
  const beforeInputs = await baselineEiInputs(db, bsl)

  const baselinePowerMwh =
    beforeInputs.total_power_kwh !== null ? beforeInputs.total_power_kwh / 1000.0 : null
  const afterPowerMwh = comp.ei.totalPowerKwh / 1000.0

  const scope2Inputs: Scope2Input = {
    baselineEiTotal: bsl.ei_total,
    afterEiTotal: comp.ei.eiTotal,
    afterBiomassDeltaKg: comp.ei.biomassDeltaKg,
    baselinePowerMwh,
    afterPowerMwh,
    emissionFactorTco2ePerMwh: ef.factor_tco2e_per_mwh,
    emissionFactorSource: ef.source,
    emissionFactorYear: ef.year,
    emissionFactorVersion: ef.version,
  }
  // ★ 산정을 스냅샷 저장보다 먼저 한다. 산정이 거부되는 입력(예: after 기간 생산량이 0)
  // 이면 여기서 멈추므로, 리포트 없이 스냅샷만 남는 고아 행이 생기지 않는다.
  // 엔진의 KpiValueError 는 handleRoute 가 422 로 옮긴다(원본과 같은 상태 코드).
  const scope2 = computeScope2Reduction(scope2Inputs)

  const afterSnapshotId = await persistKpiSnapshot(db, {
    siteId: site.id,
    orgId,
    periodStart: afterPeriodFrom,
    periodEnd: afterPeriodTo,
    comp,
  })

  const beforeJson = {
    period: { from: bsl.period_start, to: bsl.period_end },
    config_version: bsl.config_version,
    ei_total: bsl.ei_total,
    ei_aeration: bsl.ei_aeration,
    total_power_kwh: beforeInputs.total_power_kwh ?? 0.0,
    aeration_power_kwh: beforeInputs.aeration_power_kwh ?? 0.0,
    biomass_delta_kg: beforeInputs.biomass_delta_kg ?? 0.0,
    scope2_tco2e: scope2.scope2TCo2eBaseline,
    kpi_snapshot_id: bsl.kpi_snapshot_id,
  }
  const afterJson = {
    period: { from: afterPeriodFrom.toISOString(), to: afterPeriodTo.toISOString() },
    config_version: comp.configVersion,
    ei_total: comp.ei.eiTotal,
    ei_aeration: comp.ei.eiAeration,
    total_power_kwh: comp.ei.totalPowerKwh,
    aeration_power_kwh: comp.ei.aerationPowerKwh,
    biomass_delta_kg: comp.ei.biomassDeltaKg,
    scope2_tco2e: scope2.scope2TCo2eAfter,
    kpi_snapshot_id: afterSnapshotId,
  }

  const includedMeterIds = Array.from(
    new Set([...beforeInputs.source_meter_ids, ...comp.ei.sourceMeterIds]),
  ).sort()
  const eiParams = ((comp.paramsOut ?? {}).ei ?? {}) as Record<string, unknown>

  const boundaryJson = {
    site_id: site.id,
    site_name: site.name,
    included_meter_ids: includedMeterIds,
    included_quality_flags: (eiParams.included_quality_flags as string[] | undefined) ?? [
      "ok",
    ],
    biomass_source_refs: {
      before: beforeInputs.source_biomass_refs,
      after: [...comp.ei.sourceBiomassRefs],
    },
    config_version: { before: bsl.config_version, after: comp.configVersion },
    assumptions: [...ASSUMPTIONS],
  }

  const report: MrvReportRow = {
    id: newId("mrv"),
    site_id: site.id,
    org_id: orgId,
    baseline_id: bsl.id,
    period_start: afterPeriodFrom.toISOString(),
    period_end: afterPeriodTo.toISOString(),
    emission_factor_id: ef.id,
    after_kpi_snapshot_id: afterSnapshotId,
    before_json: beforeJson,
    after_json: afterJson,
    reduction_tco2e: scope2.reductionTco2e,
    formula_text: scope2.formulaText,
    boundary_json: boundaryJson,
    // 원본은 여기서 PDF 파일을 렌더해 경로를 남겼다. 이식본은 서버에 파일을 두지 않고
    // 요청 시 /pdf 엔드포인트가 인쇄용 문서를 그려 낸다(그쪽 주석에 이유를 적었다).
    pdf_path: null,
    generated_by: userId,
    generated_at: new Date().toISOString(),
  }

  const { error } = await db.from(T.reports).insert(report)
  if (error) throw error

  await recordAudit(db, {
    orgId,
    actorId: userId,
    entity: "mrv_reports",
    entityId: report.id,
    action: "generate",
    diff: {
      before: null,
      after: {
        id: report.id,
        site_id: site.id,
        baseline_id: bsl.id,
        period: { from: report.period_start, to: report.period_end },
        emission_factor_id: ef.id,
        reduction_tco2e: report.reduction_tco2e,
      },
    },
  })

  return { report, emissionFactor: ef }
}

/** 저장된 리포트 행 → API 응답(생성/재조회 공용 형태). */
export function mrvReportToResponse(
  report: MrvReportRow,
  ef: EmissionFactorRow,
) {
  const before = report.before_json as Record<string, never>
  const after = report.after_json as Record<string, never>
  const boundary = report.boundary_json as Record<string, never>

  const summary = (s: Record<string, never>) => ({
    period: {
      from: (s.period as unknown as { from: string }).from,
      to: (s.period as unknown as { to: string }).to,
      granularity: "period",
    },
    config_version: s.config_version,
    ei_total: s.ei_total,
    ei_aeration: s.ei_aeration,
    total_power_kwh: s.total_power_kwh,
    aeration_power_kwh: s.aeration_power_kwh,
    biomass_delta_kg: s.biomass_delta_kg,
    scope2_tco2e: s.scope2_tco2e,
    kpi_snapshot_id: s.kpi_snapshot_id ?? null,
  })

  return {
    id: report.id,
    site_id: report.site_id,
    org_id: report.org_id,
    baseline_id: report.baseline_id,
    period: {
      from: report.period_start,
      to: report.period_end,
      granularity: "period",
    },
    before: summary(before),
    after: summary(after),
    reduction_tco2e: report.reduction_tco2e,
    formula_text: report.formula_text,
    emission_factor: { version: ef.version, source: ef.source, year: ef.year },
    boundary,
    // 인쇄용 문서는 언제든 그려 낼 수 있으므로 항상 사용 가능하다.
    pdf_available: true,
    generated_by: report.generated_by,
    generated_at: report.generated_at,
  }
}
