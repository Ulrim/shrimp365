// 웹에서 전력 회로 켜고 끄기·예약 — 웹 카드·명령 경로·장비 경로가 함께 쓰는 정의.
//
// 규칙의 모양은 장비 raspberry-pi/power_control.py(clean_rule)와 같다. 장비가 최종 검사를 하고,
// 여기서는 명백히 틀린 것만 걸러 명령함이 쓰레기로 차지 않게 한다.

export const CIRCUIT_ID_RE = /^[A-Za-z0-9_.-]{1,32}$/
/** 장비가 이 안에 가져가지 않은 명령은 버린다(늦게 도착한 '켜기' 를 막는다). */
export const COMMAND_TTL_MS = 2 * 60_000
/** 장비가 제어 상태를 1분마다 올린다. 이보다 오래되면 원격 제어가 끊긴 것으로 본다. */
export const CONTROL_STALE_MS = 3 * 60_000

export const POWER_MODES = ["manual", "timer", "cycle", "do"] as const
export type PowerMode = typeof POWER_MODES[number]

export interface PowerTimer { on: string; off: string; days: number[] }
export interface PowerRule {
  mode: PowerMode
  auto_off_min?: number
  do_guard_below?: number
  timers?: PowerTimer[]
  cycle?: { on_min: number; off_min: number; from: string; to: string; days: number[] }
  do?: { on_below: number; off_above: number; min_on_min: number }
}

/** power_control.py snapshot() 의 회로 하나. */
export interface CircuitControl {
  rule: PowerRule
  can: boolean
  confirm_off: boolean
  override: { on: boolean; until: string | null } | null
  scheduled: boolean | null
  do_forced: boolean
  error: string
  pending: boolean
}
export interface ControlSnapshot {
  circuits: Record<string, CircuitControl>
  clock_ok: boolean
  now: string
  do: number | null
}
export interface ControlStateRow {
  device_id: string
  control: ControlSnapshot
  updated_at: string
}

export type CommandStatus = "pending" | "sent" | "done" | "failed" | "expired"

export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/
export const MAX_TIMERS = 6

const isInt = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi
const isNum = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi
const isDays = (v: unknown) => Array.isArray(v) && v.length > 0 && v.length <= 7 && v.every(d => isInt(d, 0, 6))

/** 화면에서 만든 규칙을 검사한다. 오류 열쇠(사전 항목) 또는 "". */
export function checkRule(rule: unknown): string {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return "bad"
  const r = rule as Record<string, unknown>
  if (!POWER_MODES.includes(r.mode as PowerMode)) return "bad"
  if (r.auto_off_min !== undefined && !isInt(r.auto_off_min, 0, 1440)) return "autoOff"
  if (r.do_guard_below !== undefined && r.do_guard_below !== 0 && !isNum(r.do_guard_below, 0.5, 15)) return "guard"
  if (r.mode === "timer") {
    const ts = r.timers
    if (!Array.isArray(ts) || ts.length === 0 || ts.length > MAX_TIMERS) return "timers"
    for (const t of ts) {
      if (!t || typeof t !== "object") return "timers"
      const { on, off, days } = t as Record<string, unknown>
      if (typeof on !== "string" || typeof off !== "string" || !HHMM_RE.test(on) || !HHMM_RE.test(off) || on === off) return "time"
      if (!isDays(days)) return "days"
    }
  } else if (r.mode === "cycle") {
    const c = r.cycle as Record<string, unknown> | undefined
    if (!c || !isInt(c.on_min, 1, 720) || !isInt(c.off_min, 1, 720)) return "cycle"
    if (typeof c.from !== "string" || typeof c.to !== "string" || !HHMM_RE.test(c.from) || !HHMM_RE.test(c.to) || c.from === c.to) return "time"
    if (!isDays(c.days)) return "days"
  } else if (r.mode === "do") {
    const c = r.do as Record<string, unknown> | undefined
    if (!c || !isNum(c.on_below, 0.5, 15) || !isNum(c.off_above, 0.5, 20) || (c.off_above as number) <= (c.on_below as number)) return "doRange"
    if (!isInt(c.min_on_min, 0, 240)) return "doRange"
  }
  return ""
}
