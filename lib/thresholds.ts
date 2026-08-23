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
// DO 가 내려가는 동안은 5.0 을 안 넘었으니 조용하다가, 넘는 순간 위험이 뜬다.
// 여기서는 값의 "움직임"을 본다.
//
// ⚠ 이 판정에서 가장 조심할 것은 탐지가 아니라 **오탐**이다. 양식장 수질에는
// 정상적인 하루 주기가 있다 — 낮에 광합성으로 DO·pH·수온이 오르고 밤에 내린다.
// 실무 일교차는 수온 3~6℃, DO 3~6 mg/L, pH 0.5~1.0 에 이른다. 이 주기를
// "연속 악화"로 세면 정상 수조가 온종일 붉게 뜬다(초판이 이 실수를 했다).
//
// 그래서 항목을 두 부류로 나눈다.
//   · 주기성 항목(수온·pH·DO)   — 하루 주기가 크다. 연속 악화를 그대로 세면 안 되고,
//     **날짜별 극값**이 며칠에 걸쳐 나빠지는지를 본다(주기에 영향받지 않는다).
//   · 축적성 항목(암모니아·아질산·질산·탁도·알칼리도·염도) — 하루 주기가 없다.
//     구간 안의 연속 악화와 평소 범위 이탈을 그대로 볼 수 있다.
//
// 또한 이 배열은 wq_series 가 돌려주는 **구간 평균 버킷**이고, 센서가 여러 대면
// 한 버킷에 센서별 행이 함께 온다(GROUP BY 버킷, device_id / ORDER BY 버킷).
// 따라서 반드시 **센서별로 나눈 뒤 시각순으로** 봐야 한다. 섞인 채로 이웃을 비교하면
// 두 센서의 캘리브레이션 차이가 영원히 "급변"으로 잡힌다.
//
// 결과는 alerts 테이블에 저장하지 않는다. 저장되는 알림은 임계값 초과로만
// 한정해 두어야 알림함이 추정으로 넘치지 않는다. 이건 화면에서 읽는 신호다.

/** 어느 쪽으로 움직여야 "나빠지는" 것인지. */
type Worsening = "up" | "down" | "both"

/** 항목별 판정 기준.
 *  surge 는 "짧은 시간에 이만큼 튀면 비정상"인 폭이다.
 *  diurnal 은 하루 주기가 큰 항목인지 — 판정 방식이 갈린다(위 주석 참고). */
const TREND_RULES: Record<ThresholdKey, {
  worsening: Worsening; surge: number; digits: number; diurnal: boolean
}> = {
  temperature: { worsening: "both", surge: 2.0,  digits: 1, diurnal: true },
  ph:          { worsening: "both", surge: 0.4,  digits: 2, diurnal: true },
  do_level:    { worsening: "down", surge: 1.2,  digits: 2, diurnal: true },
  salinity:    { worsening: "both", surge: 3.0,  digits: 1, diurnal: false },
  ammonia:     { worsening: "up",   surge: 0.25, digits: 2, diurnal: false },
  nitrite:     { worsening: "up",   surge: 0.10, digits: 2, diurnal: false },
  nitrate:     { worsening: "up",   surge: 8.0,  digits: 1, diurnal: false },
  alkalinity:  { worsening: "both", surge: 25,   digits: 0, diurnal: false },
  turbidity:   { worsening: "up",   surge: 6.0,  digits: 1, diurnal: false },
}

export interface TrendAnomaly {
  parameter: string
  kind: "surge" | "drift" | "deviation"
  /** 임계값 알림과 같은 등급 체계를 쓴다 — 화면에서 색을 공유하기 위해. */
  type: "danger" | "warning"
  message: string
  value: number
  /** 비교 기준값 — 급변이면 이전 값, 연속 악화면 구간 시작값, 이탈이면 평소 평균. */
  reference: number
}

/** 판정에 필요한 최소 측정 횟수. 2~3개로는 추세라고 부를 수 없다. */
export const TREND_MIN_SAMPLES = 4

/** 두 기록이 이보다 벌어져 있으면 그 사이 변화를 "급변"이라 부를 수 없다.
 *  하루 주기의 2시간치 변화(수온 ~1℃, DO ~0.8, pH ~0.14)는 어느 surge 값보다 작아
 *  이 상한이 곧 주기성 오탐의 방어선이 된다. */
const SURGE_MAX_GAP_H = 2
/** 최근 몇 시간까지 되짚어 급변을 찾을지. 마지막 한 점만 보면 새벽에 벌어졌다
 *  회복된 사고를 아침에 놓친다. */
const SURGE_SCAN_H = 6
/** 축적성 항목의 연속 악화를 볼 최대 구간. */
const DRIFT_WINDOW_H = 12
/** 이보다 짧은 구간의 연속은 노이즈로 본다. */
const DRIFT_MIN_SPAN_H = 2
/** 주기성 항목의 날짜별 극값을 볼 최소 일수. */
const DAILY_MIN_DAYS = 3
/** 평소 범위(평균·표준편차)를 논하려면 표본이 이만큼 있어야 한다.
 *  표본이 적으면 t 분포 꼬리가 두꺼워 정상 데이터도 이탈로 찍힌다. */
const DEVIATION_MIN_SAMPLES = 12
/** 표준편차 몇 배를 벗어나야 "평소와 다르다"고 볼지. */
const DEVIATION_SIGMA = 3

interface Point { t: number; v: number }

/** 이 움직임이 악화 방향인가. */
function isWorsening(delta: number, worsening: Worsening): boolean {
  if (delta === 0) return false
  if (worsening === "both") return true
  return worsening === "up" ? delta > 0 : delta < 0
}

const H = 3600_000

/** 사람이 읽는 경과 시간. "직전" 이라고만 쓰면 이틀 전 기록도 직전이 된다. */
function fmtGap(ms: number): string {
  const h = ms / H
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}분 전`
  if (h < 48) return `${Math.round(h)}시간 전`
  return `${Math.round(h / 24)}일 전`
}

/** 하루 경계로 묶어 날짜별 극값을 뽑는다. dir 이 up 이면 최댓값, down 이면 최솟값. */
function dailyExtremes(points: Point[], dir: "up" | "down"): Point[] {
  const byDay = new Map<string, Point>()
  for (const p of points) {
    const key = new Date(p.t).toDateString()
    const cur = byDay.get(key)
    if (!cur || (dir === "up" ? p.v > cur.v : p.v < cur.v)) byDay.set(key, p)
  }
  return [...byDay.values()].sort((a, b) => a.t - b.t)
}

/** 끝에서 거슬러 올라가며 연속으로 같은 방향인 구간의 시작 인덱스. */
function runStart(points: Point[], sign: number, maxSpanMs: number): number {
  const last = points.length - 1
  let i = last
  while (i > 0) {
    const d = points[i].v - points[i - 1].v
    if (d === 0 || Math.sign(d) !== sign) break
    if (points[last].t - points[i - 1].t > maxSpanMs) break
    i--
  }
  return i
}

/**
 * 측정 기록에서 이상징후를 뽑는다.
 *
 * 입력은 시각(recorded_at)과 센서(device_id)를 가진 기록이어야 한다 — 센서별로
 * 나눠 각각 시각순으로 보고, 변화는 경과 시간과 함께 판단한다.
 *
 * 항목당 최대 하나만 보고한다(센서가 여럿이면 가장 심한 것). 같은 항목에 여러 줄이
 * 뜨면 읽는 사람이 무엇부터 봐야 할지 알 수 없다.
 *
 * 0 은 "안 쟀다"로 본다 — DB 기본값이 0 이라 미측정과 구분되지 않는다.
 * 이 관례는 checkThresholds 와 같다.
 */
export function detectTrendAnomalies(
  readings: (Partial<Record<ThresholdKey, number>> & {
    recorded_at?: string | number | Date
    device_id?: string | null
  })[],
): TrendAnomaly[] {
  if (readings.length < TREND_MIN_SAMPLES) return []

  // 센서별로 가른다. 시각이 없는 기록(구형 데이터·목데이터)은 배열 순서를 시간순으로
  // 믿고 1시간 간격을 가정한다 — 그래야 시각 없는 입력에서도 판정이 돌아간다.
  const groups = new Map<string, (typeof readings)[number][]>()
  readings.forEach(r => {
    const key = r.device_id ?? "__manual__"
    const arr = groups.get(key)
    if (arr) arr.push(r); else groups.set(key, [r])
  })

  const best = new Map<string, TrendAnomaly>()
  const keep = (a: TrendAnomaly) => {
    const cur = best.get(a.parameter)
    if (!cur || (cur.type !== "danger" && a.type === "danger")) best.set(a.parameter, a)
  }

  for (const rows of groups.values()) {
    for (const key of Object.keys(TREND_RULES) as ThresholdKey[]) {
      const rule = TREND_RULES[key]
      const label = PARAM_LABELS[key] ?? key
      const fmt = (n: number) => n.toFixed(rule.digits)

      const pts: Point[] = []
      rows.forEach((r, i) => {
        const v = r[key]
        if (typeof v !== "number" || v === 0) return
        const raw = r.recorded_at
        const t = raw === undefined ? i * H : new Date(raw).getTime()
        if (Number.isFinite(t)) pts.push({ t, v })
      })
      pts.sort((a, b) => a.t - b.t)
      if (pts.length < TREND_MIN_SAMPLES) continue

      const last = pts[pts.length - 1]

      // ① 급변 — 짧은 간격 안에서 크게 튀었다. 최근 구간을 되짚어 가장 심한 것을 쓴다.
      let worst: { from: Point; to: Point; delta: number } | null = null
      for (let i = pts.length - 1; i > 0; i--) {
        if (last.t - pts[i].t > SURGE_SCAN_H * H) break
        const gap = pts[i].t - pts[i - 1].t
        if (gap > SURGE_MAX_GAP_H * H) continue          // 벌어진 간격은 급변이라 못 부른다
        const delta = pts[i].v - pts[i - 1].v
        if (!isWorsening(delta, rule.worsening) || Math.abs(delta) < rule.surge) continue
        if (!worst || Math.abs(delta) > Math.abs(worst.delta)) worst = { from: pts[i - 1], to: pts[i], delta }
      }
      if (worst) {
        keep({
          parameter: label,
          kind: "surge",
          type: Math.abs(worst.delta) >= rule.surge * 2 ? "danger" : "warning",
          message: `${label} ${fmt(worst.to.v)} — ${fmtGap(last.t - worst.from.t)} ${fmt(worst.from.v)} 에서 ${fmt(Math.abs(worst.delta))} 급변`,
          value: worst.to.v,
          reference: worst.from.v,
        })
        continue
      }

      if (rule.diurnal) {
        // ② 주기성 항목 — 날짜별 극값이 며칠에 걸쳐 나빠지는가.
        //    하루 주기 자체는 날짜마다 같은 극값을 만들므로 이 판정에 걸리지 않는다.
        const dirs: ("up" | "down")[] = rule.worsening === "both" ? ["up", "down"] : [rule.worsening]
        for (const dir of dirs) {
          const days = dailyExtremes(pts, dir)
          if (days.length < DAILY_MIN_DAYS) continue
          const sign = dir === "up" ? 1 : -1
          const startIdx = runStart(days, sign, Number.POSITIVE_INFINITY)
          const spanDays = days.length - startIdx
          if (spanDays < DAILY_MIN_DAYS) continue
          const start = days[startIdx]
          const end = days[days.length - 1]
          const total = Math.abs(end.v - start.v)
          if (total < rule.surge) continue
          keep({
            parameter: label,
            kind: "drift",
            type: total >= rule.surge * 2 ? "danger" : "warning",
            message: `${label} — 일별 ${dir === "up" ? "최고" : "최저"}값이 ${spanDays}일 연속 ${dir === "up" ? "상승" : "하락"} (${fmt(start.v)} → ${fmt(end.v)})`,
            value: end.v,
            reference: start.v,
          })
          break
        }
        continue
      }

      // ③ 축적성 항목 — 구간 안 연속 악화
      const step = last.v - pts[pts.length - 2].v
      const sign = Math.sign(step)
      if (sign !== 0 && isWorsening(step, rule.worsening)) {
        const i0 = runStart(pts, sign, DRIFT_WINDOW_H * H)
        const start = pts[i0]
        const spanH = (last.t - start.t) / H
        const total = Math.abs(last.v - start.v)
        if (pts.length - 1 - i0 >= 3 && spanH >= DRIFT_MIN_SPAN_H && total >= rule.surge) {
          keep({
            parameter: label,
            kind: "drift",
            type: total >= rule.surge * 2 ? "danger" : "warning",
            message: `${label} ${fmt(last.v)} — ${Math.round(spanH)}시간째 계속 ${sign > 0 ? "상승" : "하락"} (${fmt(start.v)} → ${fmt(last.v)})`,
            value: last.v,
            reference: start.v,
          })
          continue
        }
      }

      // ④ 평소 범위 이탈 — 이 수조의 자기 기준에서 벗어났다.
      //    표본 표준편차(÷(N-1))를 쓰고 3σ 로 잡는다. 모집단 식(÷N)에 2.5σ 였던
      //    초판은 표본이 적을 때 정상 데이터의 10% 이상을 이탈로 찍었다.
      if (pts.length >= DEVIATION_MIN_SAMPLES) {
        const baseline = pts.slice(0, -1).map(p => p.v)
        const mean = baseline.reduce((s, v) => s + v, 0) / baseline.length
        const variance = baseline.reduce((s, v) => s + (v - mean) ** 2, 0) / (baseline.length - 1)
        const sd = Math.sqrt(variance)
        const gap = last.v - mean
        // sd 가 0 에 가까우면(늘 같은 값) 아주 작은 변화도 무한대 배수가 된다.
        // 판정 폭의 1/4 을 최소 유의미 변화로 두고 그보다 작으면 넘어간다.
        if (sd > 0 && Math.abs(gap) >= rule.surge / 4 && Math.abs(gap) / sd >= DEVIATION_SIGMA
            && isWorsening(gap, rule.worsening)) {
          keep({
            parameter: label,
            kind: "deviation",
            type: "warning",
            message: `${label} ${fmt(last.v)} — 평소 범위(평균 ${fmt(mean)}) 를 벗어남`,
            value: last.v,
            reference: mean,
          })
        }
      }
    }
  }

  // 위험을 먼저, 그다음 급변 → 연속 악화 → 범위 이탈 순으로 읽히게 한다.
  const kindOrder = { surge: 0, drift: 1, deviation: 2 }
  return [...best.values()].sort((a, b) =>
    (a.type === b.type ? 0 : a.type === "danger" ? -1 : 1) || kindOrder[a.kind] - kindOrder[b.kind])
}
