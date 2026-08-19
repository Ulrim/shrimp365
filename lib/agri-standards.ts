// 수경재배(농업) 화면 표시용 기준값.
//
// `lib/mock-data.ts` 의 `WATER_QUALITY_STANDARDS` 는 새우 화면의 배지·차트
// 기준선용 상수다. 값이 `lib/thresholds.ts` 와 겹치지만 **통합하지 않는다** —
// 통합하면 새우 화면의 기준선이 미세하게 움직여 회귀가 된다(설계서 3-6).
// 그래서 농업용 표시 기준을 여기에 따로 둔다. 새우 상수는 한 글자도 안 바꾼다.
//
// **농업 쪽은 반대로 한다 — 표시 기준을 알림 기준에서 파생시킨다.**
// 예전에는 표시용 숫자를 여기에 손으로 적었고("정상 범위는 좁고 경보선은 넓다"),
// 그 결과 카드는 위험인데 알림은 warning 이거나 아예 없는 조합이 생겼다:
//   DO 3.0 ppm → 카드 위험 / 알림 warning
//   양액 온도 27 ℃ → 카드 위험 / 알림 warning
//   DO 12 초과  → 카드 위험 / 알림 **없음**(do_level.max 가 null 이므로)
// 농가는 빨간 카드를 보는데 알림은 오지 않는다. 어느 쪽도 믿을 수 없게 된다.
// 그래서 숫자는 한 곳(AGRI_THRESHOLDS)에만 적고 여기서는 뜻만 옮긴다:
//
//   화면 "정상"   = 알림이 안 뜨는 구간            = warning 밴드 안
//   화면 "주의"   = warning 알림이 뜨는 구간       = danger 밴드 안 / warning 밖
//   화면 "위험"   = danger 알림이 뜨는 구간        = danger 밴드 밖
//
// 기준을 고칠 일이 생기면 lib/thresholds.ts 의 AGRI_THRESHOLDS 만 고친다.
// 여기에 숫자를 다시 적기 시작하는 순간 위의 어긋남이 그대로 돌아온다.
//
// **EC·유량·차압에는 항목 자체가 없다.** 전역 EC 기준선을 긋지 않는다는 원칙
// (개정 1부터) 때문이고, 유량·차압은 정상값이 베드 규모·배관 길이마다 달라
// 전역 상수로 쓸 수 있는 숫자가 없다. 기준이 없는 항목은 색을 칠하지 않고
// "기준 없음" 중립으로 표시한다 — 틀린 기준은 없는 기준보다 나쁘다.
// (유량 0 만은 예외다. 아래 AGRI_ZERO_MEANING 주석 참고.)
import { AGRI_THRESHOLDS } from "@/lib/thresholds"

/** 표시용 기준 밴드. `null` 은 "그쪽으로는 상한/하한이 없음". */
export interface AgriStandard {
  min: number | null
  max: number | null
  warning_min: number | null
  warning_max: number | null
  unit: string
}

const fromThresholds = (key: keyof typeof AGRI_THRESHOLDS, unit: string): AgriStandard => {
  const t = AGRI_THRESHOLDS[key] as {
    warning: { min: number | null; max: number | null }
    danger:  { min: number | null; max: number | null }
  }
  return {
    min: t.warning.min, max: t.warning.max,
    warning_min: t.danger.min, warning_max: t.danger.max,
    unit,
  }
}

export const AGRI_QUALITY_STANDARDS: Record<"temperature" | "ph" | "do_level", AgriStandard> = {
  temperature: fromThresholds("temperature", "°C"),
  ph:          fromThresholds("ph", ""),
  do_level:    fromThresholds("do_level", "ppm"),
}

export type AgriStdKey = keyof typeof AGRI_QUALITY_STANDARDS

// ── 0 의 뜻은 항목마다 다르다 ────────────────────────────────────────────
//
// 전에는 `value === 0` 이면 전부 "미측정"이었다. EC·pH 에서는 맞는 판단이지만
// (전극이 물 밖으로 나오면 0 을 보낸다. 양액 EC 가 0 일 수는 없다) 유량에서는
// 정반대다 — **유량 0 = 펌프 정지**, 수경재배에서 가장 위급한 값인데 화면에는
// "—(미측정)"으로 떴다.
//
// 갈리는 기준은 "0 과 '안 쟀다'를 구별할 수 있는가"다.
//
//   flow_rate · diff_pressure : water_quality_readings 에서 **nullable** 컬럼이고
//     입력 폼도 빈 칸을 null 로 저장한다. 0 은 "쟀더니 0" 이다 → measured.
//
//   temperature · ph · do_level : 폼이 빈 칸을 0 으로 저장하고(`parseFloat(...) || 0`)
//     읽는 쪽도 0 으로 채운다. 0 은 압도적으로 "안 쟀다"이지, 결빙(0 ℃)이나
//     무산소(0 ppm)가 아니다. 0 을 실측으로 읽으면 안 잰 항목이 전부 위험으로
//     뜬다. 알림 쪽(checkThresholds)도 0 을 판정에서 건너뛰므로 화면만 위험으로
//     칠하면 2번 어긋남이 되살아난다 → missing.
//     · 한계: 진짜 DO 0 ppm(무산소)을 놓친다.
//     · 고치려면 — **마이그레이션이 아니다.** 이 셋은 스키마상 이미 nullable 이다
//       (schema.sql 의 `temperature NUMERIC`). 0 을 만드는 것은 DB 가 아니라
//       lib/db.ts toWaterQuality 의 `?? 0` 과 WaterQualityReading 의 `number` 타입이다.
//       (a) `?? 0` 제거 (b) 타입을 `number | null` 로 (c) `.toFixed()` 를 부르는
//       차트·카드 전 지점에 null 가드 — (c) 를 빠뜨리면 예전 buildCompareData 와
//       같은 크래시가 9개 항목으로 늘어난다. 별도 커밋감이다.
//
//   conductivity : nullable 이지만 0 은 실측으로 치지 않는다. 양액 EC 0 은
//     물리적으로 불가능하고(순수한 물도 아니다), 센서가 물 밖에서 0 을 보낸다.
//     checkRecipe 도 같은 판단을 한다 → missing.
export type AgriZeroMeaning = "missing" | "measured"

export const AGRI_ZERO_MEANING: Record<string, AgriZeroMeaning> = {
  conductivity:  "missing",
  ph:            "missing",
  temperature:   "missing",
  do_level:      "missing",
  flow_rate:     "measured",
  diff_pressure: "measured",
}

/** 이 항목에서 0 이 실측값인가. 모르는 항목은 보수적으로 missing. */
export const agriZeroIsMeasured = (key: string): boolean =>
  AGRI_ZERO_MEANING[key] === "measured"

/** 화면에 값을 못 쓰는 상태인가(= "—" 로 찍을 것인가). */
export const agriIsMissing = (key: string, value: number | null | undefined): boolean =>
  value == null || (value === 0 && !agriZeroIsMeasured(key))

// ── 폼 입력 정규화 — 빈 칸과 "0" 을 구별한다 ─────────────────────────────
//
// `values.flow_rate ? Number(...) : null` 은 원시 문자열의 truthiness 라
// "0" 도 truthy 다. 반대로 `parseFloat(x) || null` 을 쓰면 0 이 null 로
// 뭉개진다. 둘 다 위험한데 위험한 방향이 항목마다 다르다 — 유량 "0"(펌프 정지)은
// 반드시 살려야 하고 EC "0" 은 저장하면 차트가 바닥으로 처진다.
// 그래서 "빈 칸인가"만 문자열로 보고, 0 의 처리는 위 표에 맡긴다.

/** 폼 문자열 → 숫자 또는 null. **빈 칸만 null**이다. "0" 은 0 으로 살아남는다. */
export function agriNumOrNull(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim()
  if (s === "") return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** 폼의 EC(mS/cm 문자열) → 저장값(µS/cm) 또는 null.
 *  빈 칸도 0 도 null 이다 — EC 0 은 실측이 아니다(AGRI_ZERO_MEANING). */
export function agriEcToMicroSiemens(raw: string | null | undefined): number | null {
  const n = agriNumOrNull(raw)
  if (n == null || n === 0) return null
  return Math.round(n * 1000)
}

// ── 상태 표현 4종 — 중립("기준 없음"·"미측정")이 신규다 ────────────────────
//
// 새우 배지는 정상/주의/위험 3색뿐이라 "판정할 기준이 아예 없는 항목"을
// 표현할 수단이 없다. 그 항목을 emerald 로 칠하면 거짓 안심이고 red 로 칠하면
// 지금 그대로의 오탐이다. 그래서 네 번째 표현을 둔다.
//
// 구분 수단을 **셋 동시에** 쓴다(색만으로 의미를 전달하지 않는다):
//   색(무채색) + 점 모양(속 빈 원) + 텍스트("기준 없음"/"미측정")
// animate-pulse 는 주의·위험에만 — 중립이 깜빡이면 "뭔가 문제"로 읽힌다.
//
// 새우 STATUS_STYLES(water-quality-view.tsx) 값은 한 글자도 바꾸지 않는다.
// 농업이 `-600 dark:-400` 을 쓰는 것은 대비 4.5:1 을 맞추기 위한 **의도된
// 차이**다(amber-500 은 밝은 배경에서 약 2.1:1). 같게 맞추라는 리뷰 금지.
export type AgriStatusLevel = "정상" | "주의" | "위험" | "기준없음" | "미측정"

export const AGRI_STATUS_STYLES: Record<AgriStatusLevel, { dot: string; text: string; bg: string }> = {
  정상:   { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  주의:   { dot: "bg-amber-500",   text: "text-amber-600 dark:text-amber-400",     bg: "bg-amber-500/10 border-amber-500/20" },
  위험:   { dot: "bg-red-500",     text: "text-red-600 dark:text-red-400",         bg: "bg-red-500/10 border-red-500/20" },
  기준없음: { dot: "bg-transparent border border-muted-foreground/50", text: "text-muted-foreground", bg: "bg-muted border-border" },
  미측정:  { dot: "bg-transparent border border-muted-foreground/50", text: "text-muted-foreground", bg: "bg-muted border-border" },
}

/** 주의·위험만 깜빡인다. */
export const agriStatusPulses = (s: AgriStatusLevel) => s === "주의" || s === "위험"

export interface AgriRecipe {
  target_ec?: number | null
  ec_tolerance?: number | null
  target_ph?: number | null
  ph_tolerance?: number | null
}

/** 열린 밴드 포함 검사. 경계값은 안쪽으로 친다(AGRI_THRESHOLDS 와 같은 부등호). */
const inBand = (v: number, lo: number | null, hi: number | null) =>
  (lo == null || v >= lo) && (hi == null || v <= hi)

/** 농업 항목 판정 — 위에서부터 먼저 걸리는 것이 이긴다.
 *
 *  1. 값이 없으면 `미측정`. 0 은 **항목에 따라** 미측정이거나 실측이다
 *     (AGRI_ZERO_MEANING — EC·pH·수온·DO 는 미측정, 유량·차압은 실측).
 *  2. 유량 0 → `위험`. 유량에는 전역 기준선이 없지만(정상값이 베드마다 다르다)
 *     "정지"는 기준선이 아니라 사실이다. 어느 베드에서도 순환 유량 0 은 정상이
 *     아니다. 0 이 아닌 유량은 여전히 `기준없음` — 숫자 기준을 만들지 않는다.
 *  3. 레시피 목표가 있으면(EC·pH) `|v−target| ≤ tol` 정상, `≤ 2×tol` 주의,
 *     그 밖 위험 — **checkRecipe 와 같은 규칙**. 화면 판정과 알림 판정이
 *     어긋나면 농가는 둘 다 믿지 않는다.
 *  4. AGRI_QUALITY_STANDARDS 에 기준이 있으면 그것으로(= AGRI_THRESHOLDS 파생).
 *  5. 그 밖(레시피 없는 EC·차압) → `기준없음`. 색을 칠하지 않는다.
 *
 *  conductivity 는 µS/cm 단위로 넘긴다(DB 저장값 그대로). */
export function getAgriStatus(
  key: string,
  value: number | null | undefined,
  recipe?: AgriRecipe | null,
): AgriStatusLevel {
  if (agriIsMissing(key, value)) return "미측정"
  const v = value as number

  // 유량 0 = 펌프 정지. 알림을 못 만드는 항목이라 화면이 유일한 신호다.
  if (key === "flow_rate") return v === 0 ? "위험" : "기준없음"

  const byRecipe = (target: number, tol: number): AgriStatusLevel => {
    const diff = Math.abs(v - target)
    if (diff <= tol) return "정상"
    return diff <= 2 * tol ? "주의" : "위험"
  }

  if (key === "conductivity") {
    return recipe?.target_ec != null
      ? byRecipe(recipe.target_ec, recipe.ec_tolerance ?? 100)
      : "기준없음"
  }
  if (key === "ph" && recipe?.target_ph != null) {
    return byRecipe(recipe.target_ph, recipe.ph_tolerance ?? 0.5)
  }
  if (key === "ph" || key === "temperature" || key === "do_level") {
    const std = AGRI_QUALITY_STANDARDS[key as AgriStdKey]
    if (inBand(v, std.min, std.max)) return "정상"
    if (inBand(v, std.warning_min, std.warning_max)) return "주의"
    return "위험"
  }
  // 차압: 0 은 실측이지만(막힘은 차압이 **오를** 때 생긴다) 판정할 기준이 없다.
  return "기준없음"
}
