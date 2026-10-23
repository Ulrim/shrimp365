// 장비 [센서 설정]에서 켜 둔 것 — Farm365 대시보드가 꺼 둔 칸을 그리지 않는 근거.
//
// 장비(1.9.4+)는 매 전송에 `sensors_on: "ph,ec,env,power"` 를 맨 앞에 싣고, 서버는 그것을
// sensor_devices.last_payload 에 남긴다. 값이 없는 칸(고장·끊김)과 일부러 꺼 둔 칸을 가르는
// 유일한 근거라, 이 값이 없는 옛 장비는 지금까지처럼 모두 그린다(null = 모름 = 다 보임).
import type { SensorDevice } from "@/types"

/** 켜 둔 것의 집합. 수질 센서 키(ph·do·ec·flow·dp)와 env·power·nutrient. null = 장비가 알려 주지 않음. */
export type SensorsOn = ReadonlySet<string> | null

/** 쓰는 중인(active) 장비들이 알려 준 것을 합친다 — 한 베드에 장비가 둘이면 어느 쪽이든 켜면 보인다.
 *  알려 주지 않는 옛 장비가 하나라도 섞여 있으면 그 장비가 무엇을 재는지 모르므로 null(모두 그린다). */
export function sensorsOnFrom(devices: readonly SensorDevice[] | undefined): SensorsOn {
  const out = new Set<string>()
  let any = false
  for (const dv of devices ?? []) {
    if (!dv.active) continue
    const raw = dv.last_payload?.sensors_on
    if (typeof raw !== "string") return null
    any = true
    for (const s of raw.split(",")) if (s.trim()) out.add(s.trim())
  }
  return any ? out : null
}

/** 측정 칸 → 그 값을 내는 센서. 수온은 pH·DO·EC 센서 어느 것이든 잰다. */
const NEED: Record<string, readonly string[]> = {
  conductivity: ["ec"], tds: ["ec"], salinity: ["ec"],
  ph: ["ph"], orp: ["ph"],
  temperature: ["ph", "do", "ec"],
  do_level: ["do"], do_saturation: ["do"],
  flow_rate: ["flow"], diff_pressure: ["dp"],
}

/** 이 측정 칸을 그리나. 모르는 칸이거나 장비가 알려 주지 않았으면 그린다. */
export function metricOn(key: string, on: SensorsOn): boolean {
  if (!on) return true
  const need = NEED[key]
  return !need || need.some(s => on.has(s))
}

/** 환경·기상, 전력, 양액 카드를 그리나. */
export function featureOn(feature: "env" | "power" | "nutrient", on: SensorsOn): boolean {
  return !on || on.has(feature)
}
