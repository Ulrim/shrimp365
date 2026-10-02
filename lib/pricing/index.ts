// 크기별 단가 모델. 순수 계산 모듈이다. **엔진 3(출하 윈도우)의 선행 조건이고,
// 엔진 3 자체가 아니다** — 이 모듈은 "그때 kg당 얼마" 까지만 답한다.
//
// DB 조회도 화면도 라우트도 외부 API 도 문장 생성도 여기 없다. 입력을 인자로
// 받아 구조를 돌려주고 끝이다. 엔진 1(lib/growth)·엔진 2(lib/profitability)와
// 같은 방식이고, 엔진 2 의 Exclusion 어휘를 그대로 쓴다.
//
// ── 설계 규칙 — 엔진 1·2 와 같다. 어기면 안 된다 ─────────────────────────
//  1. **문장을 만들지 않는다.** 코드·수치만 돌려주고 번역은 화면이 맡는다.
//  2. **"좋아 보이는 지표" 를 내보내지 않는다.** 엔진 1 이 R² 를 내보내지 않는
//     것과 같다 — 쥐여 주면 화면에 올라간다. 여기서는 "크기 프리미엄 +7.6%"
//     같은 요약 수가 그 자리다. 탄력성과 금액만 돌려준다.
//  3. **모르는 값을 0 으로 채우지 않는다.** 구간이 부족해 단조성을 판정하지
//     못하면 `segmentsMonotoneIncreasing` 은 false 가 아니라 null 이다.
//  4. **반올림하지 않는다.** 18,114.0 원/kg 은 그대로 돌려준다.
//  5. **조용히 기본값으로 떨어지지 않는다.** 판매처가 섞이거나 상태가
//     어긋나면 수를 돌려주지 않고 failure 를 채운다(엔진 2 의 resolvePrice 와
//     같은 원칙). 그리고 반환값마다 「이 단가에 포함되지 않은 것」 목록이
//     함께 나간다.
//
// ── 이 모델이 서 있는 땅 ─────────────────────────────────────────────────
// **단가 ≈ 상수 × ABW^0.63.** 등급 한 단계(약 4미/kg)당 +7.6%, 전구간 +24.6%.
// 근거는 **동일 판매처 4단 사다리 하나**다 — 이순신수산 / 11번가 상품
// 8549532487 / 국내산 / 생물·활 / 온라인몰 소매 / 2026-10 조회 / 1kg 단위.
// 독립 검색 4회에서 네 칸이 모두 동일하게 재현됐다(등급 A).
//
//   소  40-45미(23.5 g) 28,000 원/kg
//   중  36-40미(26.3 g) 29,800
//   대  34미 내외(29.4 g) 31,900
//   특대 30미 내외(33.3 g) 34,900
//
// 수준은 소매가 아니라 **농가 실수취가로 앵커한다**(천황수산 도매
// 17,000 원/kg @ 35미/kg = 28.57 g). 소매 → 농가 변환은 ÷2.2(허용 2.0~2.4).
//
// ── 반드시 알고 써야 하는 경고 네 가지 ───────────────────────────────────
//  1. **탄력성 0.63 은 판매처 한 곳의 사다리에서 나왔다. 시장 평균이 아닐 수
//     있다.** 그래서 점추정이 아니라 **잠정 설정값**으로 두었다
//     (DEFAULT_SIZE_ELASTICITY.provisional === true). 농가 입력이 쌓이면
//     교체된다. **두 번째 사다리를 찾지 못한 것이 이 모델의 현재 최대 약점이다.**
//     추정마다 price_elasticity_provisional · price_elasticity_single_vendor 가
//     나간다.
//  2. **0.63 은 하한이다.** 소매가에 택배비 약 4,000 원/kg 수준의 고정비가
//     섞여 있고, 고정분은 크기와 무관하므로 기울기를 평평하게 만든다. 사다리
//     네 점에서 4,000 원을 빼면 전구간 탄력성이 **0.7255** 로 올라간다. 즉
//     실제 산지 기울기는 **0.63~0.73** 사이일 가능성이 높고, 0.63 을 쓰면
//     엔진 3 이 "2주 더 키우자" 를 **과소 권고**한다. 안전한 방향의 편향이지만
//     알고 써야 하므로 금액을 점이 아니라 **밴드로 같이** 돌려준다
//     (SizePriceEstimate.bandKrwPerKg) 그리고
//     price_elasticity_lower_bound 를 올린다.
//  3. **냉동 기울기는 다르다(약 0.19, 활·생물의 1/3).** 근거가 C 등급이라
//     수치를 신뢰할 수 없다. **냉동 사다리로 기울기를 뽑으면 크기 프리미엄이
//     크게 과소평가된다**는 방향만 기억하고, 활·생물 사다리만 쓴다. 구조로
//     막아 두었다 — 냉동 사다리의 적합은 거부되고(form_not_slope_eligible),
//     냉동 탄력성을 활 앵커에 적용하면 거부된다(elasticity_form_mismatch).
//     활 ÷ 냉동 ≈ 2.2 배이므로 활·선·냉동을 한 테이블에 섞지 않는다.
//  4. **계절항은 0 이다.** 추계 집중 출하기(9~12월) 단가 하락 방향은 확인됐으나
//     **정량화 불가(C)** 다. 2019년 산지 −30% 는 연도 간 비교이고 원인도
//     생산량 증가·소비 부진이라 **계절 근거로 쓰면 오독이므로 넣지 않았다.**
//     월별 농가 입력이 쌓인 뒤 추정하는 것이 정직하다. 0 이라는 사실은
//     반환값에 드러난다 — `seasonal: { factor: 1, modeled: false }` 와
//     price_seasonality_not_modeled.
//
// ── 반드시 구조로 막은 것 ────────────────────────────────────────────────
// **같은 40미/kg 에서 단가가 28,000 ~ 49,900 원으로 1.78 배 벌어진다. 크기
// 전구간 효과는 +24.6% 에 불과하다 — 판매처 간 노이즈가 크기 신호의 3배다.**
// 프리미엄 상품(무항생제·친환경 49,900 원 @40미, 산지직송 42,900 원 @40미)은
// 40미인데도 특대(30미)보다 비싸서, 한 회귀에 넣으면 기울기 부호가 뒤집힌다.
//
// 막아야 할 사고는 이것이다 — **"스칼라 단가 테이블을 판매처 무시하고 만들면
// 엔진 3 이 작은 새우가 더 비싸다고 말하게 된다."** 네 겹으로 막았다(ladder.ts
// 머리주석): 타입(사다리 단위로 판매처를 든다) · 묶기(섞이면 거부) ·
// 단조성(라벨이 거짓이어도 걸린다) · 크기 상한(구간 탄력성 1.5 초과 거부).
//
// ── 공식 통계 ────────────────────────────────────────────────────────────
// 크기별 공시 통계는 **여전히 없다.** 해수부 「일자별위탁판매현황」에
// `상품규격명`·`위판단가(1킬로그램)` 컬럼이 있는 것은 등급 A 로 재확인됐고
// 데이터셋은 15102791 · 15102792 · 15102794 셋이다. **이 환경은 data.go.kr 이
// 네트워크 차단이라 호출할 수 없어 연동을 만들지 않았다.** 들어올 자리만
// 두었다 — ObservationSource 의 `official_statistic` 와
// PENDING_OFFICIAL_SOURCES. 추정마다
// price_official_statistics_unavailable 이 나간다.
//
// ── 이 모듈이 하지 않는 일 ───────────────────────────────────────────────
//  · 출하 적기를 고르지 않는다 — 엔진 3 이다.
//  · 적산수온을 날짜로 바꾸지 않는다 — 엔진 1·3 의 몫이다.
//  · 바이오매스를 곱해 매출을 내지 않는다 — 엔진 2 다.
//  · 계절 보정을 추정하지 않는다(경고 4).
//  · 외부 시세 API 를 호출하지 않는다.
//
// 검증은 scripts/pricing/verify.mjs 가 한다(엔진 1·2 와 같은 방식).

export {
  FARMGATE_BASE_KRW_PER_KG,
  FROZEN_SIZE_ELASTICITY_C_GRADE,
  ELASTICITY_PLAUSIBLE_RANGE,
  LADDER_MARKETPLACE,
  LADDER_OBSERVED_AT,
  LADDER_PRODUCT_ID,
  LADDER_VENDOR,
  LIVE_TO_FROZEN_PRICE_RATIO,
  PENDING_OFFICIAL_SOURCES,
  RETAIL_SHIPPING_FIXED_KRW_PER_KG,
  RETAIL_TO_FARMGATE_DIVISOR,
  RETAIL_TO_FARMGATE_DIVISOR_RANGE,
  SEASONAL_ADJUSTMENT,
  SIZE_ELASTICITY_BAND,
  SIZE_ELASTICITY_DEFAULT,
  SIZE_PRICE_LADDER_RUNGS,
  SLOPE_ELIGIBLE_FORMS,
  STAGE_MULTIPLIER,
  formFamily,
} from "./constants"
export type {
  DistributionStage,
  EvidenceGrade,
  FormFamily,
  LadderRung,
  ObservationSource,
  ProductForm,
  StageMultiplier,
} from "./constants"

export { mergePricingExclusions } from "./exclusions"
export type { ExclusionUnit, PricingExclusion, PricingExclusionCode } from "./exclusions"

export {
  DEFAULT_SIZE_ELASTICITY,
  FROZEN_SIZE_ELASTICITY,
  SIZE_PRICE_LADDER,
  abwFromCountPerKg,
  buildLadders,
  countPerKgFromAbwG,
  fitSizeElasticity,
  fitSizeElasticityFromObservations,
  ladderGroupKey,
} from "./ladder"
export type {
  BuildLaddersResult,
  ElasticityFit,
  ElasticityFitFailure,
  FitOptions,
  LadderPoint,
  SegmentElasticity,
  SizeElasticity,
  SizePriceLadder,
  SizePriceObservation,
} from "./ladder"

export { convertStage, farmgateToRetail, retailToFarmgate, stageReferenceKrwPerKg } from "./distribution"
export type { RetailFarmgateOptions, StageConversion, StageConversionFailure } from "./distribution"

export { FARM_PRICE_ANCHOR, anchorFromCountPerKg, estimateSizePrice, sizePriceTable } from "./size-price"
export type { EstimateOptions, PriceAnchor, SizePriceEstimate, SizePriceFailure } from "./size-price"
