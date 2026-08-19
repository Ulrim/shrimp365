// 수경재배(농업) 화면 표시용 기준값.
//
// `lib/mock-data.ts` 의 `WATER_QUALITY_STANDARDS` 는 새우 화면의 배지·차트
// 기준선용 상수다. 값이 `lib/thresholds.ts` 와 겹치지만 **통합하지 않는다** —
// 통합하면 새우 화면의 기준선이 미세하게 움직여 회귀가 된다(설계서 3-6).
// 그래서 농업용 표시 기준을 여기에 따로 둔다. 새우 상수는 한 글자도 안 바꾼다.
//
// 판정 기준(`AGRI_THRESHOLDS`)과 값이 다른 이유: 저쪽은 **알림을 만드는** 선이고
// 이쪽은 **화면에 정상이라고 쓰는** 선이다. 정상 범위는 좁고 경보선은 넓다.
//
// **EC·유량·차압에는 항목 자체가 없다.** 전역 EC 기준선을 긋지 않는다는 원칙
// (개정 1부터) 때문이고, 유량·차압은 정상값이 베드 규모·배관 길이마다 달라
// 전역 상수로 쓸 수 있는 숫자가 없다. 기준이 없는 항목은 색을 칠하지 않고
// "기준 없음" 중립으로 표시한다 — 틀린 기준은 없는 기준보다 나쁘다.
export const AGRI_QUALITY_STANDARDS = {
  temperature: { min: 18,  max: 24,   warning_min: 16,  warning_max: 26,   unit: "°C" },
  ph:          { min: 5.5, max: 6.5,  warning_min: 5.0, warning_max: 7.0,  unit: "" },
  do_level:    { min: 5.0, max: 10.0, warning_min: 4.0, warning_max: 12.0, unit: "ppm" },
} as const

export type AgriStdKey = keyof typeof AGRI_QUALITY_STANDARDS

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

/** 농업 항목 판정 — 위에서부터 먼저 걸리는 것이 이긴다.
 *
 *  1. 값이 null/0 → `미측정`. EC 0 은 "EC 가 0" 이 아니라 "전극이 물 밖" 이다
 *     (lib/thresholds.ts checkRecipe 와 같은 판단).
 *  2. 레시피 목표가 있으면(EC·pH) `|v−target| ≤ tol` 정상, `≤ 2×tol` 주의,
 *     그 밖 위험 — **checkRecipe 와 같은 규칙**. 화면 판정과 알림 판정이
 *     어긋나면 농가는 둘 다 믿지 않는다.
 *  3. AGRI_QUALITY_STANDARDS 에 기준이 있으면 그것으로.
 *  4. 그 밖(레시피 없는 EC·유량·차압) → `기준없음`. 색을 칠하지 않는다.
 *
 *  conductivity 는 µS/cm 단위로 넘긴다(DB 저장값 그대로). */
export function getAgriStatus(
  key: string,
  value: number | null | undefined,
  recipe?: AgriRecipe | null,
): AgriStatusLevel {
  if (value == null || value === 0) return "미측정"

  const byRecipe = (target: number, tol: number): AgriStatusLevel => {
    const diff = Math.abs(value - target)
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
    if (value >= std.min && value <= std.max) return "정상"
    if (value >= std.warning_min && value <= std.warning_max) return "주의"
    return "위험"
  }
  return "기준없음"
}
