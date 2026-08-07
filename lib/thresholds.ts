export const WQ_THRESHOLDS = {
  temperature: { warning: { min: 25, max: 32 }, danger: { min: 22, max: 35 } },
  ph:          { warning: { min: 7.5, max: 8.5 }, danger: { min: 7.0, max: 9.0 } },
  do_level:    { warning: { min: 5.0, max: null }, danger: { min: 4.0, max: null } },
  // 염도(ppm)는 자동 알림을 걸지 않는다.
  // 적정 범위가 양식 방식에 따라 완전히 다르다 — 민물은 수백 ppm, 기수는
  // 15,000~25,000 ppm 이다. 하나의 값으로 잡으면 한쪽은 무조건 위험으로 떠서
  // 알림이 하루 수백 건씩 쌓이고, 정작 봐야 할 알림이 묻힌다.
  // 농장별 범위 설정이 생기면 그때 켠다.
  salinity:    { warning: { min: null, max: null }, danger: { min: null, max: null } },
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
