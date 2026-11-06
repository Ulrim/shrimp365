// POST /api/field/device/judgements 본문 검증 — **순수 함수**.
//
// 라우트(route.ts)에서 떼어 둔 이유: DB 없이도 검증 규칙을 돌려 볼 수 있어야 한다.
// 이 저장소에는 service_role 키가 없어 라우트 전체를 실행해 볼 수 없다. 그래서 "어느 건이
// 왜 422 인가"는 여기서 끝내고, 라우트는 인증·저장·알림만 맡는다.
//
// 이 파일은 런타임 import 가 없다(타입만). node --experimental-strip-types 로 바로 불러
// 시험할 수 있게 하려는 것이다 — 경로 별칭(@/)이 있으면 node 가 못 푼다.
//
// 계약은 docs/plans/openfield-merge.md 4-2 그대로다:
//   risk·horizon_h·level 열거값, ts 파싱(시간대 필수), 배열 ≤ 200, evidence ≤ 5,
//   environment 는 숫자 키 9개만(그 외 버림). 어긋나면 422 와 어느 건이 왜인지.
import type { FieldRiskAction, FieldRiskEvidence, FieldRiskType } from "@/types"

export const MAX_JUDGEMENTS = 200
export const MAX_EVIDENCE = 5
/** actions 는 계약에 상한이 없다. 그래도 DB 를 부풀리지 못하게 조용히 자른다. */
export const MAX_ACTIONS = 20

const RISKS: readonly FieldRiskType[] = ["heat_dry", "rain_wet", "disease", "frost", "compound"]
const ENV_KEYS = [
  "t_air", "canopy_temp", "rh", "leaf_wetness", "solar_w", "rain", "soil_moisture", "soil_index", "wind_speed",
] as const

/** 검증을 통과해 DB 에 넣을 모양. tank_id·device_id 는 라우트가 붙인다. */
export interface ParsedJudgement {
  /** ISO(UTC). 같은 순간을 다른 표기로 보내도 유니크 키가 한 값으로 모이게 정규화한다. */
  ts: string
  risk: FieldRiskType
  horizon_h: 1 | 3
  level: 0 | 1 | 2 | 3
  level_name: string | null
  confidence: number | null
  model_version: string | null
  expected_onset: string | null
  evidence: FieldRiskEvidence[]
  actions: FieldRiskAction[]
  environment: Partial<Record<(typeof ENV_KEYS)[number], number>>
}

export type ParseResult =
  | { ok: true; agentVersion: string | null; judgements: ParsedJudgement[] }
  | { ok: false; status: 400 | 422; error: string; index?: number; field?: string }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

function shortString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const s = v.trim().slice(0, max)
  return s || null
}

function finiteNumber(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null
  return v
}

/** 시간대가 붙은 ISO 문자열만 받는다. 엣지 시각은 KST 로컬이라 시간대 없이 오면 서버(UTC)가
 *  9시간 어긋나게 읽는다 — 그 값은 저장하지 않고 돌려보내 업로더가 고치게 한다. */
const TZ_SUFFIX = /(Z|[+-]\d{2}:?\d{2})$/i
function parseIsoWithTz(v: unknown): string | null {
  if (typeof v !== "string" || !TZ_SUFFIX.test(v.trim())) return null
  const d = new Date(v.trim())
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function parseEvidence(v: unknown, index: number): { ok: true; value: FieldRiskEvidence[] } | { ok: false; error: string; field: string } {
  if (v === undefined || v === null) return { ok: true, value: [] }
  if (!Array.isArray(v)) return { ok: false, field: "evidence", error: `judgements[${index}].evidence 는 배열이어야 합니다.` }
  if (v.length > MAX_EVIDENCE) return { ok: false, field: "evidence", error: `judgements[${index}].evidence 는 최대 ${MAX_EVIDENCE}건입니다(${v.length}건).` }
  // 항목 하나의 모양이 어긋나면 그 항목만 버린다 — 업로더는 422 를 받으면 배치를 통째로
  // 버리므로(O1 보고), 422 는 계약이 명시한 규칙(열거값·ts·길이)에만 쓴다.
  const out: FieldRiskEvidence[] = []
  for (const e of v) {
    if (!isObject(e)) continue
    const feature = shortString(e.feature, 64)
    if (!feature) continue
    out.push({
      feature,
      label: shortString(e.label, 64),
      value: finiteNumber(e.value),
      contribution: finiteNumber(e.contribution),
    })
  }
  return { ok: true, value: out }
}

/** 조치는 모양이 어긋나도 그 건만 버린다 — 조치 하나 때문에 판단 전체를 거절하지 않는다.
 *  snake_case(설계서)와 camelCase(OFDF data.json) 둘 다 받는다. */
function parseActions(v: unknown): FieldRiskAction[] {
  if (!Array.isArray(v)) return []
  const out: FieldRiskAction[] = []
  for (const a of v.slice(0, MAX_ACTIONS)) {
    if (!isObject(a)) continue
    const device = shortString(a.device, 64)
    const command = shortString(a.command, 120)
    if (!device || !command) continue
    const layerRaw = finiteNumber(a.layer)
    const rejected = shortString(a.rejected_by ?? a.rejectedBy, 64)
    out.push({
      device,
      command,
      layer: layerRaw === null ? null : Math.trunc(layerRaw),
      reason: shortString(a.reason, 200),
      risk_type: shortString(a.risk_type ?? a.riskType, 32),
      executed: a.executed === true,
      rejected_by: rejected,
      advisory: a.advisory === true,
    })
  }
  return out
}

/** 숫자 키 9개만 남긴다. 다른 키·문자열·NaN 은 버린다(422 아님 — 계약이 "그 외 버림"). */
function parseEnvironment(v: unknown): ParsedJudgement["environment"] {
  const out: ParsedJudgement["environment"] = {}
  if (!isObject(v)) return out
  for (const k of ENV_KEYS) {
    const n = finiteNumber(v[k])
    if (n !== null) out[k] = n
  }
  return out
}

function parseOne(raw: unknown, index: number): { ok: true; value: ParsedJudgement } | { ok: false; error: string; field: string } {
  const bad = (field: string, error: string) => ({ ok: false as const, field, error })
  if (!isObject(raw)) return bad("", `judgements[${index}] 가 객체가 아닙니다.`)

  const ts = parseIsoWithTz(raw.ts)
  if (!ts) return bad("ts", `judgements[${index}].ts 는 시간대가 붙은 ISO8601 이어야 합니다(예 2026-10-15T06:00:00+09:00).`)

  const risk = typeof raw.risk === "string" && (RISKS as readonly string[]).includes(raw.risk) ? (raw.risk as FieldRiskType) : null
  if (!risk) return bad("risk", `judgements[${index}].risk 는 ${RISKS.join(" | ")} 중 하나여야 합니다.`)

  const horizon = raw.horizon_h
  if (horizon !== 1 && horizon !== 3) return bad("horizon_h", `judgements[${index}].horizon_h 는 1 또는 3 이어야 합니다.`)

  const level = raw.level
  if (level !== 0 && level !== 1 && level !== 2 && level !== 3) return bad("level", `judgements[${index}].level 은 0~3 정수여야 합니다.`)

  // confidence·expected_onset 은 계약의 검증 목록에 없는 참고값이다. 어긋나면 null 로 두고
  // 판단은 받는다 — 신뢰도 한 칸 때문에 배치가 버려지면 안 된다.
  const c = finiteNumber(raw.confidence)
  const confidence = c === null ? null : Math.min(1, Math.max(0, c))
  const expectedOnset = parseIsoWithTz(raw.expected_onset)

  const evidence = parseEvidence(raw.evidence, index)
  if (!evidence.ok) return evidence

  return {
    ok: true,
    value: {
      ts,
      risk,
      horizon_h: horizon,
      level,
      level_name: shortString(raw.level_name, 32),
      confidence,
      model_version: shortString(raw.model_version, 64),
      expected_onset: expectedOnset,
      evidence: evidence.value,
      actions: parseActions(raw.actions),
      environment: parseEnvironment(raw.environment),
    },
  }
}

/** 요청 본문 전체를 검증한다. 하나라도 어긋나면 그 건의 번호·칸·이유를 돌려준다. */
export function parseJudgementsBody(body: unknown): ParseResult {
  if (!isObject(body)) return { ok: false, status: 400, error: "요청 본문이 JSON 객체가 아닙니다." }
  const list = body.judgements
  if (!Array.isArray(list)) return { ok: false, status: 422, field: "judgements", error: "judgements 배열이 필요합니다." }
  if (list.length > MAX_JUDGEMENTS) {
    return { ok: false, status: 422, field: "judgements", error: `judgements 는 한 번에 최대 ${MAX_JUDGEMENTS}건입니다(${list.length}건).` }
  }
  const judgements: ParsedJudgement[] = []
  for (let i = 0; i < list.length; i++) {
    const r = parseOne(list[i], i)
    if (!r.ok) return { ok: false, status: 422, index: i, field: r.field, error: r.error }
    judgements.push(r.value)
  }
  return { ok: true, agentVersion: shortString(body.agent_version, 32), judgements }
}

/** sensor_devices.agent_version 은 CHECK 로 `N.N.N` 꼴만 받는다(sensor_agent_update.sql).
 *  OFDF 는 "ofdf-0.1.0" 처럼 접두를 붙여 보내므로 숫자 부분만 떼어 저장한다. 없으면 null. */
export function semverOf(agentVersion: string | null): string | null {
  if (!agentVersion) return null
  const m = /(\d{1,3}\.\d{1,3}\.\d{1,3})/.exec(agentVersion)
  return m ? m[1] : null
}

/** 알림 동기화에 쓸 "위험별 최신 판단" — 같은 risk 가 여러 건이면 ts 가 가장 늦은 것,
 *  ts 가 같으면(1·3시간 전망) level 이 높은 것. 저장용이 아니라 판단용이다. */
export function latestPerRisk<T extends { ts: string; risk: string; level: number }>(judgements: T[]): Map<string, T> {
  const out = new Map<string, T>()
  for (const j of judgements) {
    const cur = out.get(j.risk)
    if (!cur || j.ts > cur.ts || (j.ts === cur.ts && j.level > cur.level)) out.set(j.risk, j)
  }
  return out
}
