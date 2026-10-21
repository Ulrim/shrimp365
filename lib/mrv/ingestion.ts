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
import type { MeasurementBasis } from "./measurement-basis"
import {
  isMissingMeasurementBasisColumnError,
  noteMissingMeasurementBasisColumn,
  shouldSendMeasurementBasisColumn,
} from "./measurement-basis-column"

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
 *
 * ★ 이 열은 「누가 넣었는가」만 답한다. 「어떻게 얻었는가」(계량기 실측인가 산식으로
 *   계산한 값인가)는 직교하는 사실이고 `measurement_basis` 가 답한다 — 계산값도 CSV 로
 *   들어오므로 `source` 로는 영원히 가려낼 수 없다(lib/mrv/measurement-basis.ts).
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
  /**
   * 이 건의 자료유형(`mrv_readings.measurement_basis`) — **어떻게 얻은 값인가.**
   *
   * 적지 않으면 `processBatch` 의 배치 기본값이 쓰이고, 그것도 없으면 null(미기재)로
   * 저장된다. **건별로 받는 이유**: 한 기록지에 계량기 지침과 계산값이 섞여 들어오는
   * 일이 실제로 있다(계량기가 없는 설비만 산식으로 메운 표). **배치 기본값도 두는
   * 이유**: 한 파일이 통째로 계산값인 경우가 더 흔하고, 그때 모든 줄에 같은 값을 적게
   * 하면 사람이 한 줄만 빠뜨린다.
   *
   * `source`(device/manual/csv)와 직교한다 — 그쪽은 「누가 넣었는가」다.
   */
  measurementBasis?: MeasurementBasis | null
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
    /**
     * 배치 기본 자료유형. 건별로 `RawReading.measurementBasis` 가 적혀 있으면 **그것이
     * 이기고**, 적히지 않은 건에 이 값이 쓰인다. 둘 다 없으면 null(미기재)로 저장된다 —
     * 임의로 'metered' 를 채우지 않는다(없는 사실을 만들어 내는 것이다).
     */
    measurementBasis?: MeasurementBasis | null
  },
): Promise<ProcessResult> {
  const {
    orgId,
    siteId,
    raws,
    source = "device",
    measurementBasis: batchBasis = null,
  } = params
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

  /**
   * (계측기, 시각) → 자료유형. `normalizeReadings` 는 **차분검증된 함수라 손대지 않았고**,
   * 그래서 정규화 결과에는 이 값이 실려 오지 않는다. 정규화가 시각과 계측기를 바꾸지
   * 않으므로(값과 플래그만 정한다) 같은 키로 다시 붙일 수 있다.
   *
   * 같은 (계측기, 시각) 이 한 배치에 두 번 들어오면 **뒤에 적힌 자료유형이 남는다.**
   * 값 쪽 중복 접기와 같은 방향이다(아래 `unique` 가 뒤엣것으로 덮는다). 애초에 그런
   * 중복은 기록지 파서가 보내기 전에 오류로 막고(lib/mrv/csv-records.ts), 수기 폼은 한
   * 건만 보낸다 — 같은 시각에 자료유형이 둘로 적힌 배치는 입력 오류다.
   */
  const basisByKey = new Map<string, MeasurementBasis | null>()
  for (const r of valid) {
    basisByKey.set(dedupeKey(r.meterId, r.ts), r.measurementBasis ?? batchBasis)
  }

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

  /**
   * 이번 insert 에 `measurement_basis` 칸을 넣는가.
   *
   * 그 열은 마이그레이션이 추가하고 **실행은 사람 몫**이라, 배포가 SQL 보다 먼저 올라가는
   * 창이 반드시 있다. 그 창에서 이 칸이 섞인 insert 는 PostgREST 가 거절하고, 아래
   * `throw error` 가 그것을 500 으로 바꾼다 — 그러면 **이 경로를 지나는 모든 계측값
   * 쓰기**(장비 키·세션 수기 입력·기록지 CSV, 전력뿐 아니라 DO·수질까지)가 통째로 막힌다.
   * 자료유형은 계측값에 **대한** 메타데이터이므로, 그것을 적을 칸이 없는 것이 증빙을
   * 받지 못할 이유가 되어서는 안 된다. 판정·로그·기억은 ./measurement-basis-column.ts 에
   * 모아 두었고(같은 사고의 선례: 커밋 632b2a6), 아래는 그 판정을 쓰는 자리다.
   */
  const sendBasis = shouldSendMeasurementBasisColumn()

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
      // null 이면 「미기재」로 저장된다. 그 뜻은 마이그레이션과
      // lib/mrv/measurement-basis.ts 에 적혀 있다 — 실측으로 세지 않는다.
      ...(sendBasis ? { measurement_basis: basisByKey.get(key) ?? null } : {}),
    })
    if (n.qualityFlag === "ok") result.quality.ok += 1
    else if (n.qualityFlag === "suspect") result.quality.suspect += 1
    else result.quality.bad += 1
  }

  if (newRows.length > 0) {
    // PK 충돌은 무시한다 — 같은 배치가 동시에 두 번 들어와도 정확히 한 번만 남는다.
    const insert = (rows: Record<string, unknown>[]) =>
      db.from(T.readings).upsert(rows, { onConflict: "time,meter_id", ignoreDuplicates: true })

    const { error } = await insert(newRows)
    if (error) {
      // 이 열이 없어서 거절된 것이 **확인되면** 그 칸만 빼고 한 번 더 보낸다. 첫 요청은
      // 통째로 거절됐으므로(부분 삽입이 아니다) 같은 배치를 다시 보내도 중복은 없고,
      // 멱등 보호(onConflict ignoreDuplicates)도 그대로다.
      if (!sendBasis || !isMissingMeasurementBasisColumnError(error)) throw error
      noteMissingMeasurementBasisColumn("mrv_readings insert")
      const withoutBasis = newRows.map((row) => {
        const copy = { ...row }
        delete copy.measurement_basis
        return copy
      })
      const { error: retryError } = await insert(withoutBasis)
      if (retryError) throw retryError
    }
  }

  result.accepted = newRows.length
  result.deduped = dedupedFromDb + intrabatchDupes
  return result
}
