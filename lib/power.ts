// 분전반 전력 회로 — 장비(raspberry-pi/field_env.py)가 올리는 회로 값의 규격 한 벌.
//
// 서버 수신(app/api/sensors/data)·웹 카드(components/power/power-card.tsx)가 함께 쓴다.
// 화면 아이콘·번역은 여기 두지 않는다 — 이 파일은 서버 라우트도 import 한다.
// 종류 목록·과열 기준은 장비(field_env.POWER_TYPES, limits.BREAKER_TEMP)·설계서
// docs/plans/farm365-main-panel.md 4-1·4-4 와 같은 값이다. 바꾸면 셋 다 바꾼다.

/** 부하 종류 — 회로마다 현장에서 하나를 고른다. */
export const POWER_TYPES = [
  "main", "aerator", "circulation_pump", "irrigation_pump", "heater",
  "ventilation", "cooling", "lighting", "uv", "dosing", "feeder", "other",
] as const
export type PowerType = (typeof POWER_TYPES)[number]

/** 차단기 본체 온도(℃). warn·crit 에서 알림, clear 아래로 내려와야 풀린다(경계에서 깜빡이지 않게). */
export const BREAKER_TEMP = { warn: 65, crit: 80, clear: 60 } as const

/** 알림 키 앞부분 — alerts.parameter = "차단기 과열 PUMP-01". 회로 이름이 키라 종류를 바꿔도 같은 알림이다. */
export const BREAKER_ALERT_PREFIX = "차단기 과열 "

/** 서버가 만드는 알림 문구(한국어 — 다른 수질 알림과 같은 규약). */
const TYPE_KO: Record<PowerType, string> = {
  main: "전체(인입)", aerator: "산소공급기·브로워", circulation_pump: "순환펌프",
  irrigation_pump: "관수펌프", heater: "히터·난방", ventilation: "환기팬", cooling: "냉방·제습",
  lighting: "조명·보광", uv: "UV 살균기", dosing: "양액 도징펌프", feeder: "자동급이기", other: "기타",
}

export interface PowerCircuitInput {
  id: string
  type: PowerType
  state: 0 | 1 | null
  power: number | null
  current: number | null
  voltage: number | null
  energy_today: number | null
  temp: number | null
}

/** 한 번에 받는 회로 수 상한 — 단상 분전반 한 면이면 넉넉하다. 그 이상은 잘라 DB 를 지킨다. */
const MAX_CIRCUITS = 24
const ID_RE = /^[A-Za-z0-9_.-]{1,32}$/

function num(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}

/** 장비가 보낸 power 배열을 검증한다. 모양이 틀린 회로는 버리고, 범위 밖 값은 null 로. */
export function parsePowerPayload(raw: unknown): PowerCircuitInput[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: PowerCircuitInput[] = []
  for (const item of raw.slice(0, MAX_CIRCUITS)) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const id = typeof r.id === "string" ? r.id.trim().toUpperCase() : ""
    if (!ID_RE.test(id) || seen.has(id)) continue
    seen.add(id)
    const type = (POWER_TYPES as readonly string[]).includes(r.type as string) ? (r.type as PowerType) : "other"
    const st = r.state === 1 || r.state === true ? 1 : r.state === 0 || r.state === false ? 0 : null
    out.push({
      id, type, state: st,
      power: num(r.power, 0, 100_000),            // W
      current: num(r.current, 0, 1_000),           // A
      voltage: num(r.voltage, 0, 500),             // V
      energy_today: num(r.energy_today, 0, 10_000), // kWh (장비 현지 자정부터)
      temp: num(r.temp, -40, 150),                 // ℃ 차단기 본체
    })
  }
  return out
}

export interface BreakerAlert {
  parameter: string
  value: number
  threshold: number
  type: "danger" | "warning"
  message: string
}

/** 차단기 과열 판정. alerts 는 새로 열거나 갱신할 것, recovered 는 닫을 알림 키. */
export function breakerAlerts(circuits: PowerCircuitInput[]): { alerts: BreakerAlert[]; recovered: string[] } {
  const alerts: BreakerAlert[] = []
  const recovered: string[] = []
  for (const c of circuits) {
    if (c.temp === null) continue                     // 온도를 안 보냈으면 판정도 복귀도 하지 않는다
    const parameter = BREAKER_ALERT_PREFIX + c.id
    const crit = c.temp >= BREAKER_TEMP.crit
    if (crit || c.temp >= BREAKER_TEMP.warn) {
      alerts.push({
        parameter,
        value: c.temp,
        threshold: crit ? BREAKER_TEMP.crit : BREAKER_TEMP.warn,
        type: crit ? "danger" : "warning",
        message: `${TYPE_KO[c.type]} 회로 차단기 ${c.temp.toFixed(0)}℃ — ${crit ? "과열, 부하를 줄이고 즉시 점검" : "온도 높음, 부하·단자 조임 점검"} (${c.id})`,
      })
    } else if (c.temp < BREAKER_TEMP.clear) {
      recovered.push(parameter)
    }
  }
  return { alerts, recovered }
}

// ── 웹 카드용 요약 ──────────────────────────────────────────────────────────

/** 차단기 온도 → "" · "warn" · "crit" (장비 field_env.breaker_level 과 같은 기준). */
export function breakerLevel(temp: number | null | undefined): "" | "warn" | "crit" {
  if (temp === null || temp === undefined) return ""
  if (temp >= BREAKER_TEMP.crit) return "crit"
  if (temp >= BREAKER_TEMP.warn) return "warn"
  return ""
}

export interface PowerRow {
  circuit_id: string
  circuit_type: string
  state: 0 | 1 | null
  power_w: number | null
  current_a: number | null
  energy_today_kwh: number | null
  device_temp: number | null
  recorded_at: string
}

export interface PowerSummary {
  /** 회로별 마지막 줄 — 인입(main) 먼저, 나머지는 이름순 */
  circuits: PowerRow[]
  /** 지금 전체 전력(W). 인입 계측이 있으면 그것, 없으면 분기 합(partial) */
  totalW: number | null
  partial: boolean
  /** 오늘 사용량(kWh) — 같은 규칙 */
  todayKwh: number | null
  /** 업로드 시각별 전체 전력 — 스파크라인 */
  series: { t: string; w: number }[]
  /** 가장 최근 수신 시각(ms) */
  newest: number | null
}

/** rows 는 오래된 것부터(getPowerReadings 순서). */
export function summarizePower(rows: PowerRow[]): PowerSummary {
  const latest = new Map<string, PowerRow>()
  const byTime = new Map<string, PowerRow[]>()
  for (const r of rows) {
    latest.set(r.circuit_id, r)
    const g = byTime.get(r.recorded_at)
    if (g) g.push(r)
    else byTime.set(r.recorded_at, [r])
  }
  const total = (group: PowerRow[], field: "power_w" | "energy_today_kwh") => {
    const main = group.filter(r => r.circuit_type === "main" && r[field] !== null)
    if (main.length) return { v: main.reduce((a, r) => a + (r[field] as number), 0), partial: false }
    const branch = group.filter(r => r.circuit_type !== "main" && r[field] !== null)
    if (branch.length) return { v: branch.reduce((a, r) => a + (r[field] as number), 0), partial: true }
    return null
  }
  const series: { t: string; w: number }[] = []
  for (const [t, group] of byTime) {
    const s = total(group, "power_w")
    if (s) series.push({ t, w: s.v })
  }
  const circuits = Array.from(latest.values()).sort((a, b) =>
    a.circuit_type === "main" ? -1 : b.circuit_type === "main" ? 1 : a.circuit_id.localeCompare(b.circuit_id))
  const now = total(circuits, "power_w")
  const today = total(circuits, "energy_today_kwh")
  const newest = rows.length ? Math.max(...rows.map(r => new Date(r.recorded_at).getTime())) : null
  return {
    circuits,
    totalW: now ? now.v : null,
    partial: now ? now.partial : false,
    todayKwh: today ? today.v : null,
    series,
    newest,
  }
}
