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
  /** 사용 중단 표시. 자동 선택에서만 빠지고, 명시 지정과 과거 리포트 렌더는 그대로다. */
  deprecated_at?: string | null
  // ── 출처(마이그레이션 mrv_emission_factor_provenance.sql) ──
  // 선택이다. 옛 행은 비어 있을 수 있으므로 전부 optional 로 둔다.
  gas_scope?: string | null
  basis_from_year?: number | null
  basis_to_year?: number | null
  document_name?: string | null
  issuing_body?: string | null
  published_on?: string | null
  source_url?: string | null
  method?: string | null
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
 *
 * **자동 선택에서는 `deprecated_at` 이 찍힌 행을 뺀다.** 출처·연도 라벨이 틀린 것으로
 * 밝혀진 계수가 새 리포트에 다시 쓰이면 안 된다. 다만 **명시 지정은 막지 않는다** —
 * 과거 리포트를 그때 쓴 계수로 재생성하는 일이 있어야 하고, 그 행을 못 쓰게 만들면
 * 재현성이 사라진다.
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
  /**
   * ★ `effective_from <= now()` 와 2차 정렬 키가 여기 있는 이유 (2026-10-19 보강)
   *
   * 전에는 `effective_from desc limit 1` 뿐이었다. 그래서
   *   · **아직 적용 시점이 오지 않은 계수가 지금 발행하는 리포트에 쓰였다.** 다음 해
   *     계수를 미리 등록해 두는 것은 이 표에서 정상적인 일이다(값에 공표일이 붙어
   *     있다 — mrv_emission_factor_2023.sql 의 「year 와 effective_from 은 다른 것이다」
   *     절). 미리 등록한 값이 곧바로 활성이 되면 그 등록 자체를 할 수 없다.
   *   · 같은 `effective_from` 으로 두 행이 있으면 **어느 것이 활성인지 실행 계획에
   *     달렸다.** Scope2 배출량을 곱하는 수치가 날마다 달라질 수 있다는 뜻이다
   *     (같은 승인분의 CO2e 판과 CO2 판이 같은 날짜로 들어오는 경우가 실제로 있다 —
   *     mrv_emission_factor_source.sql 이 그 상황을 적어 두었다).
   *
   * 그래서 적용 시점이 지난 행만 보고, 동률은 `created_at desc` → `version desc` 로
   * 깬다(두 열 모두 이 표에는 처음부터 있다). KPI 설정과 달리 미래 등록을 **거부하지
   * 않는 이유**는 app/api/mrv/kpi-config/route.ts 의 `assertEffectiveFrom` 에 적어 두었다.
   */
  const { data, error } = await db
    .from(T.emissionFactors)
    .select("*")
    .is("deprecated_at", null)
    .lte("effective_from", new Date().toISOString())
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) {
    throw new HttpError(
      404,
      "no emission factor configured (적용 시점이 지난 계수가 없습니다 — 등록된 계수의 " +
        "effective_from 이 모두 미래이면 이 오류가 납니다)",
    )
  }
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

  const comp = await computeSiteKpiResults(db, site.id, orgId, afterPeriodFrom, afterPeriodTo)
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
    /**
     * **산입된 전력의 자료유형 집계** — 이 리포트의 EI·Scope2 배출량의 분자가 계량기
     * 실측인지, 산식으로 계산한 값인지.
     *
     * 왜 리포트가 이것을 들고 있어야 하는가: `mrv_readings.measurement_basis` 는 행마다
     * 적히지만, 그 행들은 나중에 보정·추가된다. 발행된 리포트가 **발행 시점의 집계**를
     * 들고 있지 않으면, 반 년 뒤 그 리포트를 다시 열었을 때 "그때 이 수치가 무엇으로
     * 산출됐는가" 가 달라져 있다. 배출계수 출처(`emission_factor`)와 산식 전문
     * (`formula_text`)을 생성 시점에 얼리는 것과 같은 이유다.
     *
     * **After 기간만 담는다.** Before(기준선)의 전력은 잠긴 스냅샷에 들어 있고
     * (`inputs_json.ei.measurement_basis` — lib/mrv/snapshots.ts), 그 스냅샷을 다시 읽어
     * 여기 옮기면 이 칸이 '리포트가 산출한 것' 과 '옛 스냅샷에서 베낀 것' 을 섞어 담게
     * 된다. 옛 기준선 스냅샷에는 그 칸이 아예 없으므로(이 집계를 넣기 전에 잠긴 것들)
     * 베낄 값조차 없다 — 그 경우 0 으로 채우면 "기준선 전력은 전부 실측" 이라는 거짓이
     * 된다. 그래서 이 칸의 주어를 After 로 한정하고, 화면·인쇄물이 그렇게 적는다.
     */
    after_power_measurement_basis: comp.eiMeasurementBasis,
    /**
     * **분모로 쓰인 생체량의 산정 근거** — 이 리포트의 EI·FCR 의 분모가 실측 출하·계측량
     * 인지, 입식수 × 최종평균개체중으로 계산한 값인지.
     *
     * 왜 리포트가 이것을 들고 있어야 하는가: `after_power_measurement_basis` 와 **같은
     * 이유**다. 산정 근거는 수확 기록 행마다 적히지만 그 행들은 나중에 보정·추가된다.
     * 발행된 리포트가 **발행 시점의 근거**를 들고 있지 않으면, 반 년 뒤 그 리포트를 다시
     * 열었을 때 "그때 이 수치의 분모가 무엇이었는가" 가 달라져 있다.
     *
     * **집계가 아니라 두 점이다.** 기간에 수확 기록이 50건 있어도 Δbiomass 를 만든 것은
     * 양 끝 두 건뿐이므로, 50건의 분포를 적으면 분모의 성질을 틀리게 적는다
     * (lib/mrv/production-basis.ts 머리말).
     *
     * **After 기간만 담는다.** Before(기준선)의 생체량은 잠긴 스냅샷에 있고, 옛 스냅샷에는
     * 이 칸이 아예 없으므로 베낄 값조차 없다 — 0 이나 'measured' 로 채우면 "기준선 생산량은
     * 실측" 이라는 거짓이 된다. 전력 자료유형과 같은 판단이고, 화면·인쇄물이 그렇게 적는다.
     */
    after_biomass_basis: comp.eiBiomassBasis,
    /**
     * After 기간의 「산출 불가」 사유를 확정하는 **근거 수치** — 생산량 변화와 그
     * 산출 임계값, 산입 건수, 폭기 전력, 입식 수 등(lib/mrv/metric-unavailability.ts).
     *
     * 왜 리포트가 이것을 들고 있어야 하는가: 원천 행은 나중에 보정·추가되고 조직의
     * `kpi_config` 는 새 version 으로 임계값을 덮는다. 발행된 리포트가 **발행 시점의
     * 근거**를 들고 있지 않으면, 반 년 뒤 그 리포트를 다시 열었을 때 "그때 왜 이 칸이
     * 비었는가" 가 달라져 있다 — 배출계수 출처와 전력 자료유형을 얼리는 것과 같은
     * 이유다.
     *
     * **문장은 얼리지 않는다.** 수치만 담고 사람이 읽는 문구는 공용 모듈이 만든다 —
     * 품질 플래그·전력 자료유형과 같은 규약이고, 그래서 화면과 인쇄물이 갈릴 수 없다.
     *
     * **After 기간만 담는다.** Before 의 근거는 잠긴 스냅샷에 있고(inputs_json),
     * 그것을 여기 베껴 오면 '리포트가 산출한 것' 과 '옛 스냅샷에서 베낀 것' 이 섞인다.
     */
    after_metric_evidence: comp.unavailabilityEvidence,
    biomass_source_refs: {
      before: beforeInputs.source_biomass_refs,
      after: [...comp.ei.sourceBiomassRefs],
    },
    config_version: { before: bsl.config_version, after: comp.configVersion },
    /**
     * 적용 배출계수의 출처를 **생성 시점에 얼려 넣는다.**
     *
     * 왜 스냅샷인가: 인쇄 리포트는 `emission_factor_id` 로 계수 행을 활성 조인해 왔다.
     * 그러면 나중에 운영자가 그 행의 문서명·URL 을 보강하는 순간 **이미 발행된 리포트의
     * 인용문이 바뀐다.** 값이 바뀌는 건 아니지만, 발행된 증빙 문서가 사후에 달라지는 것
     * 자체가 검증에서 문제가 된다. 산식 전문(`formula_text`)을 생성 시점에 얼리는 것과
     * 같은 이유다.
     *
     * 옛 리포트에는 이 칸이 없으므로 인쇄 템플릿이 **스냅샷 우선 · 활성 조인 폴백** 으로
     * 읽는다.
     */
    emission_factor: {
      version: ef.version,
      source: ef.source,
      year: ef.year,
      factor_tco2e_per_mwh: ef.factor_tco2e_per_mwh,
      gas_scope: ef.gas_scope ?? null,
      basis_from_year: ef.basis_from_year ?? null,
      basis_to_year: ef.basis_to_year ?? null,
      document_name: ef.document_name ?? null,
      issuing_body: ef.issuing_body ?? null,
      published_on: ef.published_on ?? null,
      source_url: ef.source_url ?? null,
      method: ef.method ?? null,
    },
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
