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

// ── 추세 기반 이상징후 탐지 ─────────────────────────────────────────────
//
// 위 WQ_THRESHOLDS 는 "지금 값이 선을 넘었나"만 본다. 그것만으로는 늦다 —
// DO 가 7.2 → 6.4 → 5.4 로 내려가는 동안은 5.0 을 안 넘었으니 아무 말이 없다가,
// 넘는 순간 위험 알림이 뜬다. 그때는 이미 손쓸 시간이 짧다.
//
// 여기서는 값의 "움직임"을 본다. 세 신호를 각각 다른 이유로 잡는다.
//   급변(surge)      직전 측정 대비 한 번에 크게 튀었다 — 사고·오염·장비 고장.
//   연속 악화(drift)  여러 번에 걸쳐 한 방향으로 꾸준히 나빠진다 — 서서히 무너지는 중.
//   범위 이탈(deviation) 이 수조의 평소 값에서 벗어났다 — 절대 기준이 아닌 자기 기준.
//
// 결과는 alerts 테이블에 저장하지 않는다. 저장되는 알림은 임계값 초과로만
// 한정해 두어야 알림함이 추정으로 넘치지 않는다. 이건 화면에서 읽는 신호다.

/** 어느 쪽으로 움직여야 "나빠지는" 것인지. */
type Worsening = "up" | "down" | "both"

/** 항목별 판정 기준.
 *  surge 는 "직전 대비 이만큼 튀면 비정상"인 폭이고, 연속 악화의 누적 폭 기준도 겸한다.
 *  값은 흰다리새우 해수 양식의 통상 변동폭에서 잡았다 — 정상 운영에서 한 측정 주기에
 *  이만큼 움직이는 일은 드물다. */
const TREND_RULES: Record<ThresholdKey, { worsening: Worsening; surge: number; digits: number }> = {
  temperature: { worsening: "both", surge: 2.0,  digits: 1 },
  ph:          { worsening: "both", surge: 0.4,  digits: 2 },
  do_level:    { worsening: "down", surge: 1.2,  digits: 2 },
  salinity:    { worsening: "both", surge: 3.0,  digits: 1 },
  ammonia:     { worsening: "up",   surge: 0.25, digits: 2 },
  nitrite:     { worsening: "up",   surge: 0.10, digits: 2 },
  nitrate:     { worsening: "up",   surge: 8.0,  digits: 1 },
  alkalinity:  { worsening: "both", surge: 25,   digits: 0 },
  turbidity:   { worsening: "up",   surge: 6.0,  digits: 1 },
}

export interface TrendAnomaly {
  parameter: string
  kind: "surge" | "drift" | "deviation"
  /** 임계값 알림과 같은 등급 체계를 쓴다 — 화면에서 색을 공유하기 위해. */
  type: "danger" | "warning"
  message: string
  value: number
  /** 비교 기준값 — 급변이면 직전 값, 연속 악화면 구간 시작값, 이탈이면 평소 평균. */
  reference: number
}

/** 판정에 필요한 최소 측정 횟수. 2~3개로는 추세라고 부를 수 없다. */
export const TREND_MIN_SAMPLES = 4
/** 평소 범위(평균·표준편차)를 논하려면 표본이 더 있어야 한다. */
const DEVIATION_MIN_SAMPLES = 6
/** 표준편차 몇 배를 벗어나야 "평소와 다르다"고 볼지. */
const DEVIATION_SIGMA = 2.5
/** 몇 번 연속 같은 방향이어야 추세로 볼지. */
const DRIFT_MIN_STEPS = 3

/** 이 움직임이 악화 방향인가. */
function isWorsening(delta: number, worsening: Worsening): boolean {
  if (delta === 0) return false
  if (worsening === "both") return true
  return worsening === "up" ? delta > 0 : delta < 0
}

/** 끝에서 거슬러 올라가며 연속으로 같은 방향인 구간의 길이. */
function trailingRunLength(series: number[], sign: number): number {
  let steps = 0
  for (let i = series.length - 1; i > 0; i--) {
    const d = series[i] - series[i - 1]
    if (d === 0 || Math.sign(d) !== sign) break
    steps++
  }
  return steps
}

/**
 * 시간순(오래된 것 → 최신) 측정 기록에서 이상징후를 뽑는다.
 *
 * 항목당 최대 하나만 보고한다(급변 > 연속 악화 > 범위 이탈 순). 같은 항목에
 * 세 줄이 뜨면 읽는 사람이 무엇부터 봐야 할지 알 수 없다.
 *
 * 0 은 "안 쟀다"로 본다 — DB 기본값이 0 이라 측정하지 않은 항목과 구분되지 않는다.
 * 이 관례는 checkThresholds 와 같다.
 */
export function detectTrendAnomalies(
  readings: Partial<Record<ThresholdKey, number>>[],
): TrendAnomaly[] {
  if (readings.length < TREND_MIN_SAMPLES) return []
  const found: TrendAnomaly[] = []

  for (const key of Object.keys(TREND_RULES) as ThresholdKey[]) {
    const rule = TREND_RULES[key]
    const label = PARAM_LABELS[key] ?? key
    const fmt = (n: number) => n.toFixed(rule.digits)

    const series = readings
      .map(r => r[key])
      .filter((v): v is number => typeof v === "number" && v !== 0)

    if (series.length < TREND_MIN_SAMPLES) continue

    const latest = series[series.length - 1]
    const prev = series[series.length - 2]
    const step = latest - prev

    // ① 급변 — 한 주기에 크게 튀었다
    if (isWorsening(step, rule.worsening) && Math.abs(step) >= rule.surge) {
      found.push({
        parameter: label,
        kind: "surge",
        type: Math.abs(step) >= rule.surge * 2 ? "danger" : "warning",
        message: `${label} ${fmt(latest)} — 직전 ${fmt(prev)} 에서 ${fmt(Math.abs(step))} 급변`,
        value: latest,
        reference: prev,
      })
      continue
    }

    // ② 연속 악화 — 여러 주기에 걸쳐 한 방향
    const sign = Math.sign(step)
    if (sign !== 0 && isWorsening(step, rule.worsening)) {
      const steps = trailingRunLength(series, sign)
      if (steps >= DRIFT_MIN_STEPS) {
        const start = series[series.length - 1 - steps]
        const total = Math.abs(latest - start)
        if (total >= rule.surge) {
          found.push({
            parameter: label,
            kind: "drift",
            type: total >= rule.surge * 2 ? "danger" : "warning",
            message: `${label} ${fmt(latest)} — ${steps + 1}회 연속 ${sign > 0 ? "상승" : "하락"} (${fmt(start)} → ${fmt(latest)})`,
            value: latest,
            reference: start,
          })
          continue
        }
      }
    }

    // ③ 평소 범위 이탈 — 이 수조의 자기 기준에서 벗어났다
    if (series.length >= DEVIATION_MIN_SAMPLES) {
      const baseline = series.slice(0, -1)
      const mean = baseline.reduce((s, v) => s + v, 0) / baseline.length
      const variance = baseline.reduce((s, v) => s + (v - mean) ** 2, 0) / baseline.length
      const sd = Math.sqrt(variance)
      const gap = latest - mean
      // sd 가 0 에 가까우면(늘 같은 값) 아주 작은 변화도 무한대 배수가 된다.
      // 그런 경우까지 잡으면 소수점 흔들림마다 경고가 뜨므로, 판정 폭의 1/4 을
      // 최소 유의미 변화로 두고 그보다 작으면 넘어간다.
      if (sd > 0 && Math.abs(gap) >= rule.surge / 4 && Math.abs(gap) / sd >= DEVIATION_SIGMA
          && isWorsening(gap, rule.worsening)) {
        found.push({
          parameter: label,
          kind: "deviation",
          type: "warning",
          message: `${label} ${fmt(latest)} — 평소 범위(평균 ${fmt(mean)}) 를 벗어남`,
          value: latest,
          reference: mean,
        })
      }
    }
  }

  // 위험을 먼저, 그다음 급변 → 연속 악화 → 범위 이탈 순으로 읽히게 한다.
  const kindOrder = { surge: 0, drift: 1, deviation: 2 }
  return found.sort((a, b) =>
    (a.type === b.type ? 0 : a.type === "danger" ? -1 : 1) || kindOrder[a.kind] - kindOrder[b.kind])
}
