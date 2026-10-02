// 엔진 1 — 생육 성장곡선. 순수 계산 모듈이다.
//
// DB 조회도 화면도 문장 생성도 여기 없다. 입력을 인자로 받아 구조를 돌려주고,
// 끝이다 — raspberry-pi/advice.py 가 문장을 만들지 않고 코드만 돌려주는 것과
// 같은 원칙이다. 다국어 문구는 엔진 6 리포트가 이 위에 올라가 맡는다.
//
// ── 설계 규칙 — 어기면 안 된다 ────────────────────────────────────────────
// 근거는 docs/plans/tips-2026-dataset-assessment.md 2절. 재현 스크립트는
// scripts/analysis/growth_curve_feasibility.py 이고, 이 구현이 그 수치를
// 되찾는지는 scripts/growth/verify.mjs 가 확인한다.
//
//  1. Winf 를 자유 파라미터로 두지 않는다. 호출자가 넘기거나 기본값 25 g.
//     자유로 두면 홀드아웃 MAE 14.02 g — 19.7 g 을 91.8 g 으로 예측한다.
//     **이 모듈에 자유 적합 경로는 없다.**
//  2. 7.5 g 이상 구간만으로 예측 모델을 적합한다(Powell 2020 의 stanza break).
//  3. 규칙 1·2 는 반드시 같이 쓴다. 구간만 끊고 Winf 를 풀면 15.51 g 으로 가장
//     나쁘다. fitGompertz 의 기본값이 둘을 함께 적용한 상태다.
//  4. 시간축은 TGC — 기준온도를 차감하지 않는다(base 0). 튜닝 금지.
//  5. 성능은 R² 로 보고하지 않는다. 홀드아웃 MAE 로만 본다. 전 구간 R² 0.99 와
//     MAE 32 g 이 동시에 나온다 — 그래서 이 모듈은 R² 함수를 내보내지 않는다.
//
// ── 기대 성능(수용 기준) ──────────────────────────────────────────────────
// 7.5 g 이상 · Winf 25 g · 홀드아웃(앞 70% → 뒤 30%) 기준
//   수조 5개 평균 MAE 0.90 g · 수조 {1,2,3} 평균 0.99 g
// 이보다 나쁘면 모델을 의심하기 전에 구현을 의심한다.

export { BASE_TEMP_C, STANZA_BREAK_G, DEFAULT_WINF_G, MIN_FIT_SAMPLES } from "./constants"

export { cumulativeDegreeDays, dateKey } from "./degree-days"
export type { DailyWaterTemp, DegreeDayPoint, DegreeDayAxis } from "./degree-days"

export { fitGompertz, predictAbw, cddForAbw, meanAbsoluteErrorG } from "./gompertz"
export type {
  GrowthPoint,
  GompertzParams,
  GompertzFit,
  FitOptions,
  FitFailure,
  FitMethod,
  ExclusionReason,
  ExcludedPoint,
  CddForAbwResult,
  CddForAbwFailure,
} from "./gompertz"
