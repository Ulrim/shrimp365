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

// ── 수경재배(엽채류 NFT) 양액 전역 기준 ──────────────────────────────────
//
// 위 WQ_THRESHOLDS 는 흰다리새우 해수 기준이다. 근권부 냉방 칠러로 일부러
// 22~24 ℃ 를 유지하는 농업 베드에 그 기준을 그대로 대면, 정상 운전이 매 수신
// 마다 "수온 주의" 알림이 된다. 그래서 프로필을 나눈다.
//
// 레시피(베드별 목표 EC/pH)가 우선이고, 이 상수는 레시피가 없을 때의 안전망이다.
// EC 는 여기에 없다 — 전역 EC 기준선을 긋지 않는다는 원칙(설계서 3-5). EC 판정은
// 레시피(checkRecipe)에만 맡긴다.
//
// **수치의 한계**: 아래 값은 엽채류 수경재배의 일반 통설이며 쪽파 전용 실증
// 데이터가 아니다. 나주 시험포의 여름·겨울 각 1주기 데이터가 쌓이면 재교정해야
// 한다. 특히 여름철 칠러 부하 한계에서의 실제 상한을 모른다.
//   - 근권 양액 온도: 권장 18~22 ℃. 25 ℃ 를 넘으면 용존산소가 떨어지고
//     피시움 등 근부병 위험이 오른다 → warning 상한 26, danger 상한 30.
//     하한 16/12 는 칠러 과냉·겨울 외기 유입 감지용.
//   - 양액 pH: 엽채류 권장 5.5~6.5. 벗어나면 미량요소 흡수가 막힌다.
//   - 양액 DO: 4 ppm 이상. **상한은 두지 않는다** — 양액이 과포화(12 ppm 초과)
//     라도 작물에 해가 되지 않는다. 전에는 화면 쪽 표시 기준에만 상한 12 가
//     있어서 "카드는 위험인데 알림은 없음"이 나왔다. 상한을 알림에 새로 만드는
//     대신 화면에서 없앴다(없는 위험을 알리는 쪽이 더 나쁘다).
//
// **이 표가 농업 판정의 유일한 숫자다.** 화면 표시 기준(lib/agri-standards.ts 의
// AGRI_QUALITY_STANDARDS)은 여기서 파생된다 — warning 밴드 = 화면 "정상",
// danger 밴드 = 화면 "주의"까지. 표시용 숫자를 따로 적지 않는다.
export const AGRI_THRESHOLDS = {
  temperature: { warning: { min: 16, max: 26 }, danger: { min: 12, max: 30 } },
  ph:          { warning: { min: 5.5, max: 6.5 }, danger: { min: 5.0, max: 7.0 } },
  do_level:    { warning: { min: 4.0, max: null }, danger: { min: 2.0, max: null } },
} as const

/** 판정 프로필. 기본값은 언제나 "shrimp" — 실패·불명 시에도 새우다. */
export type FarmProfile = "shrimp" | "agriculture"

// ── alerts.parameter 는 라벨이 아니라 **키**다 ────────────────────────────
//
// 이 문자열은 화면에 쓰이기 전에 먼저 DB 에 저장되고, 센서 라우트가 그 값으로
//   (1) 이미 열린 알림을 찾아 중복을 억제하고
//   (2) 범위로 돌아온 항목의 알림을 닫는다.
// 즉 `parameter` 는 알림 행의 **식별자**다. 같은 항목이 상황에 따라 다른
// 문자열로 저장되면 중복 행이 생기고 앞의 행은 영영 닫히지 않는다.
//
// 그래서 프로필(새우/농업)에 따라 이 표를 갈아 끼우지 않는다. 값이 한국어인
// 것은 역사적 사정이고(운영 DB 에 이미 이 문자열로 열린 알림이 있다), 바꾸면
// 마이그레이션 없이는 기존 행을 다시 찾지 못한다 — 한 글자도 바꾸지 않는다.
//
// 이름이 PARAM_LABELS 인 것도 같은 사정이다 — 이미 여러 곳에서 이 이름으로
// import 한다. 뜻은 "저장 키 표"이고, 화면 문구는 alertDisplayLabel 이 만든다.
export const PARAM_LABELS: Record<string, string> = {
  temperature: "수온",
  ph:          "pH",
  do_level:    "DO",
  salinity:    "염도",
  ammonia:     "암모니아",
  nitrite:     "아질산염",
  nitrate:     "질산염",
  alkalinity:  "알칼리도",
  turbidity:   "탁도",
  // 개체수 모니터링(카메라 비전) 경보. 수질과 같은 alerts 표에 쌓이므로
  // 라벨도 같은 자리에서 찾는다 — 알림함이 종류를 가리지 않고 이름을 붙일 수 있다.
  // 키는 vision/app/services/alert_service.py 의 PARAMETERS 와 짝이다.
  shrimp_count_drop:        "개체수 급감",
  shrimp_count_spike:       "개체수 급증",
  shrimp_count_low:         "개체수 임계 미만",
  shrimp_camera_offline:    "카메라 끊김",
  shrimp_count_do_critical: "개체수·용존산소 동시 이상",
}

/** 측정 항목 키 → 알림 행의 `parameter` 값(= 저장 키). 프로필과 무관하다. */
export function alertParameterKey(field: string): string {
  return PARAM_LABELS[field] ?? field
}

// 농업에서 뜻이 달라지는 항목의 **표시 라벨**. 키(위 표)가 아니라 사람이 읽는
// 문구만 덮는다 — 저장 키 "수온" 은 그대로 두고 화면에서 "양액 온도"로 읽는다.
const AGRI_DISPLAY_LABELS: Record<string, string> = {
  [PARAM_LABELS.temperature]: "양액 온도",
}

/** 저장된 `parameter` 키를 화면 문구로 바꾼다. 표시 시점에만 부른다. */
export function alertDisplayLabel(parameter: string, profile: FarmProfile = "shrimp"): string {
  return profile === "agriculture" ? (AGRI_DISPLAY_LABELS[parameter] ?? parameter) : parameter
}

type ThresholdKey = keyof typeof WQ_THRESHOLDS

/** 두 프로필 표가 공유하는 밴드 모양. 상수는 `as const` 라 각 값의 리터럴 타입이
 *  달라지므로, 표를 하나의 변수에 담으려면 이 폭으로 넓혀야 한다. */
type ThresholdBand = {
  readonly warning: { readonly min: number | null; readonly max: number | null }
  readonly danger:  { readonly min: number | null; readonly max: number | null }
}

export interface ThresholdAlert {
  parameter: string
  value: number
  threshold: number
  type: "danger" | "warning"
  message: string
}

/** 전역 임계값 판정.
 *
 *  두 번째 인자의 기본값이 "shrimp" 다 — 기존 호출부는 한 글자도 고치지 않아도
 *  이전과 완전히 같은 결과를 낸다(새우 회귀 0의 기계적 보증).
 *
 *  profile === "agriculture" 이면 판정 항목이 수온·pH·DO 3종으로 줄고 기준이
 *  AGRI_THRESHOLDS 로 바뀐다. 염도·암모니아·아질산염·질산염·알칼리도·탁도는
 *  판정 대상에서 아예 빠진다 — 농업 폼이 0 을 저장하므로 대개는 걸러지지만,
 *  옛 데이터나 혼입 값이 새우 기준으로 판정되는 것을 구조적으로 막는다. */
export function checkThresholds(
  values: Partial<Record<ThresholdKey, number>>,
  profile: FarmProfile = "shrimp",
): ThresholdAlert[] {
  const alerts: ThresholdAlert[] = []
  const agri = profile === "agriculture"
  const table: Partial<Record<ThresholdKey, ThresholdBand>> =
    agri ? AGRI_THRESHOLDS : WQ_THRESHOLDS

  for (const [param, value] of Object.entries(values) as [ThresholdKey, number][]) {
    if (value === 0 || !(param in table)) continue
    const t = table[param]!
    // key 는 저장·조회용(프로필 무관), label 은 문구용(프로필별).
    const key = alertParameterKey(param)
    const label = alertDisplayLabel(key, profile)

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
        parameter: key,
        value,
        threshold,
        type,
        message: `${label} ${value} — ${type === "danger" ? "위험 수준" : "주의 수준"} (기준: ${threshold})`,
      })
    }
  }

  return alerts
}

/** 이번 수신에서 **실제로 판정한** 항목들의 알림 키.
 *
 *  알림 복귀(해결 처리)는 여기 있는 키에 대해서만 해야 한다. checkThresholds 가
 *  건너뛴 값으로 알림을 닫으면 판정과 복귀가 비대칭이 되어, 전극이 물 밖으로
 *  나온 순간(0) 진짜 이탈 알림이 닫혀 버린다.
 *
 *  건너뛰는 조건은 checkThresholds 의 첫 줄과 **같아야 한다** — 두 곳이 어긋나면
 *  알림이 열린 채 굳거나 저 혼자 닫힌다. 그래서 같은 파일에 둔다. */
export function resolvableParameters(
  values: Partial<Record<ThresholdKey, number>>,
  profile: FarmProfile = "shrimp",
): string[] {
  const table: Partial<Record<ThresholdKey, ThresholdBand>> =
    profile === "agriculture" ? AGRI_THRESHOLDS : WQ_THRESHOLDS
  return (Object.entries(values) as [ThresholdKey, number | undefined][])
    .filter(([param, value]) =>
      // NaN 은 지금 라우트가 걸러 내지만(route.ts 의 Number.isFinite 검사) 여기서도
      // 막는다 — 새는 순간 그 항목의 열린 알림이 조용히 닫힌다.
      typeof value === "number" && Number.isFinite(value) && value !== 0 && param in table)
    .map(([param]) => alertParameterKey(param))
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

// ── 장비가 보낸 추세 이상징후 → 알림 ────────────────────────────────────
//
// detectTrendAnomalies 는 **브라우저**에서 돈다. 화면을 열어 둔 사람에게만 보이고
// 알림함에도 휴대폰에도 남지 않는다는 뜻이다. 그런데 임계값을 깨기 전에 잡는 것이
// 이 판정의 존재 이유라, 정작 그 결과가 관리자에게 닿지 않으면 반쪽이다.
//
// 그래서 **장비**(raspberry-pi/anomaly.py — 같은 판정의 파이썬 이식)가 찾은 것을
// 측정값과 함께 올려 보내면, 수신 라우트가 그것으로 알림을 만든다.
//
// 장비가 보낸 것을 그대로 믿지는 않는다. 아래 파서가 **항목·종류·등급만** 받고
// 문구는 서버가 짓는다 — 기기 키를 쥔 쪽이 알림함에 아무 글이나 띄우지 못하게.

/** 추세 알림의 저장 키는 임계값 알림과 **달라야 한다.**
 *  같으면 둘이 한 행을 두고 다투어, 추세 경고가 임계 경고를 덮거나 그 반대가 된다. */
const TREND_SUFFIX = " 추세"

/** 추세 알림이 쓸 수 있는 저장 키 전부. 복귀 처리에서 "보고되지 않은 것"을
 *  고르려면 가능한 키를 알아야 한다. */
export const TREND_ALERT_PARAMETERS: string[] =
  Object.keys(TREND_RULES).map(k => alertParameterKey(k) + TREND_SUFFIX)

const TREND_KINDS = new Set(["surge", "drift", "deviation"])

const TREND_KIND_TEXT: Record<string, string> = {
  surge:     "급변",
  drift:     "연속 악화",
  deviation: "평소 범위 이탈",
}

/** 추세 알림도 알림 행의 모양은 임계값 알림과 같다 — 수명 관리를 공유하므로
 *  같은 타입이어야 한다. 다른 것은 저장 키(접미사)와 문구뿐이다. */
export type TrendAlert = ThresholdAlert

/**
 * 장비가 보낸 추세 이상징후 문자열을 알림으로 바꾼다.
 *
 * 형식은 `항목:종류:등급:값` 을 쉼표로 이은 것이다. 중첩 JSON 이 아니라 한 줄짜리
 * 문자열인 이유는, 기기 카드에 남는 `last_payload` 가 스칼라만 보관해서 — 배열로
 * 보내면 나중에 "그때 장비가 뭘 보냈나" 를 볼 수 없다.
 *
 *     "do_level:surge:danger:3.10,ph:deviation:warning:7.42"
 *
 * 모르는 항목·종류·등급은 조용히 버린다. 기기 쪽이 먼저 올라가고 서버가 나중에
 * 올라가는 순서가 흔해서, 모르는 값에 500 을 내면 그동안 측정까지 멈춘다.
 */
export function parseTrendAlerts(raw: unknown, max = 3): TrendAlert[] {
  if (typeof raw !== "string" || !raw) return []
  const out: TrendAlert[] = []
  for (const part of raw.split(",")) {
    if (out.length >= max) break
    const [field, kind, type, valueText] = part.trim().split(":")
    if (!(field in TREND_RULES) || !TREND_KINDS.has(kind)) continue
    if (type !== "danger" && type !== "warning") continue
    // Number("") 은 0 이다. 빈 자리를 그대로 두면 "DO 0.00 급변" 같은 알림이 선다.
    // 0 은 이 저장소 규약상 "안 쟀다" 이고, 장비도 0 인 점은 판정에서 빼므로
    // 추세 알림에 0 이 실려 오는 일은 없다 — 오면 깨진 것이라 버린다.
    const value = Number(valueText)
    if (!valueText || !Number.isFinite(value) || value === 0) continue

    const label = PARAM_LABELS[field] ?? field
    const digits = TREND_RULES[field as ThresholdKey].digits
    out.push({
      parameter: label + TREND_SUFFIX,
      value,
      // 추세 판정에는 넘어선 선이 없다. 0 은 이 표의 "기준 없음" 자리다.
      threshold: 0,
      type,
      message: `${label} ${value.toFixed(digits)} — ${TREND_KIND_TEXT[kind]} 감지 (기준 이탈 전)`,
    })
  }
  return out
}

// ── 입력 누락(기록 끊김) 판정 ───────────────────────────────────────────
//
// 위의 세 판정(임계값·레시피·추세)은 모두 "값이 들어온 다음"에만 돌아간다.
// 값 자체가 끊기면 아무 판정도 돌지 않고, 화면은 마지막 기록을 그대로 띄운
// 채 조용해진다. 센서가 죽었거나 사람이 기록을 잊은 것이 가장 위험한데도
// 알림함은 비어 있다. 그래서 "조용해진 수조"를 따로 찾아 알린다.
//
// 72시간(3일)을 기준으로 삼는 근거:
//  · 수기 입력 농가는 매일 재지 않는다. 주 2~3회가 흔해서 24시간으로 잡으면
//    정상 운영 중인 농가에 매일 알림이 뜨고, 곧 알림 자체를 무시하게 된다.
//  · 센서 농가는 1분 주기라 3일 침묵이면 정전·통신 두절·기기 고장이 확실하다.
//    (기기 자체의 오프라인 표시는 sensor_devices.last_seen_at 이 따로 한다.)
//  · 금요일 마지막 기록이 월요일 아침까지 이어져도 오탐이 나지 않는,
//    주말을 견디는 가장 짧은 값이 3일이다.
export const MISSING_INPUT_HOURS = 72

/** 입력 누락 알림 행의 parameter 값.
 *
 *  이 문자열이 곧 식별자다 — 중복 방지(같은 수조에 열린 알림이 있으면 갱신만)와
 *  자동 해소(기록이 다시 들어오면 닫기)가 tank_id + 이 값으로 같은 알림을 찾는다.
 *  임계값 항목 라벨(수온·pH·DO…)과 절대 겹치지 않아야 한다. */
export const MISSING_INPUT_PARAMETER = "입력 누락"

/** 이 알림에 「측정값 / 기준」 줄을 붙여도 되는가.
 *
 *  둘은 붙이면 안 된다.
 *   · **입력 누락** — value 가 경과 시간이고 threshold 는 72시간이다. 그대로
 *     찍으면 "측정값 96 / 기준 72" 가 되어 수질 수치로 읽힌다.
 *   · **추세 알림** — 넘어선 선이 애초에 없다(threshold 0). "기준: 0" 은
 *     기준이 0 이라는 말로 읽혀, 멀쩡한 값이 0 을 넘겨 경고가 난 것처럼 보인다.
 *
 *  화면마다 조건을 따로 적으면 한쪽만 고쳐져 어긋나므로 판정과 같은 파일에 둔다. */
export function hasThresholdLine(parameter: string): boolean {
  return parameter !== MISSING_INPUT_PARAMETER && !parameter.endsWith(TREND_SUFFIX)
}

export interface MissingInputAlert {
  parameter: typeof MISSING_INPUT_PARAMETER
  /** 즉시성이 낮은 신호다 — 위험(danger)으로 올리면 진짜 수질 위험이 묻힌다. */
  type: "warning"
  /** 마지막 기록 이후 경과 시간(시간). 알림 행의 value 로 그대로 들어간다. */
  value: number
  /** 판정 기준(시간) = MISSING_INPUT_HOURS. */
  threshold: number
  message: string
}

const MD = (d: Date) => `${d.getMonth() + 1}월 ${d.getDate()}일`

/**
 * 이 수조가 "입력 누락" 상태인가.
 *
 * @param tank            이름·상태·등록 시각. 상태가 inactive 면 판정하지 않는다 —
 *                        입식 전이거나 수확이 끝나 비워 둔 수조라 기록이 없는 게 정상이다.
 * @param lastRecordedAt  마지막 수질 기록 시각. 한 번도 없으면 null 을 넘긴다.
 *                        이때는 수조 등록 시각(created_at)을 기준으로 센다 —
 *                        방금 등록한 수조에 곧바로 알림이 뜨면 안 된다.
 * @returns 알림이 필요하면 내용, 아니면 null(=정상이거나 판정 대상이 아님).
 */
export function checkMissingInput(
  tank: { name: string; status?: string | null; created_at?: string | null },
  lastRecordedAt: string | number | Date | null | undefined,
  now: number = Date.now(),
): MissingInputAlert | null {
  if (tank.status === "inactive") return null

  const ref = lastRecordedAt ?? tank.created_at ?? null
  if (ref === null) return null
  const refMs = new Date(ref).getTime()
  if (!Number.isFinite(refMs)) return null

  const elapsedH = (now - refMs) / H
  if (elapsedH < MISSING_INPUT_HOURS) return null

  const days = Math.floor(elapsedH / 24)
  const name = tank.name || "수조"
  const message = lastRecordedAt
    ? `${name} — ${days}일째 수질 기록이 없습니다 (마지막 기록 ${MD(new Date(refMs))}). 측정값을 입력하거나 센서 상태를 확인하세요.`
    : `${name} — 등록 후 ${days}일 동안 수질 기록이 한 번도 없습니다. 첫 측정값을 입력하세요.`

  return {
    parameter: MISSING_INPUT_PARAMETER,
    type: "warning",
    value: Math.round(elapsedH),
    threshold: MISSING_INPUT_HOURS,
    message,
  }
}

/** 지금 열려 있는 입력 누락 알림 한 줄. */
export interface MissingInputOpenAlert {
  id: string
  tank_id: string
  /** 마지막으로 기록해 둔 경과 시간. 달라졌을 때만 갱신한다. */
  value: number | null
}

/** 무엇을 새로 만들고, 무엇만 갱신하고, 무엇을 닫을지. */
export interface MissingInputPlan {
  insert: {
    tank_id: string
    type: "warning"
    parameter: string
    value: number
    threshold: number
    message: string
    resolved: false
  }[]
  refresh: { id: string; value: number; message: string }[]
  resolve: string[]
}

/**
 * 수조 목록 · 마지막 기록 시각 · 열려 있는 알림을 놓고, 무엇을 할지 정한다.
 *
 * DB 를 건드리지 않는 순수 함수다 — 판정과 쓰기를 갈라 두어야 시나리오를
 * 그대로 돌려 볼 수 있다. 실제 쓰기는 lib/db.ts 의 syncMissingInputAlerts 가 한다.
 *
 * 규칙은 센서 수신 경로(app/api/sensors/data/route.ts)와 같다.
 *   · 열린 알림이 있으면 새로 만들지 않는다(중복 방지). 경과 일수만 갱신한다.
 *   · 판정이 풀리면(기록 복귀·수조 비움) 닫는다(자동 해소).
 *   · 어쩌다 같은 수조에 두 줄이 생겼으면 가장 오래된 한 줄만 남기고 닫는다.
 *
 * @param openAlerts 오래된 것부터(created_at ASC) 정렬되어 있어야 한다.
 */
export function planMissingInputAlerts(
  tanks: { id: string; name: string; status?: string | null; created_at?: string | null }[],
  lastRecordedAt: Map<string, string | null>,
  openAlerts: MissingInputOpenAlert[],
  now: number = Date.now(),
): MissingInputPlan {
  const plan: MissingInputPlan = { insert: [], refresh: [], resolve: [] }

  const openByTank = new Map<string, MissingInputOpenAlert[]>()
  for (const a of openAlerts) {
    const list = openByTank.get(a.tank_id)
    if (list) list.push(a); else openByTank.set(a.tank_id, [a])
  }

  for (const tank of tanks) {
    const open = openByTank.get(tank.id) ?? []
    // 같은 순간에 두 탭이 만들어 버린 중복 — 가장 오래된 한 줄만 남긴다.
    if (open.length > 1) plan.resolve.push(...open.slice(1).map(a => a.id))

    const verdict = checkMissingInput(tank, lastRecordedAt.get(tank.id) ?? null, now)

    if (!verdict) {
      // 기록이 다시 들어왔거나 수조를 비웠다.
      if (open.length > 0) plan.resolve.push(open[0].id)
      continue
    }
    if (open.length > 0) {
      if (open[0].value !== verdict.value) {
        plan.refresh.push({ id: open[0].id, value: verdict.value, message: verdict.message })
      }
      continue
    }
    plan.insert.push({
      tank_id: tank.id,
      type: verdict.type,
      parameter: verdict.parameter,
      value: verdict.value,
      threshold: verdict.threshold,
      message: verdict.message,
      resolved: false,
    })
  }

  return plan
}

// ── 주요 원인 후보 ──────────────────────────────────────────────────────
//
// 판정은 "무엇이 잘못됐나"까지만 말한다. 현장에서 필요한 다음 한 걸음은
// "왜 그렇게 됐나" 다 — 그 후보를 항목별·방향별로 적어 둔다.
//
// 출처는 이 저장소가 이미 쓰고 있는 규칙 기반 권고문(app/api/ai-advisor/route.ts
// 의 buildDoResponse·buildAmmoniaResponse·buildTurbidityResponse·buildWaterChangeResponse)
// 과 흰다리새우 사육수 관리의 확립된 사실(질산화가 알칼리도를 소모한다, 광합성이
// 주간 pH 를 올린다 등)이다. 근거가 약한 항목은 억지로 채우지 않고 2~3개만 둔다.
//
// 문구를 여기 한국어 상수로 두는 이유는 판정 문구(checkThresholds·
// detectTrendAnomalies 의 message)가 이미 그렇기 때문이다. 원인 후보만 i18n 으로
// 빼면 같은 카드 안에서 한 줄은 번역되고 한 줄은 안 되는 상태가 된다.
// 판정 문구 전체를 번역하는 일은 별도 과제로 함께 가는 편이 맞다.

/** 값이 오를 때(up)와 내릴 때(down) 각각 무엇을 먼저 의심할지. */
export interface CauseCandidates {
  up: string[]
  down: string[]
}

const CAUSE_CANDIDATES: Record<ThresholdKey, CauseCandidates> = {
  temperature: {
    up:   ["기온 상승·직사일광", "히터 과작동 또는 쿨러 정지", "수온이 높은 물로 환수"],
    down: ["기온 급강하·강우 유입", "히터 정지 또는 고장", "수온이 낮은 물로 환수"],
  },
  ph: {
    up:   ["광합성 일주기 — 주간 CO₂ 소모", "플랑크톤·조류 과다 번성", "pH 가 높은 물로 환수"],
    down: ["알칼리도 부족으로 완충력 저하", "야간 호흡·유기물 분해로 CO₂ 축적", "질산화 진행에 따른 산 생성"],
  },
  do_level: {
    up:   ["주간 광합성으로 인한 과포화", "폭기 과다"],
    down: ["수온 상승 — 1℃ 상승 시 포화 DO 약 0.2 mg/L 감소", "유기물 축적에 따른 산소 소모", "고밀도 사육으로 대사량 증가", "폭기 효율 저하 — 에어스톤 막힘·블로워 노화"],
  },
  salinity: {
    up:   ["고수온·건조로 인한 증발 농축", "염도가 높은 해수로 환수", "담수 보충 부족"],
    down: ["강우 유입·유출수 혼입", "염도가 낮은 물로 환수", "지하수·보충수 과다 투입"],
  },
  ammonia: {
    up:   ["잔사·폐사체 등 유기물 축적", "생물여과 효율 저하", "급이 과잉으로 미섭이 사료 분해"],
    down: ["환수·미생물제 투입 효과", "생물여과 정상화"],
  },
  nitrite: {
    up:   ["질산화 2단계(아질산→질산) 미성숙", "여재 교체·소독 직후 질산화 세균 감소", "환수 부족으로 축적"],
    down: ["환수 실시", "질산화 세균 정착 진행"],
  },
  nitrate: {
    up:   ["질산화 최종산물 누적", "환수 부족", "급이량 과다"],
    down: ["환수 실시", "조류 흡수·탈질"],
  },
  alkalinity: {
    up:   ["석회·중탄산나트륨 등 완충제 과다 투입", "알칼리도가 높은 원수 유입"],
    down: ["질산화 과정의 알칼리도 소모", "환수·보충 부족", "알칼리도가 낮은 원수 사용"],
  },
  turbidity: {
    up:   ["사료 잔사·미섭이 사료 증가", "저질(슬러지) 부유", "플랑크톤 과다 번성", "여과·스키머 효율 저하"],
    down: ["환수·여과로 부유물 제거", "플랑크톤 급감(수색 변화 동반)"],
  },
}

/** 화면에 쓰는 라벨("수온")과 DB 컬럼 키("temperature") 둘 다로 찾을 수 있게.
 *  판정 결과의 parameter 는 라벨이지만, 목데이터 알림은 컬럼 키를 쓴다. */
const CAUSE_KEY_BY_NAME: Record<string, ThresholdKey> = (() => {
  const map: Record<string, ThresholdKey> = {}
  for (const key of Object.keys(CAUSE_CANDIDATES) as ThresholdKey[]) {
    map[key] = key
    const label = PARAM_LABELS[key]
    if (label) map[label] = key
  }
  return map
})()

/**
 * 이 항목이 이 방향으로 움직인 주요 원인 후보.
 *
 * @param parameter 항목 이름. 라벨("암모니아")과 컬럼 키("ammonia") 둘 다 받는다.
 * @param direction 값이 오른 쪽인지 내린 쪽인지.
 * @returns 원인 후보. 표에 없는 항목(EC 등)이면 빈 배열 — 화면은 이때 아무것도 그리지 않는다.
 */
export function causeCandidates(parameter: string, direction: "up" | "down"): string[] {
  const key = CAUSE_KEY_BY_NAME[parameter]
  if (!key) return []
  return CAUSE_CANDIDATES[key][direction]
}

/** 이상징후 한 건의 원인 후보. 기준값보다 올라갔는지 내려갔는지로 방향을 잡는다. */
export function anomalyCauses(a: Pick<TrendAnomaly, "parameter" | "value" | "reference">): string[] {
  return causeCandidates(a.parameter, a.value >= a.reference ? "up" : "down")
}

/** 임계값 초과 알림 한 건의 원인 후보. 상한을 넘었으면 up, 하한을 밑돌면 down. */
export function thresholdAlertCauses(a: { parameter: string; value: number; threshold: number }): string[] {
  return causeCandidates(a.parameter, a.value >= a.threshold ? "up" : "down")
}
