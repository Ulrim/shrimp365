// 관수 밸브·유량계(지그비 투야 스마트 워터밸브 + 유량계) — 서버 수신과 웹 카드가 함께 쓴다.
//
// 켤 때만 흐르는 관수 라인이다. 유량 0 은 고장이 아니라 '닫힘' 이라 경보를 만들지 않는다.
// supabase/migrations/irrigation_readings.sql · raspberry-pi/field_env.py read_irrigation.
import { strictNumber } from "@/lib/strict-number"

const ID_RE = /^[A-Za-z0-9_.-]{1,32}$/
const MAX_VALVES = 32

export interface IrrigationInput {
  id: string
  state: 0 | 1 | null
  flow: number | null          // L/min
  volume_today: number | null  // L (장비 현지 자정부터)
}

export interface IrrigationReading {
  valve_id: string
  state: number | null
  flow_lpm: number | null
  volume_today_l: number | null
  recorded_at: string
}

function num(raw: unknown, lo: number, hi: number): number | null {
  const v = strictNumber(raw)
  return v !== null && v >= lo && v <= hi ? v : null
}

/** 장비가 올린 irrigation 배열. 모양이 틀린 밸브는 버린다. */
export function parseIrrigationPayload(raw: unknown): IrrigationInput[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: IrrigationInput[] = []
  for (const item of raw.slice(0, MAX_VALVES)) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const id = typeof r.id === "string" ? r.id.trim().toUpperCase() : ""
    if (!ID_RE.test(id) || seen.has(id)) continue
    seen.add(id)
    const state = r.state === 1 || r.state === true ? 1 : r.state === 0 || r.state === false ? 0 : null
    const flow = num(r.flow, 0, 1000)
    const volume = num(r.volume_today, 0, 1_000_000)
    if (state === null && flow === null && volume === null) continue
    out.push({ id, state, flow, volume_today: volume })
  }
  return out
}

export interface ValveSummary {
  valve_id: string
  state: number | null
  flow_lpm: number | null
  volume_today_l: number | null
  at: number
  /** 이 밸브의 가장 최근 줄이 마지막 수신 묶음에 없다 — 끊김 */
  lost: boolean
}

/** 밸브마다 가장 최근 값, 오늘 사용량 합, 유량 추이(밸브 합, 오래된 것부터). rows 는 오래된 것부터. */
export function summarizeIrrigation(rows: IrrigationReading[]): {
  valves: ValveSummary[]
  newest: number | null
  series: { t: number; lpm: number }[]
} {
  const last = new Map<string, IrrigationReading>()
  const byTime = new Map<number, number>()
  for (const r of rows) {
    last.set(r.valve_id, r)
    const t = new Date(r.recorded_at).getTime()
    if (r.flow_lpm != null) byTime.set(t, (byTime.get(t) ?? 0) + r.flow_lpm)
  }
  const newest = rows.length ? Math.max(...rows.map(r => new Date(r.recorded_at).getTime())) : null
  const valves = [...last.values()]
    .map(r => {
      const at = new Date(r.recorded_at).getTime()
      return {
        valve_id: r.valve_id, state: r.state, flow_lpm: r.flow_lpm, volume_today_l: r.volume_today_l,
        at, lost: newest != null && newest - at > 30 * 60_000,
      }
    })
    .sort((a, b) => a.valve_id.localeCompare(b.valve_id))
  const series = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, lpm]) => ({ t, lpm }))
  return { valves, newest, series }
}
