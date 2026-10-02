// 엔진 2 — 수익성 예측. 순수 계산 모듈이다.
//
// DB 조회도 화면도 라우트도 문장 생성도 여기 없다. 입력을 인자로 받아 구조를
// 돌려주고 끝이다. 엔진 1(lib/growth)과 같은 방식이고, 그 위에 올라간다.
//
// 계획서는 이 엔진을 "진행 중 사이클의 예상 kg당 원가·예상 매출·예상 영업이익"
// 으로 적었다(docs/plans/tips-2026-gap-and-plan.md 4절 엔진 2).
// app/(dashboard)/production/page.tsx 의 기존 costPerKg·profit·roi 를 **지우지
// 않는다** — 사후 집계 산식은 예측값의 검증 기준으로 그대로 남는다.
//
// ── 설계 규칙 — 엔진 1 과 같다. 어기면 안 된다 ────────────────────────────
//  1. **문장을 만들지 않는다.** 코드·수치만 돌려주고 번역은 화면이 맡는다.
//     엔진 6(다국어 리포트)이 이 위에 올라가고, 문자열에서 구조를 역추출할 수는
//     없다. raspberry-pi/advice.py 와 같은 원칙이다.
//  2. **"좋아 보이는 지표" 를 내보내지 않는다.** 금액과 비율만. 엔진 1 이 R² 를
//     내보내지 않는 것과 같다 — 쥐여 주면 화면에 올라간다.
//  3. **모르는 값을 0 으로 채우지 않는다.** 미입력과 0 원은 다른 사건이다.
//     그래서 합계 필드가 totalKrw 가 아니라 knownTotalKrw 이고, 옆에
//     missingItems·complete 가 붙는다(cost.ts 머리의 세 선택지 참조).
//  4. **반올림하지 않는다.** 표시 반올림은 화면 일이다. 14,489 원/kg 은
//     14,489.1618… 을 그대로 돌려준다.
//  5. **채널을 조용히 고르지 않는다.** 도매 17,000 과 소매 활새우 26,500 이
//     56% 벌어진다. 단가 근거는 필수 인자이고, 안 넘기면 기본값으로 떨어지지
//     않고 매출이 null 로 나온다. 어느 채널로 계산했는지는 언제나 반환값에
//     담긴다(channel.ts).
//  6. **금액만 돌려주지 않는다.** 반환값마다 「이 계산에 포함되지 않은 것」
//     목록이 함께 나간다(exclusions.ts). 엔진 1 이 excluded·filledDays 를
//     돌려주는 것과 같다.
//
// ── 이 엔진이 하지 않는 일 ───────────────────────────────────────────────
//  · 적산수온을 날짜로 바꾸지 않는다 — 수온 전망이 필요하고 엔진 3 의 몫이다.
//  · 크기에 따라 단가를 올리지 않는다 — 실데이터의 (크기, 단가) 조합이 1개라
//    기울기가 정의되지 않는다.
//  · 잔여기간 급이량을 추정하지 않는다 — 엔진 5 다. 0 으로 채우지도 않는다.
//  · 출하 적기를 고르지 않는다 — 시나리오별 금액과 차액까지다. 판정은 엔진 3.
//
// ── 이 엔진의 금액은 확정 손익이 아니다 ──────────────────────────────────
// 천황수산 2024 코호트에서 빠져 있는 것만 넷이다.
//   · **냉동 재고 1,221 kg 이 매출에 안 잡혀 있다.** `transfer_to_freezer` 7건
//     으로 나갔는데 freezer 채널 기록 9건은 중량·금액이 전부 비어 있다. 도매가
//     로 치면 2,000만원대다 — 손익 −2,921만원의 70% 다.
//   · **11·12월 전기요금이 없다.** 고지서가 10월까지다.
//   · **12월 출하 209 kg**(T1 출하 116 + 냉동 93)이 이벤트 원장에 없다.
//   · **인건비·약품비·감가가 통째로 빠져 있다.**
// 그리고 생존율·FCR 의 분모가 되는 회차 경계는 **사람이 메모를 읽어 복원한
// 파생 라벨이다** — 원본의 `label_status` 는 70건 전부
// `not_validated_outcome_label` 이고, 복원은 가능했지만 그 복원은 데이터의
// 사실이 아니다(dataset-assessment 4-7·4-8). 특히 수조별 분해는 메모 해석에
// 의존한다.
//
// 그래서 이 모듈은 금액 옆에 언제나 exclusions 를 붙이고, 미판매 재고는
// **인자로 받는다** — 사이클이 안 닫혔을 때 재고를 얼마로 잡느냐는 사람이
// 정할 일이지 엔진이 0 으로 가정할 일이 아니다.
//
// ── 실데이터 실적(이 구현이 재현하는 수) ─────────────────────────────────
// 단일 코호트 2024-03-12 입식 ~ 2024-12-05, 수조 5개
//   입식 1,200,000마리 9.0 kg · 급이 16,378.5 kg · 출하 5,111.6 kg 537,562마리
//   생존율 44.8% · FCR 3.21 · 확정매출 44,853,100원(41건)
//   비용 74,062,800원 · 손익 −29,209,700원 · kg당 원가 14,489원
//   손익분기 생존율 74.0%
// 대조는 scripts/profitability/verify.mjs 가 한다.

export {
  DEFAULT_FEED_KRW_PER_KG,
  DEFAULT_SEED_KRW_PER_PL,
  DEFAULT_ELECTRICITY_KRW_PER_KWH,
  AGRICULTURAL_ENERGY_CHARGE_KRW_PER_KWH,
  ELECTRICITY_BILLS_2024,
  ELECTRICITY_BILLED_KWH,
  ELECTRICITY_BILLED_KRW,
  summarizeElectricityBills,
  CHANNEL_MEDIAN_KRW_PER_KG,
  CHANNEL_PRICE_OBSERVED,
  SIZE_PRICE_ANCHOR,
} from "./constants"
export type { ElectricityBill } from "./constants"

export { COST_ITEMS } from "./cost-items"
export type { CostItem } from "./cost-items"

export { mergeExclusions } from "./exclusions"
export type { Exclusion, ExclusionCode, ExclusionUnit } from "./exclusions"

export { resolvePrice } from "./channel"
export type { PriceBasis, PriceFailure, RealizedContext, ResolvedPrice, SalesChannel } from "./channel"

export { computeCost, addCosts, costOf } from "./cost"
export type { CostBasis, CostBreakdown, CostInput, CostLine, CostUnitPrices } from "./cost"

export { computeActuals, computeRevenue } from "./performance"
export type {
  ActualPerformance,
  ActualsInput,
  RevenueBreakdown,
  RevenueInput,
  UnsoldInventoryInput,
} from "./performance"

export { projectHarvestScenarios, resolveAbwG } from "./projection"
export type {
  HarvestProjection,
  HarvestScenario,
  HarvestScenarioInput,
  ProjectedAbw,
  ProjectionBase,
} from "./projection"

export { survivalSensitivity, breakEvenSurvivalRate } from "./sensitivity"
export type {
  BreakEvenFailure,
  BreakEvenResult,
  SurvivalSensitivity,
  SurvivalSensitivityInput,
  SurvivalSensitivityRow,
} from "./sensitivity"
