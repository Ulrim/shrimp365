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
  /** 스파크라인 색(hex). 상태색(emerald/amber/red)과 겹치지 않게 골랐다. */
  color: string
  icon: IconComponent
}

/** 순서가 곧 카드의 칸 순서다 — 온습도·토양(지그비) → 기상(WS90 등). */
export const ENV_PARAMS: readonly EnvParam[] = [
  { key: "air_temp",      unit: "°C",   digits: 1, color: "#f97316", icon: Thermometer },
  { key: "humidity",      unit: "%",    digits: 1, color: "#0ea5e9", icon: Droplets },
  { key: "soil_moisture", unit: "%",    digits: 1, color: "#a16207", icon: Sprout },
  { key: "soil_temp",     unit: "°C",   digits: 1, color: "#b45309", icon: Layers },
  { key: "wind_speed",    unit: "m/s",  digits: 1, color: "#14b8a6", icon: Wind },
  { key: "wind_gust",     unit: "m/s",  digits: 1, color: "#0d9488", icon: Wind },
  { key: "wind_dir",      unit: "°",    digits: 0, color: "#64748b", icon: Navigation },
  { key: "rain_day",      unit: "mm",   digits: 1, color: "#3b82f6", icon: CloudRain },
  { key: "rain_rate",     unit: "mm/h", digits: 1, color: "#6366f1", icon: CloudDrizzle },
  { key: "solar",         unit: "W/m²", digits: 0, color: "#eab308", icon: Sun },
  { key: "uv_index",      unit: "",     digits: 1, color: "#a855f7", icon: SunDim },
  { key: "pressure",      unit: "hPa",  digits: 1, color: "#8b5cf6", icon: Gauge },
] as const

export const ENV_KEYS: readonly EnvParamKey[] = ENV_PARAMS.map(p => p.key)

/** 풍향(도) → 8방위 인덱스(0=북, 1=북동 … 7=북서). 사전의 방위 이름 배열을 이 순서로 둔다. */
export function compassIndex(deg: number): number {
  return Math.round((((deg % 360) + 360) % 360) / 45) % 8
}
