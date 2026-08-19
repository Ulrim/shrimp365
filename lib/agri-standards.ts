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
