/**
 * 임계치 배치 평가 — 원본 `apps/api/app/services/alert_jobs.py` 의 이식본.
 *
 * 이 모듈이 없으면 `mrv_alerts` 에 행을 넣는 코드가 어디에도 없어, 알림 목록이 영원히
 * 비어 있는다. 화면과 API 는 전부 이식돼 있었지만 **알림을 만들어 내는 쪽**이 원본에서는
 * FastAPI 라우터가 아니라 별도 워커 프로세스(`worker.py`)에 있었기 때문이다.
 *
 * ★ 산식 경계(원본 Rule 1 그대로): 판정 임계값과 신호등 판정 함수는 KPI 엔진에서 가져와
 *   비교만 한다. 이 모듈이 정하는 것은 "언제 무엇을 비교하는가"(배선)뿐이다.
 *   mortality_spike 의 "당일 vs 최근 N일 평균" 비교도 이미 산출된 `MortalityResult.daily`
 *   값의 평균·부등호일 뿐 새 산식이 아니다.
 *
 * 3종 트리거:
 *   - do_low          — 평가 윈도 안 최신 유효('ok') DO 샘플 < alerting.do_low_mg_l
 *   - mortality_spike — 당일 dead_count > ratio × (직전 window_days 평균)
 *                       **그리고** 당일 dead_count >= min_count
 *   - kpi_red         — alerting.kpi_red_metrics 각각을 classifyMetricStatus 로 판정해 'red'
 *
 * 중복 억제: 같은 (site_id, type) 에 이미 status='open' 인 알림이 있으면 만들지 않는다.
 *   kpi_red 는 지표 단위가 아니라 **type 단위** dedup 이므로, 여러 지표가 동시에 red 여도
 *   알림은 하나다(원본과 같다 — 첫 red 지표가 알림을 차지한다).
 * 구독 스위치: site.alert_enabled_types[type] === false 인 종류는 **생성 자체를** 막는다
 *   (조회에서 걸러 내는 것이 아니다).
 *
 * ── 원본과 의도적으로 다른 세 가지 ──
 *
 * 1. org 순회를 하지 않는다. 원본은 워커 세션에 org 컨텍스트가 없으면 RLS 때문에
 *    `select(Site)` 가 조용히 0행이 되는 문제가 있어 organizations 를 열거해 org 마다
 *    컨텍스트를 걸었다. 이식본은 service-role 로 붙어 RLS 를 우회하므로 그 우회로가
 *    필요 없다 — 사이트를 곧바로 읽는다. 순회 대상 집합은 같다.
 * 2. DO 최신 샘플의 동시각 동점을 meter_id 로 깬다. 원본은 시각 내림차순 하나뿐이라
 *    같은 시각에 두 계측기가 값을 냈을 때 어느 쪽이 뽑힐지 정해져 있지 않았다.
 * 3. kpi_red_metrics 에 모르는 지표명이 있으면 명시적으로 거부한다. 원본은 KeyError 로
 *    죽었고, 이식본에서 그냥 두면 direction 이 undefined 가 되어 **조용히 잘못 판정**한다.
 *
 * 트랜잭션: 원본은 사이트를 다 돌고 한 번 커밋했다. 여기서는 알림마다 즉시 삽입된다.
 * 중간에 실패해도 그때까지 만든 알림은 남고, dedup 이 있어 다시 돌려도 중복되지 않는다.
 */

import {
  DEFAULT_ALERTING_CONFIG,
  METRIC_DIRECTIONS,
  KpiValueError,
  alertingConfigFromParams,
  classifyMetricStatus,
  type AlertingConfig,
  type ParamsJson,
} from "./kpi"
import { computeSiteKpiResults } from "./kpi-service"
import { T, fetchAll, newId, type MrvDb } from "./db"

/** alert type → 표시 심각도. 도메인 판정이 아니라 UI 라벨링 편의다(판정은 위 3종 트리거). */
const SEVERITY_BY_TYPE: Record<AlertJobType, string> = {
  do_low: "critical",
  mortality_spike: "warning",
  kpi_red: "critical",
}

export type AlertJobType = "do_low" | "mortality_spike" | "kpi_red"

type SiteRow = {
  id: string
  org_id: string
  alert_enabled_types: Record<string, boolean> | null
}

export type AlertJobOptions = {
  /** 배치 실행 시각. 산식 입력이 아니라 스케줄 메타데이터다(기본 현재 UTC). */
  evaluatedAt?: Date
  doLowLookbackHours?: number
  mortalityWindowDays?: number
  kpiPeriodDays?: number
}

export type CreatedAlert = {
  id: string
  siteId: string
  orgId: string
  type: AlertJobType
  severity: string
  payload: Record<string, unknown>
}

/** 가장 최근 effective_from 의 kpi_config.alerting 을 활성 설정으로 쓴다(kpi-service 와 같은 규약). */
async function loadActiveAlertingConfig(db: MrvDb): Promise<AlertingConfig> {
  const { data, error } = await db
    .from(T.kpiConfig)
    .select("params_json")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const row = data as { params_json: ParamsJson | null } | null
  if (!row) return DEFAULT_ALERTING_CONFIG
  return alertingConfigFromParams(row.params_json ?? {})
}

function subscriptionEnabled(site: SiteRow, alertType: AlertJobType): boolean {
  const enabled = site.alert_enabled_types ?? {}
  // 명시적으로 false 인 것만 막는다. 설정이 없으면 켜진 것으로 본다(원본과 같다).
  return enabled[alertType] !== false
}

async function hasOpenDuplicate(
  db: MrvDb,
  siteId: string,
  alertType: AlertJobType,
): Promise<boolean> {
  const { data, error } = await db
    .from(T.alerts)
    .select("id")
    .eq("site_id", siteId)
    .eq("type", alertType)
    .eq("status", "open")
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data !== null
}

/** 구독 스위치 → 중복 억제 → 삽입 순으로 게이트한다. 막히면 null. */
async function tryCreateAlert(
  db: MrvDb,
  site: SiteRow,
  alertType: AlertJobType,
  payload: Record<string, unknown>,
): Promise<CreatedAlert | null> {
  if (!subscriptionEnabled(site, alertType)) return null
  if (await hasOpenDuplicate(db, site.id, alertType)) return null

  const row = {
    id: newId("alert"),
    site_id: site.id,
    org_id: site.org_id,
    type: alertType,
    severity: SEVERITY_BY_TYPE[alertType],
    payload_json: payload,
    status: "open",
  }
  const { error } = await db.from(T.alerts).insert(row)
  if (error) throw error

  return {
    id: row.id,
    siteId: site.id,
    orgId: site.org_id,
    type: alertType,
    severity: row.severity,
    payload,
  }
}

/** 날짜(UTC) 문자열 'YYYY-MM-DD'. MortalityResult.daily 의 date 와 같은 축이어야 한다. */
function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** UTC 날짜 문자열에서 days 일을 뺀다(시간대 보정 없이 UTC 자정 기준). */
function shiftUtcDate(dateStr: string, days: number): string {
  const t = Date.parse(`${dateStr}T00:00:00Z`)
  return utcDateString(new Date(t - days * 86_400_000))
}

async function evaluateDoLow(
  db: MrvDb,
  site: SiteRow,
  evaluatedAt: Date,
  lookbackHours: number,
  cfg: AlertingConfig,
): Promise<CreatedAlert | null> {
  const doMeters = await fetchAll<{ id: string }>((from, to) =>
    db
      .from(T.meters)
      .select("id")
      .eq("site_id", site.id)
      .eq("type", "do")
      .order("id")
      .range(from, to),
  )
  if (doMeters.length === 0) return null

  const windowStart = new Date(evaluatedAt.getTime() - lookbackHours * 3_600_000)
  const { data, error } = await db
    .from(T.readings)
    .select("time, value, meter_id")
    .in(
      "meter_id",
      doMeters.map((m) => m.id),
    )
    .eq("quality_flag", "ok")
    .gte("time", windowStart.toISOString())
    .lte("time", evaluatedAt.toISOString())
    .order("time", { ascending: false })
    // 같은 시각에 두 계측기가 값을 냈을 때 어느 쪽을 볼지 정해 둔다(원본은 미정이었다).
    .order("meter_id", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error

  const reading = data as { time: string; value: number; meter_id: string } | null
  if (!reading) return null
  if (reading.value >= cfg.doLowMgL) return null

  return tryCreateAlert(db, site, "do_low", {
    metric: "do",
    value: reading.value,
    threshold: cfg.doLowMgL,
    meter_id: reading.meter_id,
    ts: new Date(reading.time).toISOString(),
  })
}

async function evaluateMortalitySpike(
  db: MrvDb,
  site: SiteRow,
  evaluatedAt: Date,
  windowDays: number,
  cfg: AlertingConfig,
): Promise<CreatedAlert | null> {
  const periodFrom = new Date(evaluatedAt.getTime() - (windowDays + 1) * 86_400_000)
  const comp = await computeSiteKpiResults(db, site.id, periodFrom, evaluatedAt)
  const daily = comp.mortality.daily
  if (daily.length === 0) return null

  const today = utcDateString(evaluatedAt)
  const byDate = new Map(daily.map((d) => [d.date, d.deadCount]))
  const deadToday = byDate.get(today) ?? 0

  let priorSum = 0
  for (let k = 1; k <= windowDays; k += 1) {
    priorSum += byDate.get(shiftUtcDate(today, k)) ?? 0
  }
  const maDeadCount = windowDays > 0 ? priorSum / windowDays : 0

  if (deadToday < cfg.mortalitySpikeMinCount) return null
  if (deadToday <= cfg.mortalitySpikeRatio * maDeadCount) return null

  return tryCreateAlert(db, site, "mortality_spike", {
    metric: "mortality",
    date: today,
    dead_count_today: deadToday,
    moving_avg_dead_count: maDeadCount,
    ratio_threshold: cfg.mortalitySpikeRatio,
    min_count_threshold: cfg.mortalitySpikeMinCount,
  })
}

async function evaluateKpiRed(
  db: MrvDb,
  site: SiteRow,
  evaluatedAt: Date,
  periodDays: number,
  cfg: AlertingConfig,
): Promise<CreatedAlert[]> {
  const periodFrom = new Date(evaluatedAt.getTime() - periodDays * 86_400_000)
  const comp = await computeSiteKpiResults(db, site.id, periodFrom, evaluatedAt)

  const valueByMetric: Record<string, number | null> = {
    ei_total: comp.ei.eiTotal,
    ei_aeration: comp.ei.eiAeration,
    fcr: comp.fcr.fcr,
    oei: comp.oei !== null ? comp.oei.oei : null,
    mortality_rate: comp.mortality.cumulativeRatePct,
  }

  const created: CreatedAlert[] = []
  for (const metric of cfg.kpiRedMetrics) {
    const direction = METRIC_DIRECTIONS[metric]
    const thresholds = cfg.thresholds[metric as keyof typeof cfg.thresholds]
    // 설정에 모르는 지표명이 적혀 있으면 여기서 멈춘다. 그냥 두면 direction 이 undefined
    // 인 채로 판정이 돌아 red 여부가 조용히 뒤집힌다 — 알림은 틀리면 안 되는 자리다.
    if (direction === undefined || thresholds === undefined) {
      throw new KpiValueError(
        `alerting.kpi_red_metrics contains unknown metric '${metric}'; ` +
          `expected one of ${Object.keys(METRIC_DIRECTIONS).join(", ")}`,
      )
    }

    const value = valueByMetric[metric] ?? null
    if (classifyMetricStatus(value, direction, thresholds) !== "red") continue

    const alert = await tryCreateAlert(db, site, "kpi_red", {
      metric,
      value,
      threshold: thresholds.redThreshold,
      config_version: comp.configVersion,
    })
    // dedup 은 type 단위다. 하나가 만들어졌으면 나머지 red 지표는 어차피 막힌다.
    if (alert !== null) created.push(alert)
  }
  return created
}

/**
 * 3종 트리거를 모든 사이트에 대해 한 번 평가한다.
 *
 * 사이트 하나에서 나는 오류가 나머지 사이트의 평가를 통째로 날리지 않게, 사이트 단위로
 * 잡아 `failures` 에 모아 돌려준다 — 한 사이트의 설정 오류로 다른 양식장의 위험 알림이
 * 함께 사라지면 안 된다. 호출부(스케줄 라우트)가 이 목록을 로그로 남긴다.
 */
export async function jobEvaluateAlerts(
  db: MrvDb,
  options: AlertJobOptions = {},
): Promise<{ created: CreatedAlert[]; evaluatedSites: number; failures: string[] }> {
  const evaluatedAt = options.evaluatedAt ?? new Date()
  const doLowLookbackHours = options.doLowLookbackHours ?? 24
  const mortalityWindowDays = options.mortalityWindowDays ?? 7
  const kpiPeriodDays = options.kpiPeriodDays ?? 30

  const cfg = await loadActiveAlertingConfig(db)

  const sites = await fetchAll<SiteRow>((from, to) =>
    db
      .from(T.sites)
      .select("id, org_id, alert_enabled_types")
      .order("id")
      .range(from, to),
  )

  const created: CreatedAlert[] = []
  const failures: string[] = []

  for (const site of sites) {
    try {
      const doAlert = await evaluateDoLow(db, site, evaluatedAt, doLowLookbackHours, cfg)
      if (doAlert) created.push(doAlert)

      const mortAlert = await evaluateMortalitySpike(
        db,
        site,
        evaluatedAt,
        mortalityWindowDays,
        cfg,
      )
      if (mortAlert) created.push(mortAlert)

      created.push(...(await evaluateKpiRed(db, site, evaluatedAt, kpiPeriodDays, cfg)))
    } catch (err) {
      failures.push(`${site.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { created, evaluatedSites: sites.length, failures }
}
