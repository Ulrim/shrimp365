/**
 * ingestion — 게이트웨이 수집값의 표현 정규화 + 멱등 저장.
 * 원본: mrv-platform/apps/api/app/services/ingestion.py (ADR 0001)
 *
 * ★ KPI 산식이 아니다. 이 계층은 계측 원표현(적산 kWh / 순시 kW / 원값)을 readings.value
 * 의 저장 규약인 **구간 kWh(interval kWh)** 로 옮기고, 초기 quality_flag 를 로컬 판정만
 * 한다. 통계적 이상치 판정은 이 계층의 책임이 아니다.
 *
 * 결정론: 배치를 (ts, seq, meter_id) 오름차순으로 정렬한 뒤 처리하므로 입력 순서가
 * 달라도 결과가 같다. now()/난수를 쓰지 않는다.
 *
 * 배치 경계의 한계(ADR 0001 의 귀결): readings 에는 정규화값만 저장되므로 적산/순시의
 * **원 카운터**를 되살릴 수 없다. 그래서 배치 경계에서는
 *   - cumulative: 배치 안에 직전값이 없고 과거 이력만 있으면 구간값을 낼 수 없다 →
 *     'suspect'(보수적 배제). 이력조차 없으면 최초 기준선이라 'bad'.
 *   - instant: 배치 안에 직전 원 kW 가 없으면 사다리꼴 적분이 불가능하다 → 'bad'
 *     (없는 값을 보간해 채우지 않는다).
 * 배치 안에서 원값이 이어지는 구간은 정확히 변환한다.
 */

import { T, fetchAll, type MrvDb } from "./db"

/** 인식하는 계측 원표현. 목록에 없으면 그 건은 거부된다(조용히 저장하지 않는다). */
export const RECOGNIZED_KINDS = new Set([
  "cumulative_kwh",
  "instant_kw",
  "interval_kwh",
  "do_mg_l",
])

/** 순시 kW 사다리꼴 적분을 허용하는 최대 간격. 이보다 벌어지면 신뢰할 수 없다. */
const INSTANT_MAX_GAP_HOURS = 2.0
/** DO 물리 상한(mg/L). 넘으면 센서 이상으로 보고 'suspect'. */
const DO_PLAUSIBLE_MAX = 20.0

const SCOPE_REJECT_REASON = "unknown meter_id or not in the authorized site scope"

/**
 * 계측값의 출처. `mrv_readings.source` 의 CHECK 와 같은 집합이며, `mrv_feed_logs.source`
 * 선례와 같은 모양이다.
 *
 * **왜 필요한가.** 전력은 수기 입력으로 들어온다. 수기로 적은 kWh 와 게이트웨이가 올린
 * kWh 가 DB 에서 구분되지 않으면, 심사 때 "이 기준선의 전력 근거가 계측기 값인가 사람이
 * 적은 값인가" 에 답할 수 없다. 둘 다 유효한 증빙이지만 **같은 증빙은 아니다.**
 */
export type ReadingSource = "device" | "manual" | "csv"

export type RawReading = {
  /** 배치 안 원 위치. rejected[] 가 이 값으로 어느 건이 거부됐는지 가리킨다. */
  index: number
  meterId: string
  ts: Date
  value: number
  readingKind: string
  seq: number | null
}

type NormalizedReading = {
  meterId: string
  ts: Date
  value: number
  qualityFlag: string
}

type PriorState = { ts: Date; value: number }

export type ProcessResult = {
  accepted: number
  deduped: number
  rejected: { index: number; reason: string }[]
  /**
   * 저장된 건들의 quality_flag 분포. 수기 입력에 필요하다 — 적산 지침은 한 배치에 직전
   * 값이 없으면 구간값을 낼 수 없어 'suspect' 로 들어가고(ADR 0001), 그 건은 EI 산입
   * 목록(`included_quality_flags`)에서 빠진다. "20건 올렸는데 왜 EI 가 안 변하나" 를
   * 운영자가 화면에서 바로 알 수 있어야 한다.
   *
   * 새로 저장된 건만 센다(deduped·rejected 는 들어가지 않는다).
   */
  quality: { ok: number; suspect: number; bad: number }
}

/** (meter_id, ts) 멱등 비교용 정규 키. 표현이 달라도 같은 시각이면 같은 키가 된다. */
function utcKey(ts: Date): string {
  return ts.toISOString()
}

/** 멱등 판정용 복합 키. 계측기와 시각을 한 문자열로 접합한다. */
function dedupeKey(meterId: string, ts: Date): string {
  return meterId + "@" + utcKey(ts)
}

/**
 * 원 계측값 배치를 구간 kWh(+원값)로 정규화한다. 순수·결정론(DB 접근 없음).
 * meter 별로 배치 안 직전 원값을 추적하며 변환한다.
 */
export function normalizeReadings(
  raws: readonly RawReading[],
  priorByMeter: Map<string, PriorState> = new Map(),
): NormalizedReading[] {
  const ordered = [...raws].sort((a, b) => {
    const t = a.ts.getTime() - b.ts.getTime()
    if (t !== 0) return t
    const s = (a.seq ?? 0) - (b.seq ?? 0)
    if (s !== 0) return s
    return a.meterId < b.meterId ? -1 : a.meterId > b.meterId ? 1 : 0
  })

  const state = new Map<string, { ts: Date; value: number }>()
  const out: NormalizedReading[] = []

  for (const r of ordered) {
    const mid = r.meterId
    const prev = state.get(mid)
    const hasHistory = priorByMeter.has(mid)

    if (r.readingKind === "interval_kwh") {
      // 이미 구간값이다. 음수만 걸러 낸다(전력 사용량은 음수일 수 없다).
      out.push({
        meterId: mid,
        ts: r.ts,
        value: r.value,
        qualityFlag: r.value >= 0.0 ? "ok" : "suspect",
      })
    } else if (r.readingKind === "cumulative_kwh") {
      if (prev !== undefined) {
        const delta = r.value - prev.value
        // 적산값이 줄었다 = 계측기 교체나 롤오버. 구간값으로 쓸 수 없다.
        out.push(
          delta < 0.0
            ? { meterId: mid, ts: r.ts, value: r.value, qualityFlag: "suspect" }
            : { meterId: mid, ts: r.ts, value: delta, qualityFlag: "ok" },
        )
      } else if (hasHistory) {
        out.push({ meterId: mid, ts: r.ts, value: r.value, qualityFlag: "suspect" })
      } else {
        out.push({ meterId: mid, ts: r.ts, value: 0.0, qualityFlag: "bad" })
      }
      state.set(mid, { ts: r.ts, value: r.value })
    } else if (r.readingKind === "instant_kw") {
      if (prev !== undefined) {
        const dtH = (r.ts.getTime() - prev.ts.getTime()) / 3_600_000
        if (dtH <= 0.0 || dtH > INSTANT_MAX_GAP_HOURS) {
          out.push({ meterId: mid, ts: r.ts, value: 0.0, qualityFlag: "bad" })
        } else {
          // 사다리꼴 적분: 두 순시값의 평균 × 경과 시간.
          out.push({
            meterId: mid,
            ts: r.ts,
            value: ((prev.value + r.value) / 2.0) * dtH,
            qualityFlag: "ok",
          })
        }
      } else {
        out.push({ meterId: mid, ts: r.ts, value: 0.0, qualityFlag: "bad" })
      }
      state.set(mid, { ts: r.ts, value: r.value })
    } else if (r.readingKind === "do_mg_l") {
      out.push({
        meterId: mid,
        ts: r.ts,
        value: r.value,
        qualityFlag: r.value >= 0.0 && r.value <= DO_PLAUSIBLE_MAX ? "ok" : "suspect",
      })
    }
  }
  return out
}

/**
 * 스코프 검증 → 정규화 → 멱등 저장.
 *   - 계측기가 API 키 스코프(org_id, site_id) 밖이거나 미지 → 그 건만 거부(부분 거부).
 *   - reading_kind 미인식 → 그 건만 거부.
 *   - (meter_id, ts) 중복은 deduped 로 흡수한다 — 게이트웨이는 at-least-once 로
 *     재전송하므로 중복이 정상 동작이며, 오류로 취급하면 현장이 무한 재시도에 빠진다.
 */
export async function processBatch(
  db: MrvDb,
  params: {
    orgId: string
    siteId: string
    raws: readonly RawReading[]
    /** 저장할 출처. 게이트웨이 수집이 기본이고, 사람이 넣은 값은 호출부가 바꿔 준다. */
    source?: ReadingSource
  },
): Promise<ProcessResult> {
  const { orgId, siteId, raws, source = "device" } = params
  const result: ProcessResult = {
    accepted: 0,
    deduped: 0,
    rejected: [],
    quality: { ok: 0, suspect: 0, bad: 0 },
  }

  const meterIdsInBatch = Array.from(new Set(raws.map((r) => r.meterId)))
  const meterRows =
    meterIdsInBatch.length === 0
      ? []
      : await fetchAll<{ id: string; org_id: string; site_id: string }>((f, t) =>
          db
            .from(T.meters)
            .select("id, org_id, site_id")
            .in("id", meterIdsInBatch)
            .order("id", { ascending: true })
            .range(f, t),
        )
  const meterById = new Map(meterRows.map((m) => [m.id, m]))

  const valid: RawReading[] = []
  for (const r of raws) {
    const meter = meterById.get(r.meterId)
    // 요청 본문의 site_id 나 게이트웨이 id 는 믿지 않는다. 호출부가 넘긴 스코프
    // (게이트웨이는 API 키, 수기 입력은 세션 + 소유권 확인)가 진실이다.
    if (!meter || meter.org_id !== orgId || meter.site_id !== siteId) {
      result.rejected.push({ index: r.index, reason: SCOPE_REJECT_REASON })
      continue
    }
    if (!RECOGNIZED_KINDS.has(r.readingKind)) {
      result.rejected.push({
        index: r.index,
        reason: "unsupported reading_kind: " + r.readingKind,
      })
      continue
    }
    valid.push(r)
  }
  if (valid.length === 0) return result

  const meterIds = Array.from(new Set(valid.map((r) => r.meterId)))

  // meter 별 마지막 저장 시각/값(배치 경계 판정용).
  const priorByMeter = new Map<string, PriorState>()
  for (const mid of meterIds) {
    const { data, error } = await db
      .from(T.readings)
      .select("time, value")
      .eq("meter_id", mid)
      .order("time", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    const row = data as { time: string; value: number } | null
    if (row) priorByMeter.set(mid, { ts: new Date(row.time), value: row.value })
  }

  const normalized = normalizeReadings(valid, priorByMeter)

  // 배치 안 중복 접기.
  const unique = new Map<string, NormalizedReading>()
  for (const n of normalized) unique.set(dedupeKey(n.meterId, n.ts), n)
  const intrabatchDupes = normalized.length - unique.size
  if (unique.size === 0) {
    result.deduped = intrabatchDupes
    return result
  }

  // 이미 저장된 (meter_id, ts) 조회 — 재전송분을 걸러 낸다.
  //
  // 조회 범위를 이번 배치가 담은 시각 구간으로 좁힌다. 중복은 배치에 들어 있는 시각에서만
  // 생길 수 있으므로 그 밖을 읽을 이유가 없는데, 좁히지 않으면 해당 계측기의 **저장된 모든
  // 계측값**을 끌어오게 된다 — 몇 달 운영한 사이트에서는 수집 요청 한 번마다 수십만 행이다.
  // (원본도 전 구간을 읽었지만, 그쪽은 같은 프로세스의 DB 세션이라 비용이 드러나지 않았다.)
  const batchTimes = Array.from(unique.values()).map((n) => n.ts.getTime())
  const windowStart = new Date(Math.min(...batchTimes))
  const windowEnd = new Date(Math.max(...batchTimes))

  const existingRows = await fetchAll<{ meter_id: string; time: string }>((f, t) =>
    db
      .from(T.readings)
      .select("meter_id, time")
      .in("meter_id", meterIds)
      .gte("time", windowStart.toISOString())
      .lte("time", windowEnd.toISOString())
      .order("time", { ascending: true })
      .order("meter_id", { ascending: true })
      .range(f, t),
  )
  const existingKeys = new Set(
    existingRows.map((r) => dedupeKey(r.meter_id, new Date(r.time))),
  )

  const newRows: Record<string, unknown>[] = []
  let dedupedFromDb = 0
  for (const [key, n] of unique) {
    if (existingKeys.has(key)) {
      dedupedFromDb += 1
      continue
    }
    newRows.push({
      time: n.ts.toISOString(),
      meter_id: n.meterId,
      org_id: orgId,
      value: n.value,
      quality_flag: n.qualityFlag,
      source,
    })
    if (n.qualityFlag === "ok") result.quality.ok += 1
    else if (n.qualityFlag === "suspect") result.quality.suspect += 1
    else result.quality.bad += 1
  }

  if (newRows.length > 0) {
    // PK 충돌은 무시한다 — 같은 배치가 동시에 두 번 들어와도 정확히 한 번만 남는다.
    const { error } = await db
      .from(T.readings)
      .upsert(newRows, { onConflict: "time,meter_id", ignoreDuplicates: true })
    if (error) throw error
  }

  result.accepted = newRows.length
  result.deduped = dedupedFromDb + intrabatchDupes
  return result
}
