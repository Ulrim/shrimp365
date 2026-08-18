export const WQ_THRESHOLDS = {
  temperature: { warning: { min: 25, max: 32 }, danger: { min: 22, max: 35 } },
  ph:          { warning: { min: 7.5, max: 8.5 }, danger: { min: 7.0, max: 9.0 } },
  do_level:    { warning: { min: 5.0, max: null }, danger: { min: 4.0, max: null } },
  // 염도(ppt) — 흰다리새우 해수 양식 기준.
  // 저염도로 키우는 농장이라면 이 범위를 벗어난 채로 정상 운영하게 되므로,
  // 농장별 설정이 생기기 전까지는 그런 농장에서 알림이 계속 뜬다.
  salinity:    { warning: { min: 15, max: 35 }, danger: { min: 10, max: 40 } },
  ammonia:     { warning: { min: null, max: 0.5 }, danger: { min: null, max: 1.0 } },
  nitrite:     { warning: { min: null, max: 0.2 }, danger: { min: null, max: 0.5 } },
  nitrate:     { warning: { min: null, max: 20 }, danger: { min: null, max: 40 } },
  alkalinity:  { warning: { min: 80, max: 180 }, danger: { min: 60, max: 200 } },
  turbidity:   { warning: { min: null, max: 20 }, danger: { min: null, max: 30 } },
} as const

const PARAM_LABELS: Record<string, string> = {
  temperature: "수온",
  ph:          "pH",
  do_level:    "DO",
  salinity:    "염도",
  ammonia:     "암모니아",
  nitrite:     "아질산염",
  nitrate:     "질산염",
  alkalinity:  "알칼리도",
  turbidity:   "탁도",
}

type ThresholdKey = keyof typeof WQ_THRESHOLDS

export interface ThresholdAlert {
  parameter: string
  value: number
  threshold: number
  type: "danger" | "warning"
  message: string
}

export function checkThresholds(values: Partial<Record<ThresholdKey, number>>): ThresholdAlert[] {
  const alerts: ThresholdAlert[] = []

  for (const [param, value] of Object.entries(values) as [ThresholdKey, number][]) {
    if (value === 0 || !(param in WQ_THRESHOLDS)) continue
    const t = WQ_THRESHOLDS[param]
    const label = PARAM_LABELS[param] ?? param

    const { min: dMin, max: dMax } = t.danger as { min: number | null; max: number | null }
    const { min: wMin, max: wMax } = t.warning as { min: number | null; max: number | null }

    const isDanger =
      (dMin !== null && value < dMin) ||
      (dMax !== null && value > dMax)

    const isWarning = !isDanger && (
      (wMin !== null && value < wMin) ||
      (wMax !== null && value > wMax)
    )

    if (isDanger || isWarning) {
      const type = isDanger ? "danger" : "warning"
      const threshold = isDanger
        ? ((dMin !== null && value < dMin) ? dMin : dMax ?? 0)
        : ((wMin !== null && value < wMin) ? wMin : wMax ?? 0)

      alerts.push({
        parameter: label,
        value,
        threshold,
        type,
        message: `${label} ${value} — ${type === "danger" ? "위험 수준" : "주의 수준"} (기준: ${threshold})`,
      })
    }
  }

  return alerts
}

// ── 베드별 양액 레시피 이탈 판정 (농업 모드) ─────────────────────────────
//
// 위 WQ_THRESHOLDS 는 흰다리새우 해수 기준 전역 상수다. 레시피는 그 첫 번째
// "농장별 설정" — 베드(tank)마다 목표 EC/pH 와 허용 오차를 두고, 이탈하면
// 알림을 만든다. checkThresholds 를 대체하지 않고 결과를 합쳐 쓴다.
//
// 단위 원칙: 저장·비교는 µS/cm, 알림 문구만 mS/cm 로 표기한다.
// 사업 목표: EC 제어 정확도 ±0.1 dS/m(=±0.1 mS/cm=±100 µS/cm).

export interface TankRecipe {
  target_ec?: number | null    // µS/cm
  ec_tolerance?: number | null // ±µS/cm — null 이면 기본 100
  target_ph?: number | null
  ph_tolerance?: number | null // null 이면 기본 0.5
}

/** 레시피가 하나라도 설정된 베드인지. */
export function hasRecipe(recipe: TankRecipe | null | undefined): boolean {
  return !!recipe && (recipe.target_ec != null || recipe.target_ph != null)
}

const msCm = (us: number) => (us / 1000).toFixed(2)

/** 목표 ± 오차 이탈이면 warning, ± 2×오차 이탈이면 danger.
 *  값이 없거나(0 포함 — 전극이 물 밖) 목표가 없으면 판정하지 않는다. */
export function checkRecipe(
  values: { conductivity?: number; ph?: number },
  recipe: TankRecipe | null | undefined,
): ThresholdAlert[] {
  if (!recipe) return []
  const alerts: ThresholdAlert[] = []

  const ec = values.conductivity
  if (recipe.target_ec != null && typeof ec === "number" && ec !== 0) {
    const target = recipe.target_ec
    const tol = recipe.ec_tolerance ?? 100
    const diff = Math.abs(ec - target)
    if (diff > tol) {
      const type = diff > 2 * tol ? "danger" : "warning"
      // 넘은 쪽의 경계값을 임계치로 남긴다(µS/cm).
      const threshold = ec > target ? target + tol : target - tol
      alerts.push({
        parameter: "EC",
        value: ec,
        threshold,
        type,
        message: `EC ${msCm(ec)} mS/cm — 목표 ${msCm(target)}±${msCm(tol)} 이탈`,
      })
    }
  }

  const ph = values.ph
  if (recipe.target_ph != null && typeof ph === "number" && ph !== 0) {
    const target = recipe.target_ph
    const tol = recipe.ph_tolerance ?? 0.5
    const diff = Math.abs(ph - target)
    if (diff > tol) {
      const type = diff > 2 * tol ? "danger" : "warning"
      const threshold = ph > target ? target + tol : target - tol
      alerts.push({
        parameter: "pH",
        value: ph,
        threshold: Number(threshold.toFixed(2)),
        type,
        message: `pH ${ph} — 목표 ${target}±${tol} 이탈`,
      })
    }
  }

  return alerts
}
