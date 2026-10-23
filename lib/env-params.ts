// 환경·기상 측정 항목 12개의 메타 한 벌 — 스마트팜 장비가 수질 값과 같은 줄로 올린다.
//
// 장비(raspberry-pi/field_env.py)·서버 수신(app/api/sensors/data ENV_RANGE)·DB
// (supabase/migrations/environment_readings.sql)가 같은 이름을 쓴다. 항목 이름(라벨)은
// 사전(`useAgriT().environment.param[key]`)에 있고 여기엔 없다 — agri-params.ts 와 같은 규약.
//
// 판정 색(정상/주의/위험)은 없다. 작물·생육 단계마다 적정값이 달라 값만 보여 준다.
import { Thermometer, Droplets, Sprout, Layers, Wind, Navigation, CloudRain, CloudDrizzle, Sun, SunDim, Gauge } from "lucide-react"
import type { IconComponent } from "@/types"

export type EnvParamKey =
  | "air_temp" | "humidity" | "soil_moisture" | "soil_temp"
  | "wind_speed" | "wind_gust" | "wind_dir" | "rain_day" | "rain_rate"
  | "solar" | "uv_index" | "pressure"

export interface EnvParam {
  key: EnvParamKey
  unit: string
  digits: number
  /** 서버가 받는 값 범위 [최소, 최대]. 밖이면 버린다(app/api/sensors/data).
   *  DB CHECK(environment_readings.sql wqr_env_range)도 같은 값이다 — 바꾸면 둘 다 바꾼다. */
  range: readonly [number, number]
  /** 스파크라인 색(hex). 상태색(emerald/amber/red)과 겹치지 않게 골랐다. */
  color: string
  icon: IconComponent
}

/** 순서가 곧 카드의 칸 순서다 — 온습도·토양(지그비) → 기상(WS90 등). */
export const ENV_PARAMS: readonly EnvParam[] = [
  { key: "air_temp",      unit: "°C",   digits: 1, range: [-50, 70], color: "#f97316", icon: Thermometer },
  { key: "humidity",      unit: "%",    digits: 1, range: [0, 100], color: "#0ea5e9", icon: Droplets },
  { key: "soil_moisture", unit: "%",    digits: 1, range: [0, 100], color: "#a16207", icon: Sprout },
  { key: "soil_temp",     unit: "°C",   digits: 1, range: [-30, 70], color: "#b45309", icon: Layers },
  { key: "wind_speed",    unit: "m/s",  digits: 1, range: [0, 80], color: "#14b8a6", icon: Wind },
  { key: "wind_gust",     unit: "m/s",  digits: 1, range: [0, 100], color: "#0d9488", icon: Wind },
  { key: "wind_dir",      unit: "°",    digits: 0, range: [0, 360], color: "#64748b", icon: Navigation },
  { key: "rain_day",      unit: "mm",   digits: 1, range: [0, 1000], color: "#3b82f6", icon: CloudRain },
  { key: "rain_rate",     unit: "mm/h", digits: 1, range: [0, 500], color: "#6366f1", icon: CloudDrizzle },
  { key: "solar",         unit: "W/m²", digits: 0, range: [0, 2000], color: "#eab308", icon: Sun },
  { key: "uv_index",      unit: "",     digits: 1, range: [0, 20], color: "#a855f7", icon: SunDim },
  { key: "pressure",      unit: "hPa",  digits: 1, range: [800, 1100], color: "#8b5cf6", icon: Gauge },
] as const

export const ENV_KEYS: readonly EnvParamKey[] = ENV_PARAMS.map(p => p.key)

/** 풍향(도) → 8방위 인덱스(0=북, 1=북동 … 7=북서). 사전의 방위 이름 배열을 이 순서로 둔다. */
export function compassIndex(deg: number): number {
  return Math.round((((deg % 360) + 360) % 360) / 45) % 8
}

// ── 센서별 값 ────────────────────────────────────────────────────────────────
// 같은 칸에 센서가 여러 대면 카드는 평균을 보이고, 칸을 누르면 한 대 한 대를 펼친다.
// 장비(field_env.payload_each)가 env_each 로 올리고 서버가 water_quality_readings.env_sensors
// (env_sensors.sql)에 그대로 둔다. 풍향·돌풍·강우강도는 다른 칸에 접혀 있어 따로 받지 않는다.

/** 센서별 값을 받는 칸 — 장비 field_env.EACH_SLOTS 와 같다. */
export const EACH_KEYS = ["air_temp", "humidity", "soil_moisture", "soil_temp", "wind_speed", "rain_day"] as const
export type EachKey = (typeof EACH_KEYS)[number]
export type EnvEach = Partial<Record<EachKey, { id: string; v: number }[]>>

const EACH_MAX = 16
const SENSOR_ID_RE = /^[A-Za-z0-9_.-]{1,32}$/

/** 장비가 보낸 env_each 를 검증한다. 2대 이상 남은 칸만 돌려준다. 받을 것이 없으면 null. */
export function parseEnvEach(raw: unknown): EnvEach | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const src = raw as Record<string, unknown>
  const out: EnvEach = {}
  for (const key of EACH_KEYS) {
    const list = src[key]
    if (!Array.isArray(list)) continue
    const [min, max] = ENV_PARAMS.find(p => p.key === key)!.range
    const seen = new Set<string>()
    const rows: { id: string; v: number }[] = []
    for (const item of list.slice(0, EACH_MAX)) {
      if (!item || typeof item !== "object") continue
      const r = item as Record<string, unknown>
      const id = typeof r.id === "string" ? r.id.trim().toUpperCase() : ""
      const v = Number(r.v)
      if (!SENSOR_ID_RE.test(id) || seen.has(id) || r.v === null || !Number.isFinite(v) || v < min || v > max) continue
      seen.add(id)
      rows.push({ id, v })
    }
    if (rows.length >= 2) out[key] = rows
  }
  return Object.keys(out).length ? out : null
}
