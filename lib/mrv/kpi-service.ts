/**
 * kpi-service — DB 행을 KPI 엔진 입력으로 조립하고 4종 compute_* 를 호출한다.
 *
 * 원본: mrv-platform/apps/api/app/services/kpi_service.py
 *
 * ★ 산식은 여기서 절대 쓰지 않는다. `lib/mrv/kpi` 의 computeEi/computeFcr/computeOei/
 * computeMortality 를 호출만 한다. 이 파일의 책임은 순수한 '조립':
 *   1) DB 행(readings/meters/feed_logs/mortality_logs/batches/tanks/harvest/kpi_config)을
 *      엔진 입력 타입으로 변환,
 *   2) 4종 엔진 호출,
 *   3) 결과를 API 응답(KpiResponse)으로 매핑(status/inputs/provenance 포함).
 *
 * 결정론: generated_at 은 응답 메타데이터일 뿐 산출 입력이 아니다.
 */

import {
  alertingConfigFromParams,
  classifyMetricStatus,
  computeEi,
  computeFcr,
  computeMortality,
  computeOei,
  eiConfigFromParams,
  eiConfigToParams,
  fcrConfigFromParams,
  fcrConfigToParams,
  mortalityConfigFromParams,
  mortalityConfigToParams,
  oeiConfigFromParams,
  oeiConfigToParams,
  METRIC_DIRECTIONS,
} from "./kpi"
import type {
  BiomassPoint,
  DoBand,
  DoReading,
  EiConfig,
  EiResult,
  FcrResult,
  FeedReading,
  KpiThresholds,
  MortalityReading,
  MortalityResult,
  OeiResult,
  ParamsJson,
  PowerReading,
} from "./kpi"
import { T, fetchAll, type MrvDb } from "./db"
import { loadActiveKpiConfig } from "./kpi-config-source"
import {
  isMissingMeasurementBasisColumnError,
  noteMissingMeasurementBasisColumn,
  shouldSendMeasurementBasisColumn,
} from "./measurement-basis-column"
import {
  emptyMeasurementBasisTally,
  isMeasurementBasis,
  type MeasurementBasis,
  type MeasurementBasisTally,
} from "./measurement-basis"
import {
  isMissingProductionBasisColumnError,
  noteMissingProductionBasisColumn,
  shouldSendProductionBasisColumns,
} from "./production-basis-column"
import {
  emptyProductionBasisPoint,
  isProductionBasis,
  type BiomassBasisRecord,
  type ProductionBasisPoint,
} from "./production-basis"
import { metricUnavailabilityReasons } from "./metric-unavailability"
import type { MetricUnavailabilityEvidence } from "./metric-unavailability"
import type {
  KpiMetric,
  KpiMetricKey,
  KpiResponse,
  KpiUnavailability,
} from "./api-types"

// ---------------------------------------------------------------------------
// 조립 헬퍼
// ---------------------------------------------------------------------------

/** 지표 슬롯 생성. 신호등 판정은 엔진(classifyMetricStatus)에만 맡긴다. */
function metric(
  value: number | null,
  unit: string,
  metricKey: keyof KpiThresholds,
  thresholds: KpiThresholds,
): KpiMetric {
  return {
    value,
    unit,
    status: classifyMetricStatus(value, METRIC_DIRECTIONS[metricKey], thresholds[metricKey]),
  }
}

/**
 * 수확·계측 기록 한 행.
 *
 * 뒤의 세 칸은 **산정 근거**다(supabase/migrations/mrv_harvest_logs_production_basis.sql).
 * 열이 없는 DB 에서 읽었으면 그 칸이 아예 없다 → 미기재로 다룬다.
 */
type HarvestRow = {
  id: string
  ts: string
  biomass_kg: number
  production_basis?: string | null
  production_basis_note?: string | null
  survival_adjusted?: boolean | null
}

/**
 * 기간 내 harvest_logs(시각 오름차순)에서 개시/마감 생체량 시점을 고른다.
 *   - 2행 이상: 가장 이른 시점=개시, 가장 늦은 시점=마감.
 *   - 1행: 개시=마감 → delta=0 → 산출 불가(엔진이 null 을 낸다).
 *   - 0행: 둘 다 0kg 더미 → 산출 불가.
 * 결정론적이며, 산식이 아니라 '데이터 선택'이다.
 */
function pickBiomassBounds(harvests: HarvestRow[]): [BiomassPoint, BiomassPoint] {
  if (harvests.length >= 2) {
    const first = harvests[0]
    const last = harvests[harvests.length - 1]
    return [
      { ts: new Date(first.ts), biomassKg: first.biomass_kg, sourceRef: first.id },
      { ts: new Date(last.ts), biomassKg: last.biomass_kg, sourceRef: last.id },
    ]
  }
  if (harvests.length === 1) {
    const only = harvests[0]
    const point: BiomassPoint = {
      ts: new Date(only.ts),
      biomassKg: only.biomass_kg,
      sourceRef: only.id,
    }
    return [point, point]
  }
  const empty: BiomassPoint = { ts: new Date(0), biomassKg: 0.0, sourceRef: "none" }
  return [empty, empty]
}

/**
 * 분모를 만든 **두 점의 산정 근거**를 그 행에서 그대로 꺼낸다.
 *
 * ★ 집계(건수 분포)가 아니라 **두 점**이다. 기간에 수확 기록이 50건 있어도 Δbiomass 를
 *   만든 것은 양 끝 두 건뿐이므로(pickBiomassBounds), 50건의 분포를 적으면 "분모가
 *   무엇으로 만들어졌는가" 를 틀리게 적는다. 전력 쪽(모든 산입 건이 분자에 더해진다)과
 *   다른 모양인 이유가 그것이다 — lib/mrv/production-basis.ts 머리말.
 *
 * 기록이 없어 0 kg 더미가 쓰인 경우에는 **빈 점**을 돌려준다. `sourceRef: "none"` 을
 * 그대로 적으면 "none 이라는 행을 실측했다" 로 읽힌다.
 *
 * 모르는 문자열은 **미기재로 둔다** — 실측으로 읽으면 없는 사실을 만들어 내는 것이고,
 * 미기재는 "아는 기록이 없다" 라는 참인 진술이다(전력 쪽과 같은 판단).
 */
function pickBiomassBasis(
  harvests: HarvestRow[],
  start: BiomassPoint,
  end: BiomassPoint,
): BiomassBasisRecord {
  const byId = new Map(harvests.map((h) => [h.id, h]))
  const point = (p: BiomassPoint): ProductionBasisPoint => {
    const row = byId.get(p.sourceRef)
    if (row === undefined) return emptyProductionBasisPoint()
    return {
      source_ref: row.id,
      ts: new Date(row.ts).toISOString(),
      biomass_kg: row.biomass_kg,
      basis: isProductionBasis(row.production_basis) ? row.production_basis : null,
      basis_note:
        typeof row.production_basis_note === "string" && row.production_basis_note !== ""
          ? row.production_basis_note
          : null,
      survival_adjusted:
        typeof row.survival_adjusted === "boolean" ? row.survival_adjusted : null,
    }
  }
  return { start: point(start), end: point(end) }
}

/** 자료유형 집계의 버킷 키. 미기재(null)는 따로 센다 — 실측이 아니라 「모른다」다. */
type BasisBucket = MeasurementBasis | "unrecorded"

/**
 * **EI 에 산입된** 전력 계측값의 자료유형 분포를 센다.
 *
 * ★ 산입 판정(기간 반열림 + 품질 플래그 화이트리스트)을 **여기서 다시 쓰지 않는다.**
 *   그 규칙은 `lib/mrv/kpi/energy.ts` 에 있고 그 모듈은 원본 Python 과 차분검증돼 있어
 *   손댈 수 없다. 대신 자료유형별로 나눈 계측값 묶음을 **같은 엔진에 그대로 다시 넣어**
 *   `includedReadingCount` 만 읽는다 — 산입 판정은 계측값 하나하나에 독립적으로
 *   걸리므로(isIncluded 는 그 건의 시각과 플래그만 본다), 쪼개 넣은 건수의 합은 전체를
 *   한 번에 넣은 건수와 **정의상 같다.** 판정을 베껴 적으면 나중에 한쪽만 바뀌는 날이
 *   오고, 그때 리포트가 "실측 N건" 을 틀리게 적는다.
 *
 * 합이 `ei.includedReadingCount` 와 같아야 한다는 성질은
 * `scripts/mrv/verify-pipeline.mjs` 가 실물 엔진으로 확인한다.
 *
 * 비유한(NaN) 값에 대한 KpiValueError 는 여기서 새로 생기지 않는다 — 호출부가 **먼저**
 * 전체 묶음으로 computeEi 를 부르므로, 그런 입력이면 이 함수에 닿기 전에 던진다.
 */
function tallyIncludedMeasurementBasis(
  byBasis: ReadonlyMap<BasisBucket, PowerReading[]>,
  biomassStart: BiomassPoint,
  biomassEnd: BiomassPoint,
  periodFrom: Date,
  periodTo: Date,
  eiConfig: EiConfig,
  configVersion: string,
): MeasurementBasisTally {
  const tally = emptyMeasurementBasisTally()
  for (const [bucket, readings] of byBasis) {
    if (readings.length === 0) continue
    const part = computeEi(
      readings,
      biomassStart,
      biomassEnd,
      periodFrom,
      periodTo,
      eiConfig,
      configVersion,
    )
    tally[bucket] = part.includedReadingCount
  }
  return tally
}

/** 4종 KPI 원본 산출 결과 묶음(응답/스냅샷 공용). */
export type SiteKpiComputation = {
  ei: EiResult
  fcr: FcrResult
  /** tank 의 DO 목표대역이 설정돼 있지 않으면 null(= OEI 산출 대상 아님). */
  oei: OeiResult | null
  mortality: MortalityResult
  /**
   * **EI 에 산입된** 전력 계측값의 자료유형 분포(실측/계산값/어림값/미기재).
   *
   * EI·Scope2 의 분자가 무엇으로 만들어졌는지를 말하는 수이고, MRV 리포트의
   * `boundary_json` 과 기준선 잠금 판정이 이것을 읽는다. 산입되지 않은 건은 분자에 들어
   * 가지 않으므로 세지 않는다 — 세면 "이 배출량이 무엇으로 산출됐는가" 를 틀리게 적는다.
   */
  eiMeasurementBasis: MeasurementBasisTally
  /**
   * **분모로 쓰인 생체량 두 점의 산정 근거** — 실측 출하·계측량인지, 입식수 × 평균체중
   * 으로 계산한 값인지, 어림값인지.
   *
   * EI·폭기 EI·FCR·OEI 의 **분모**가 무엇으로 만들어졌는지를 말하는 자료이고, MRV
   * 리포트의 `boundary_json` 과 기준선 잠금 판정이 이것을 읽는다. `eiMeasurementBasis` 가
   * 분자(전력)에 대해 하는 일을 분모에 대해 한다 — 둘을 함께 읽어야 "EI 가 낮은 것이
   * 전기를 덜 쓴 결과인가, 생산량을 넉넉히 가정한 결과인가" 가 갈린다.
   */
  eiBiomassBasis: BiomassBasisRecord
  /**
   * 「산출 불가」의 사유를 **엔진 밖에서 확정하는 데 쓰는 근거.**
   *
   * 엔진 결과와 **그 산출에 실제로 쓰인 임계값**을 함께 묶은 것이다. 임계값을 여기서
   * 같이 싣는 이유: 조직의 활성 `kpi_config` 가 덮을 수 있으므로 화면이나 리포트가
   * 나중에 다시 추측할 수 없다 — 그때그때 읽어 둔 값만이 참이다
   * (`lib/mrv/metric-unavailability.ts` 머리말).
   *
   * 새 산식이 아니다. 이미 산출된 결과의 수와 설정값을 한 자리에 모으기만 한다.
   */
  unavailabilityEvidence: MetricUnavailabilityEvidence
  configVersion: string
  paramsOut: ParamsJson
  tankId: string | null
}

/** KPI 응답·리포트가 함께 쓰는 지표 목록. 한 곳만 보면 되도록 여기 둔다. */
const UNAVAILABILITY_METRIC_KEYS: readonly KpiMetricKey[] = [
  "ei_total",
  "ei_aeration",
  "oei",
  "fcr",
  "mortality_rate",
]

/**
 * 값이 null 인 지표에만 사유를 붙인다. 값이 있는 지표에 붙이면 「함께 비어 있음」 항목이
 * 산출된 값 옆에 사유처럼 뜬다 — 그 자리에서 할 말은 사유가 아니다.
 *
 * 문장은 `lib/mrv/metric-unavailability.ts` 가 만든다. 응답에 실어 보내는 것과 화면이
 * 직접 만드는 것이 **같은 모듈의 출력**이므로, 화면 · 인쇄물 · API 가 갈릴 수 없다.
 */
export function buildKpiUnavailability(
  comp: SiteKpiComputation,
  values: Readonly<Record<KpiMetricKey, number | null>>,
): KpiUnavailability {
  const metrics: KpiUnavailability["metrics"] = {}
  for (const key of UNAVAILABILITY_METRIC_KEYS) {
    if (values[key] !== null) continue
    metrics[key] = { reasons: metricUnavailabilityReasons(key, comp.unavailabilityEvidence) }
  }
  return { evidence: comp.unavailabilityEvidence, metrics }
}

/**
 * site 의 4종 KPI(EI/FCR/OEI/mortality)를 기간 [from, to) 로 산출한다.
 * ⚠ 호출 전에 resolveSiteForOrg 로 site 소유권이 검증되어 있어야 한다.
 *
 * `orgId` 는 **산식 파라미터를 고르는 데 쓴다.** 어느 조직의 KPI 설정으로 계산하는지가
 * 이 인자로 정해지므로, site 를 확인한 그 org 를 그대로 넘겨야 한다 — 다른 org 를 넘기면
 * 그 조직의 파라미터로 남의 사이트를 판정한다(lib/mrv/kpi-config-source.ts).
 *
 * `asOf` 는 「그 시점에 적용 중인 설정」을 고르는 기준 시각이다. 기본값은 현재이고,
 * 알림 배치만 자기 평가 시각을 넘긴다(한 배치 안에서 설정이 바뀌지 않게).
 */
export async function computeSiteKpiResults(
  db: MrvDb,
  siteId: string,
  orgId: string,
  periodFrom: Date,
  periodTo: Date,
  asOf?: Date,
): Promise<SiteKpiComputation> {
  const { version: configVersion, params } = await loadActiveKpiConfig(db, orgId, asOf)

  const eiConfig = eiConfigFromParams(params)
  const fcrConfig = fcrConfigFromParams(params)
  const oeiConfig = oeiConfigFromParams(params)
  const mortalityConfig = mortalityConfigFromParams(params)

  // 응답에 실어 보낼 파라미터 문서. DB 에 설정이 없으면 엔진 기본값을 직렬화해 보여 준다
  // (화면이 "어떤 파라미터로 계산했는가"를 항상 표시할 수 있어야 한다).
  const paramsOut: ParamsJson =
    Object.keys(params).length > 0
      ? { ...params }
      : {
          ei: eiConfigToParams(eiConfig),
          fcr: fcrConfigToParams(fcrConfig),
          oei: oeiConfigToParams(oeiConfig),
          mortality: mortalityConfigToParams(mortalityConfig),
        }

  // --- 계측기와 계측값 ---
  const meters = await fetchAll<{ id: string; type: string; is_aeration: boolean }>(
    (f, t) =>
      db
        .from(T.meters)
        .select("id, type, is_aeration")
        .eq("site_id", siteId)
        .order("id", { ascending: true })
        .range(f, t),
  )
  const meterType = new Map(meters.map((m) => [m.id, m.type]))
  const aerationByMeter = new Map(meters.map((m) => [m.id, m.is_aeration]))
  const meterIds = meters.map((m) => m.id)

  const powerReadings: PowerReading[] = []
  const doReadings: DoReading[] = []
  /**
   * 자료유형별로 나눈 전력 계측값. 아래에서 **같은 엔진에 다시 넣어** 산입 건수를 센다
   * (tallyIncludedMeasurementBasis 의 머리말 참고). `PowerReading` 에 이 칸을 더하지
   * 않는 이유: 그 타입은 차분검증된 엔진의 입력이라 손대지 않는다.
   */
  const powerByBasis = new Map<BasisBucket, PowerReading[]>()
  if (meterIds.length > 0) {
    /**
     * ⚠ `measurement_basis` 는 마이그레이션
     * (supabase/migrations/mrv_readings_measurement_basis.sql)이 더하는 열이고 **실행은
     * 사람 몫**이다. 그 열이 없는 DB 에서 이 질의는 거절되는데(42703), 이것은 KPI·
     * 리포트·알림·기준선 판정 **전부의 첫 질의**다 — 열 하나 때문에 증빙 산출이 통째로
     * 멈추게 둘 수 없다. 그래서 그 칸 때문에 거절된 것이 확인되면 칸을 빼고 한 번 더
     * 읽는다. 그 경우 자료유형은 전부 '미기재' 로 집계되고(없는 사실을 만들지 않는다),
     * 로그가 그 상태를 알린다(./measurement-basis-column.ts, 선례 커밋 632b2a6).
     */
    type ReadingRow = {
      time: string
      meter_id: string
      value: number
      quality_flag: string
      /** 열이 없는 DB 에서 읽었으면 이 칸이 아예 없다 → 미기재로 센다. */
      measurement_basis?: string | null
    }
    // 질의 사슬을 두 번 적는다. `select()` 에 삼항 결과를 넘기면 Supabase 의 열 목록
    // 타입 파서가 **문자열 리터럴 유니온**을 해석하지 못해 행 타입이 깨진다(실제로 깨졌다).
    // 두 사슬의 차이는 열 목록 한 칸뿐이고, 나머지 조건은 같아야 하므로 함께 둔다.
    const readRows = (withBasis: boolean) =>
      fetchAll<ReadingRow>((f, t) =>
        withBasis
          ? db
              .from(T.readings)
              .select("time, meter_id, value, quality_flag, measurement_basis")
              .in("meter_id", meterIds)
              .gte("time", periodFrom.toISOString())
              .lte("time", periodTo.toISOString())
              .order("time", { ascending: true })
              .range(f, t)
          : db
              .from(T.readings)
              .select("time, meter_id, value, quality_flag")
              .in("meter_id", meterIds)
              .gte("time", periodFrom.toISOString())
              .lte("time", periodTo.toISOString())
              .order("time", { ascending: true })
              .range(f, t),
      )

    const sendBasis = shouldSendMeasurementBasisColumn()
    let rows: ReadingRow[]
    try {
      rows = await readRows(sendBasis)
    } catch (err) {
      if (!sendBasis || !isMissingMeasurementBasisColumnError(err)) throw err
      noteMissingMeasurementBasisColumn("mrv_readings select")
      rows = await readRows(false)
    }
    for (const r of rows) {
      const mtype = meterType.get(r.meter_id)
      if (mtype === "power") {
        const reading: PowerReading = {
          meterId: r.meter_id,
          ts: new Date(r.time),
          kwh: r.value,
          isAeration: Boolean(aerationByMeter.get(r.meter_id)),
          qualityFlag: r.quality_flag,
        }
        powerReadings.push(reading)
        // CHECK 제약이 집합 밖의 값을 막지만(마이그레이션), 그 제약이 붙기 전에 SQL 로
        // 들어간 값이 있을 수 있다. 모르는 문자열은 **미기재로 센다** — 실측으로 세면
        // 없는 사실을 만들어 내는 것이고, 미기재는 "아는 기록이 없다" 라는 참인 진술이다.
        const bucket: BasisBucket = isMeasurementBasis(r.measurement_basis)
          ? r.measurement_basis
          : "unrecorded"
        const bag = powerByBasis.get(bucket)
        if (bag === undefined) powerByBasis.set(bucket, [reading])
        else bag.push(reading)
      } else if (mtype === "do") {
        doReadings.push({
          meterId: r.meter_id,
          ts: new Date(r.time),
          doMgL: r.value,
          qualityFlag: r.quality_flag,
        })
      }
    }
  }

  // --- 생체량(EI/FCR 분모) ---
  /**
   * ⚠ 산정 근거 세 열은 마이그레이션
   * (supabase/migrations/mrv_harvest_logs_production_basis.sql)이 더하는 것이고 **실행은
   * 사람 몫**이다. 그 열이 없는 DB 에서 이 질의는 거절되는데(42703), 분모를 읽는 이 질의는
   * KPI·리포트·알림·기준선 판정 전부의 길목이다 — 메타데이터 칸 셋 때문에 증빙 산출이
   * 통째로 멈추게 둘 수 없다. 그래서 그 칸 때문에 거절된 것이 확인되면 칸을 빼고 한 번 더
   * 읽는다(./production-basis-column.ts, 선례: measurement-basis-column.ts · 커밋 632b2a6).
   *
   * 질의 사슬을 두 번 적는 이유도 그쪽과 같다 — `select()` 에 삼항 결과를 넘기면 Supabase
   * 의 열 목록 타입 파서가 문자열 리터럴 유니온을 해석하지 못해 행 타입이 깨진다.
   */
  const readHarvests = (withBasis: boolean) =>
    fetchAll<HarvestRow>((f, t) =>
      withBasis
        ? db
            .from(T.harvestLogs)
            .select(
              "id, ts, biomass_kg, production_basis, production_basis_note, survival_adjusted",
            )
            .eq("site_id", siteId)
            .gte("ts", periodFrom.toISOString())
            .lte("ts", periodTo.toISOString())
            .order("ts", { ascending: true })
            .range(f, t)
        : db
            .from(T.harvestLogs)
            .select("id, ts, biomass_kg")
            .eq("site_id", siteId)
            .gte("ts", periodFrom.toISOString())
            .lte("ts", periodTo.toISOString())
            .order("ts", { ascending: true })
            .range(f, t),
    )

  const sendProductionBasis = shouldSendProductionBasisColumns()
  let harvests: HarvestRow[]
  try {
    harvests = await readHarvests(sendProductionBasis)
  } catch (err) {
    if (!sendProductionBasis || !isMissingProductionBasisColumnError(err)) throw err
    noteMissingProductionBasisColumn("mrv_harvest_logs select")
    harvests = await readHarvests(false)
  }
  const [biomassStart, biomassEnd] = pickBiomassBounds(harvests)
  const eiBiomassBasis = pickBiomassBasis(harvests, biomassStart, biomassEnd)

  // --- 배치와 수기 기록 ---
  const tanks = await fetchAll<{
    id: string
    target_do_min: number | null
    target_do_max: number | null
  }>((f, t) =>
    db
      .from(T.tanks)
      .select("id, target_do_min, target_do_max")
      .eq("site_id", siteId)
      .order("id", { ascending: true })
      .range(f, t),
  )
  const tankIds = tanks.map((t) => t.id)

  let batches: { id: string; stocked_count: number }[] = []
  if (tankIds.length > 0) {
    batches = await fetchAll<{ id: string; stocked_count: number }>((f, t) =>
      db
        .from(T.batches)
        .select("id, stocked_count")
        .in("tank_id", tankIds)
        .order("id", { ascending: true })
        .range(f, t),
    )
  }
  const batchIds = batches.map((b) => b.id)
  const stockedCount = batches.reduce((acc, b) => acc + Number(b.stocked_count), 0)

  const feedReadings: FeedReading[] = []
  const mortalityReadings: MortalityReading[] = []
  if (batchIds.length > 0) {
    const feedRows = await fetchAll<{
      id: string
      batch_id: string
      ts: string
      feed_kg: number
      quality_flag: string
    }>((f, t) =>
      db
        .from(T.feedLogs)
        .select("id, batch_id, ts, feed_kg, quality_flag")
        .in("batch_id", batchIds)
        .order("ts", { ascending: true })
        .range(f, t),
    )
    for (const f of feedRows) {
      feedReadings.push({
        sourceRef: f.id,
        batchId: f.batch_id,
        ts: new Date(f.ts),
        feedKg: f.feed_kg,
        qualityFlag: f.quality_flag,
      })
    }

    const mortRows = await fetchAll<{
      id: string
      batch_id: string
      ts: string
      dead_count: number
    }>((f, t) =>
      db
        .from(T.mortalityLogs)
        .select("id, batch_id, ts, dead_count")
        .in("batch_id", batchIds)
        .order("ts", { ascending: true })
        .range(f, t),
    )
    for (const m of mortRows) {
      mortalityReadings.push({
        sourceRef: m.id,
        batchId: m.batch_id,
        ts: new Date(m.ts),
        deadCount: m.dead_count,
      })
    }
  }

  // DO 목표대역이 설정된 첫 수조를 OEI 기준으로 삼는다(id 오름차순 — 결정론적 선택).
  let band: DoBand | null = null
  let tankId: string | null = null
  for (const t of tanks) {
    if (t.target_do_min !== null && t.target_do_max !== null) {
      band = { doMin: t.target_do_min, doMax: t.target_do_max }
      tankId = t.id
      break
    }
  }

  const ei = computeEi(
    powerReadings,
    biomassStart,
    biomassEnd,
    periodFrom,
    periodTo,
    eiConfig,
    configVersion,
  )
  const fcr = computeFcr(
    feedReadings,
    biomassStart,
    biomassEnd,
    periodFrom,
    periodTo,
    fcrConfig,
    configVersion,
  )
  const mortality = computeMortality(
    mortalityReadings,
    stockedCount,
    periodFrom,
    periodTo,
    mortalityConfig,
    configVersion,
  )
  const oei =
    band === null
      ? null
      : computeOei(
          doReadings,
          powerReadings,
          biomassStart,
          biomassEnd,
          band,
          periodFrom,
          periodTo,
          oeiConfig,
          configVersion,
        )

  // 자료유형 집계는 **전체 묶음으로 EI 를 낸 뒤에** 센다 — 비유한 값 같은 거부 사유는
  // 그 호출에서 먼저 드러나야 하고, 쪼갠 호출이 먼저 던지면 오류 문구가 어느 부분집합의
  // 것인지 알 수 없게 된다.
  const eiMeasurementBasis = tallyIncludedMeasurementBasis(
    powerByBasis,
    biomassStart,
    biomassEnd,
    periodFrom,
    periodTo,
    eiConfig,
    configVersion,
  )

  /**
   * 「산출 불가」 사유의 근거. **산식이 아니다** — 엔진이 돌려준 수와 엔진에 넘긴 설정을
   * 한 자리에 모으기만 한다(`lib/mrv/metric-unavailability.ts` 가 문장을 만든다).
   *
   * 임계값을 여기서 읽는 것이 핵심이다. 화면이나 리포트가 나중에 `min_biomass_delta_kg`
   * 를 0 으로 가정하면, 그 값을 0 이 아니게 둔 조직에 거짓 사유를 적는다 — 그래서 **이
   * 산출에 실제로 쓰인 설정 객체**에서 그대로 꺼낸다.
   *
   * 폭기 전력을 두 칸으로 나눠 싣는 이유는 그 타입의 주석에 적어 두었다(EI 와 OEI 의
   * 산입 품질 플래그가 서로 다를 수 있다).
   *
   * `biomass_record_count` 는 기간 안 수확·계측 기록 건수다. 0 건 · 1 건 · 2 건 이상이
   * 운영자가 할 일이 서로 다른 사유여서(기록이 없다 / 마감 기록이 없다 / 변화가 없거나
   * 줄었다) 분모 값만으로는 가를 수 없다.
   */
  const unavailabilityEvidence: MetricUnavailabilityEvidence = {
    biomass_delta_kg: ei.biomassDeltaKg,
    biomass_record_count: harvests.length,
    ei_min_biomass_delta_kg: eiConfig.minBiomassDeltaKg,
    fcr_min_biomass_delta_kg: fcrConfig.minBiomassDeltaKg,
    oei_min_biomass_kg: oeiConfig.minBiomassKg,
    total_power_kwh: ei.totalPowerKwh,
    aeration_power_kwh: ei.aerationPowerKwh,
    oei_aeration_power_kwh: oei?.aerationPowerKwh ?? null,
    included_reading_count: ei.includedReadingCount,
    excluded_reading_count: ei.excludedReadingCount,
    included_feed_count: fcr.includedFeedCount,
    excluded_feed_count: fcr.excludedFeedCount,
    stocked_count: mortality.stockedCount,
    // `oei === null` 은 「수조에 DO 목표대역이 없다」 하나뿐이다(위 band 선택 참고).
    oei_applicable: oei !== null,
    do_total_samples: oei?.doTotalSamples ?? null,
    do_excluded_samples: oei?.doExcludedSamples ?? null,
  }

  return {
    ei,
    fcr,
    oei,
    mortality,
    eiMeasurementBasis,
    eiBiomassBasis,
    unavailabilityEvidence,
    configVersion,
    paramsOut,
    tankId,
  }
}

/**
 * site 의 4종 KPI 를 산출해 API 응답으로 감싼다.
 * live read-only 계산이므로 provenance.kpi_snapshot_id 는 null 이다
 * (영속화는 기준선 잠금·스냅샷 경로에서만 일어난다).
 */
export async function computeSiteKpi(
  db: MrvDb,
  siteId: string,
  orgId: string,
  periodFrom: Date,
  periodTo: Date,
): Promise<KpiResponse> {
  const comp = await computeSiteKpiResults(db, siteId, orgId, periodFrom, periodTo)
  return kpiComputationToResponse(comp, siteId, orgId, periodFrom, periodTo)
}

/** SiteKpiComputation → KpiResponse. 기준선/리포트 경로도 이 매핑을 재사용한다. */
export function kpiComputationToResponse(
  comp: SiteKpiComputation,
  siteId: string,
  orgId: string,
  periodFrom: Date,
  periodTo: Date,
): KpiResponse {
  const { ei, fcr, oei, mortality: mort } = comp
  const thresholds = alertingConfigFromParams(comp.paramsOut).thresholds

  const values: Record<KpiMetricKey, number | null> = {
    ei_total: ei.eiTotal,
    ei_aeration: ei.eiAeration,
    oei: oei?.oei ?? null,
    fcr: fcr.fcr,
    mortality_rate: mort.cumulativeRatePct,
  }

  return {
    site_id: siteId,
    org_id: orgId,
    period: {
      from: periodFrom.toISOString(),
      to: periodTo.toISOString(),
      granularity: "period",
    },
    kpi_config: { version: comp.configVersion, params: comp.paramsOut },
    metrics: {
      ei_total: metric(values.ei_total, "kWh/kg", "ei_total", thresholds),
      ei_aeration: metric(values.ei_aeration, "kWh/kg", "ei_aeration", thresholds),
      oei: metric(values.oei, "index", "oei", thresholds),
      fcr: metric(values.fcr, "kg/kg", "fcr", thresholds),
      mortality_rate: metric(values.mortality_rate, "%", "mortality_rate", thresholds),
    },
    /**
     * 지표마다 **왜 산출되지 않았는가.** 응답이 이것을 함께 내려 주므로 화면들이 각자
     * 사유를 지어내지 않는다 — 전에는 KPI 카드가 넷에 같은 추측 한 줄("예: 생산량 변화
     * 부족")을 적고 있었다. 기존 응답 모양은 그대로 두고 칸만 더한 것이다.
     */
    unavailability: buildKpiUnavailability(comp, values),
    inputs: {
      total_power_kwh: ei.totalPowerKwh,
      aeration_power_kwh: ei.aerationPowerKwh,
      biomass_start_kg: ei.biomassStartKg,
      biomass_end_kg: ei.biomassEndKg,
      biomass_delta_kg: ei.biomassDeltaKg,
      included_reading_count: ei.includedReadingCount,
      excluded_reading_count: ei.excludedReadingCount,
    },
    provenance: {
      source_meter_ids: [...ei.sourceMeterIds],
      source_biomass_refs: [...ei.sourceBiomassRefs],
      kpi_snapshot_id: null,
    },
    mortality_daily: mort.daily.map((d) => ({
      date: d.date,
      dead_count: d.deadCount,
      daily_rate_pct: d.dailyRatePct,
    })),
    mortality_moving_avg: mort.movingAvg.map((p) => ({
      date: p.date,
      ma_rate_pct: p.maRatePct,
    })),
    generated_at: new Date().toISOString(),
  }
}
