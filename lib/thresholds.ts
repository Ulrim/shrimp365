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
const ALERT_PARAM_KEYS: Record<string, string> = {
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

/** 측정 항목 키 → 알림 행의 `parameter` 값(= 저장 키). 프로필과 무관하다. */
export function alertParameterKey(field: string): string {
  return ALERT_PARAM_KEYS[field] ?? field
}

// 농업에서 뜻이 달라지는 항목의 **표시 라벨**. 키(위 표)가 아니라 사람이 읽는
// 문구만 덮는다 — 저장 키 "수온" 은 그대로 두고 화면에서 "양액 온도"로 읽는다.
const AGRI_DISPLAY_LABELS: Record<string, string> = {
  [ALERT_PARAM_KEYS.temperature]: "양액 온도",
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
    .filter(([param, value]) => typeof value === "number" && value !== 0 && param in table)
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
