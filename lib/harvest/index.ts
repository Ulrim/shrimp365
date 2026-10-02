// 엔진 3 — 출하 윈도우. 순수 계산 모듈이다.
//
// DB 조회도 화면도 라우트도 외부 API 도 문장 생성도 여기 없다. 입력을 인자로
// 받아 구조를 돌려주고 끝이다. 엔진 1(lib/growth) · 엔진 2(lib/profitability) ·
// 크기별 단가(lib/pricing) 위에 올라가고, **엔진 2 의 Exclusion 어휘를 그대로
// 쓴다.** 새 경고 체계를 만들지 않았다.
//
// ── 이 엔진이 답하는 질문 ────────────────────────────────────────────────
// **"지금 출하할까, 2주 더 키울까."**
//
// 더 키우면 개체가 커지고(엔진 1), 큰 개체는 kg당 단가가 높다(단가 모델).
// 그런데 그동안 사료와 전기를 더 먹고(엔진 2), **그 사이 새우가 죽는다.**
// 이 저울질이 엔진 3 의 전부다.
//
//     이익(d) = 마리수(0)·s^d · 개체중(d)/1000 · 단가(개체중(d))
//               − 누적비용 − 추가비용(0→d)
//               └ s^d 가 빠지면 엔진이 **항상 "더 키우라"** 고 말한다
//
// ── 설계 규칙 — 어기면 안 된다 ───────────────────────────────────────────
//  1. **점이 아니라 구간으로 답한다.** 엔진 1 의 홀드아웃 MAE 0.895 g 은 출하
//     크기 20~28 g 에서 3~5% 오차이고, 단가 탄력성도 0.63~0.73 밴드다.
//     "11월 20일에 출하하십시오" 라고 점으로 답하면 그 답의 신뢰도를 사용자가
//     알 수 없다(dataset-assessment 2-6 규칙 5). 추천은 `recommended` 의
//     **구간**이고, 후보마다 이익이 **밴드**로 나간다. 밴드가 겹치면
//     `indistinguishableWithinWindow: true` 다 — **억지로 하루를 고르지 않는다.**
//  2. **폐사를 빼먹지 않는다.** 일별 생존율을 인자로 받고, **안 받으면 0 으로
//     가정하지 않고** 천황수산 환산 기본값(0.448^(1/268) ≈ 0.9970, 하루 약
//     0.30%)으로 떨어지며 `harvest_daily_survival_default` ·
//     `survival_rate_assumed` 를 올린다. 그 기본값이 **농가·시기마다 다르다**는
//     것은 constants.ts 에 적혀 있다.
//  3. **단가 앵커는 농가 수취 단계여야 한다.** 소매 앵커가 들어오면
//     **거부하거나 변환한다** — 그냥 통과시키는 경로가 없다(price.ts).
//     통과시키면 농가 수익이 약 1.9배 과대가 된다.
//  4. **관측 범위 밖 경고를 무시하지 않는다.** 사다리 관측 범위는 23.5~33.3 g
//     이고, 후보가 그 밖이면 `price_target_outside_observed_size` 가 후보에
//     붙고 **결과의 exclusions 까지 따라 올라간다.**
//  5. **계절항은 0 이다.** 단가 모델에 달을 받는 인자가 아예 없다. **엔진 3 이
//     계절 보정을 자체적으로 만들어 넣지 않는다.** 그 사실은 후보마다
//     `price_seasonality_not_modeled` 로 나간다.
//  6. **문장을 만들지 않는다.** 판정은 코드(`HarvestDecisionCode`)이고 번역은
//     화면(엔진 6)이 맡는다. raspberry-pi/advice.py 와 같은 원칙이다.
//  7. **반올림하지 않는다. 모르는 값을 0 으로 채우지 않는다.** 엔진 1·2·단가와
//     같다 — 안 받은 추가 비용은 0 이 아니라 null 이고, 기준일을 안 받으면
//     날짜 칸은 null 이다(엔진이 `new Date()` 로 오늘을 정하지 않는다).
//
// ── 밴드는 「신뢰구간」이 아니다 ─────────────────────────────────────────
// 분포 가정도 표본 추출도 없다. **「입력 양끝을 넣었을 때 나오는 양끝」** 이다.
// 엔진 1 은 예측구간을 돌려주지 않고 홀드아웃 MAE 하나뿐이며 R² 는 설계로 막아
// 두었다 — 「95% 신뢰구간」은 우리가 갖지 않은 정밀도의 주장이다. 그래서 폭이
// 어디서 왔는지를 `band.sources` 로 구분해 돌려준다("price_elasticity" /
// "abw_uncertainty"). 기본은 단가 탄력성만이고, 그때 개체중 폭이 0 이라는
// 사실이 `harvest_abw_uncertainty_not_in_band` 로 나간다.
//
// ── 이 엔진이 하지 않는 일 ───────────────────────────────────────────────
//  · 금액 산식을 다시 쓰지 않는다 — 엔진 2 의 projectHarvestScenarios ·
//    computeCost 를 부른다(candidate.ts 머리주석).
//  · 단가 기울기를 적합하지 않는다 — lib/pricing 이 한다.
//  · 성장곡선을 다시 쓰지 않는다 — 엔진 1 의 predictAbw 를 부른다.
//  · 권장 급이량을 만들지 않는다 — 엔진 5 다. 일급이량은 인자로 받는다.
//  · 리스크 경보를 만들지 않는다 — 엔진 4 다.
//  · 수온을 예측하지 않는다 — 수온 전망을 인자로 받는다.
//  · 지평을 자동으로 늘리지 않는다 — 최대가 끝에 걸리면 경고를 올린다.
//
// ── 천황수산 조건에서의 수 ───────────────────────────────────────────────
// 앵커 17,000 원/kg @ 28.571 g(35미/kg) · 일별 생존율 0.9970084(하루 0.2992%
// 폐사) · 사료 2,300 원/kg · 전기 실청구 88.64 원/kWh 에서, **2주 더 키우는
// 쪽이 이익이다.**
//
//   2주 뒤 31.6 g — 개체중 +10.60% · 단가 +6.55% · 마리수 −4.11%
//   → 매출 **+13.00%**, 추가 사료·전기가 그보다 훨씬 작다
//   → 영업이익 **+30,598,881 원**(밴드 +30.60 ~ +33.59백만, 양끝 모두 양수)
//   → 근거: 성장 +27.68백만 · 크기 프리미엄 +17.11백만 · 폐사 −10.73백만 ·
//      사료 −1.97백만 · 전기 −1.39백만
//
// **뒤집히는 경계는 하루 1.0758% 폐사**(일별 생존율 0.989242)로, 천황수산
// 실적(0.2992%)의 3.6배다. 즉 그 농가의 268일 평균 폐사 속도에서는 2주가
// 비싸지 않다 — 비싸지는 것은 폐사가 그 3.6배로 올라갈 때다.
//
// 수는 scripts/harvest/verify.mjs 가 박아 두고 대조한다(225항목). 그 후보
// 묶음은 **가정 사례**다 — 코호트의 실제 출하는 평균 9.5 g 이고 28.6 g 은 11월
// 출하분의 크기다. 단가·비용 조건만 그 농가의 것이므로 절대 금액보다 비율과
// 경계 폐사율을 읽을 것.

export {
  CHEONHWANG_CYCLE_DAYS,
  CHEONHWANG_CYCLE_SURVIVAL_RATE,
  DEFAULT_DAILY_SURVIVAL_RATE,
  DEFAULT_FLIP_SEARCH_RANGE,
  DEFAULT_HORIZON_DAYS,
  DEFAULT_STEP_DAYS,
  FLIP_SEARCH_ITERATIONS,
  WINF_CEILING_RATIO,
} from "./constants"

export { hasExclusion, mergeHarvestExclusions } from "./exclusions"
export type { ExclusionUnit, HarvestExclusion, HarvestExclusionCode } from "./exclusions"

export { dailySurvivalFromCycle, resolveDailySurvival, survivalOverDays } from "./survival"
export type { DailySurvivalSource, HarvestSurvivalInput, ResolvedDailySurvival } from "./survival"

export { abwAtDay, cddAtDay, outlookCoverageDays, outlookExclusions } from "./outlook"
export type { AbwAtDay, AbwOutlook, WaterTempOutlook } from "./outlook"

export { addDays, dateKey } from "./dates"

export { candidatePrice, elasticityVariant, resolveHarvestAnchor } from "./price"
export type { HarvestAnchorFailure, HarvestPriceInput, ResolvedHarvestAnchor } from "./price"

export { attributeProfit, evaluateCandidate, evaluateVariant } from "./candidate"
export type {
  AttributionCode,
  AttributionComponent,
  CandidateFailure,
  CandidateVariant,
  CandidateVariants,
  HarvestBaseline,
  HarvestCandidate,
  HarvestContext,
  HarvestCostInput,
  ProfitAttribution,
  VariantResult,
  VariantSpec,
} from "./candidate"

export { dailySurvivalFlipPoint, harvestWindow, harvestWindowBySurvival } from "./window"
export type {
  CandidateSchedule,
  HarvestDecisionCode,
  HarvestWindow,
  HarvestWindowFailure,
  HarvestWindowInput,
  MarginalAnalysis,
  MarginalRow,
  MarginalSign,
  RecommendedWindow,
  SurvivalFlipPoint,
  SurvivalSweep,
  SurvivalSweepRow,
} from "./window"
