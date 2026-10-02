// 크기별 단가 추정 — **단가 ≈ 앵커 × (목표 ABW / 앵커 ABW)^탄력성.**
//
// 이 모듈이 답하는 질문은 "그때 kg당 얼마" 하나다. **출하 적기를 고르지
// 않는다** — 그것은 엔진 3 이고, 이 모듈은 그 선행 조건이다.
//
// ── 수준과 기울기를 분리한다 ─────────────────────────────────────────────
// 기울기는 **소매 사다리**에서(0.63), 수준은 **농가 실수취가**로 앵커한다
// (천황수산 도매 17,000 원/kg @ 35미/kg = 28.57 g). 둘을 한 출처에서 가져오면
// 소매 수준으로 농가 수익을 계산하거나(2.2 배 과대), 관측 1점인 도매에서
// 기울기를 뽑으려 하는(정의 불가) 두 사고 중 하나가 난다.
//
// ── 탄력성을 맨 number 로 받지 않는다 ────────────────────────────────────
// SizeElasticity 는 자기가 어느 상태 묶음(활·생물 / 선 / 냉동)에서 나왔는지를
// 들고 다니고, **앵커의 상태와 묶음이 다르면 추정이 거부된다.** 냉동 기울기는
// 약 0.19 로 활·생물의 1/3 인데 근거가 C 등급이다(경고 3). 맨 number 로 받으면
// 그 0.19 를 활 앵커에 때리는 것을 막을 방법이 없다.
//
// ── 반환값이 숨기지 않는 것 ──────────────────────────────────────────────
//  · 탄력성이 **잠정값**이고 농가 입력이 쌓이면 교체된다는 사실(경고 1)
//  · 근거가 **판매처 한 곳의 사다리**라는 사실(경고 1)
//  · 0.63 이 **하한**이고 실제 기울기는 0.63~0.73 일 수 있다는 사실 — 그래서
//    금액을 점이 아니라 밴드로 같이 돌려준다(경고 2)
//  · 구간 탄력성이 **단조 증가**해서 상수 가정이 큰 개체를 과소평가한다는 사실
//  · **계절 보정이 1.0 이고 모델에 없다**는 사실(경고 4) —
//    `seasonal: { factor: 1, modeled: false }` 로 반환값에 드러난다
//  · 크기별 **공시 통계가 아직 없다**는 사실

import { SIZE_PRICE_ANCHOR } from "@/lib/profitability/constants"

import {
  ELASTICITY_PLAUSIBLE_RANGE,
  PENDING_OFFICIAL_SOURCES,
  SEASONAL_ADJUSTMENT,
  STAGE_MULTIPLIER,
  formFamily,
} from "./constants"
import type {
  DistributionStage,
  EvidenceGrade,
  ObservationSource,
  ProductForm,
} from "./constants"
import type { PricingExclusion } from "./exclusions"
import { DEFAULT_SIZE_ELASTICITY, abwFromCountPerKg, countPerKgFromAbwG } from "./ladder"
import type { SizeElasticity } from "./ladder"

/**
 * 단가 앵커 — **금액과 그때의 크기가 한 쌍으로 붙어 있다.** 둘을 따로 받으면
 * 크기 없는 금액으로 호출하는 경로가 생기고, 그러면 기울기를 적용할 기준점이
 * 없는데도 수가 나온다.
 */
export type PriceAnchor = {
  krwPerKg: number
  /** 그때의 개체중(g). */
  abwG: number
  stage: DistributionStage
  form: ProductForm
  /** 프리미엄 인증 상품인가. true 면 앵커로 쓸 수 없다. */
  premium: boolean
  observedAt: string
  grade: EvidenceGrade
  source: ObservationSource
}

/** 미/kg 으로 앵커를 만든다. ABW 를 손으로 계산해 넣다가 어긋나는 것을 막는다. */
export function anchorFromCountPerKg(
  input: Omit<PriceAnchor, "abwG"> & { countPerKg: number },
): PriceAnchor | null {
  const abwG = abwFromCountPerKg(input.countPerKg)
  if (abwG === null) return null
  // 필드를 하나씩 옮긴다 — 스프레드로 넘기면 countPerKg 가 앵커에 함께 남고,
  // 그러면 ABW 와 미/kg 이 두 군데 살아 있다가 어긋난다.
  return {
    krwPerKg: input.krwPerKg,
    abwG,
    stage: input.stage,
    form: input.form,
    premium: input.premium,
    observedAt: input.observedAt,
    grade: input.grade,
    source: input.source,
  }
}

/**
 * **수준 앵커 — 농가 실수취가.** 엔진 2 의 SIZE_PRICE_ANCHOR
 * (35미/kg @ 17,000 원/kg, 도매, 2024-11, 천황수산)를 그대로 쓴다. 같은 수를
 * 두 군데 적지 않는다 — 엔진 2 가 고치면 여기도 따라간다.
 *
 * 엔진 2 는 이 점 1개로 **기울기를 만들지 않는다**(점 1개로는 정의되지 않는다).
 * 이 모듈이 더하는 것은 기울기이고, 그 기울기는 다른 출처(소매 사다리)에서
 * 온다. 앵커는 수준만 준다.
 */
export const FARM_PRICE_ANCHOR: PriceAnchor = {
  krwPerKg: SIZE_PRICE_ANCHOR.krwPerKg,
  abwG: 1000 / SIZE_PRICE_ANCHOR.countPerKg,
  stage: "wholesale",
  form: "live",
  premium: false,
  observedAt: SIZE_PRICE_ANCHOR.observedAt,
  grade: "A",
  source: { kind: "farm_record", farm: "천황수산" },
}

export type SizePriceFailure =
  /** 앵커의 금액·크기가 수가 아니거나 0 이하다. */
  | "anchor_invalid"
  /** 목표 크기가 수가 아니거나 0 이하다. */
  | "target_invalid"
  /** 앵커가 프리미엄 인증 상품이다. 크기 기울기로 외삽할 대상이 아니다. */
  | "anchor_premium_excluded"
  /**
   * **탄력성과 앵커의 상태 묶음이 다르다.** 냉동 계수(0.19)로 활 단가를
   * 계산하려는 경로가 여기서 막힌다.
   */
  | "elasticity_form_mismatch"
  /** 탄력성이 크기 효과로 설명되지 않는 크기다(0~1.5 밖). */
  | "elasticity_out_of_plausible_range"

export type SizePriceEstimate = {
  /** 추정 단가(원/kg). **반올림하지 않는다** — 표시 반올림은 화면 일이다. */
  krwPerKg: number | null
  /**
   * 탄력성 밴드(0.63~0.73)로 계산한 하한·상한. **0.63 은 하한이라서 점만
   * 보면 크기 프리미엄이 과소평가된다**(경고 2). 엔진 3 이 "2주 더 키우자" 를
   * 판정할 때 보아야 하는 쪽은 이 밴드다.
   */
  bandKrwPerKg: { low: number; high: number } | null
  anchorKrwPerKg: number
  anchorAbwG: number
  targetAbwG: number
  targetCountPerKg: number | null
  /** 목표/앵커 단가비. 1.0655 면 +6.55% 다. */
  priceRatio: number | null
  elasticity: SizeElasticity | null
  /** 어느 단계·상태의 단가인가. **앵커에서 그대로 따라온다.** */
  stage: DistributionStage | null
  form: ProductForm | null
  /**
   * 계절 보정. **언제나 factor 1 · modeled false 다**(경고 4). 추계 출하기
   * 하락 방향만 확인됐고 정량화 불가(C)다. 2019년 산지 −30% 는 연도 간
   * 비교라 계절 근거가 아니다.
   */
  seasonal: { factor: number; modeled: boolean; grade: EvidenceGrade }
  failure: SizePriceFailure | null
  exclusions: PricingExclusion[]
}

export type EstimateOptions = {
  /**
   * 쓸 탄력성. 기본은 DEFAULT_SIZE_ELASTICITY(0.63, 활·생물, 잠정).
   * **앵커와 상태 묶음이 다르면 거부된다.**
   */
  elasticity?: SizeElasticity
}

function failEstimate(
  anchor: PriceAnchor,
  targetAbwG: number,
  failure: SizePriceFailure,
  exclusions: PricingExclusion[] = [],
): SizePriceEstimate {
  return {
    krwPerKg: null,
    bandKrwPerKg: null,
    anchorKrwPerKg: anchor.krwPerKg,
    anchorAbwG: anchor.abwG,
    targetAbwG,
    targetCountPerKg: countPerKgFromAbwG(targetAbwG),
    priceRatio: null,
    elasticity: null,
    stage: anchor.stage ?? null,
    form: anchor.form ?? null,
    seasonal: {
      factor: SEASONAL_ADJUSTMENT.factor,
      modeled: SEASONAL_ADJUSTMENT.modeled,
      grade: SEASONAL_ADJUSTMENT.grade,
    },
    failure,
    exclusions,
  }
}

/**
 * 앵커와 목표 크기에서 단가를 추정한다.
 *
 *   단가 = 앵커단가 × (목표ABW / 앵커ABW)^탄력성
 *
 * 천황수산 앵커(17,000 원/kg @ 28.57 g)에서 2주 뒤 31.6 g 이면
 * 17,000 × (31.6/28.57)^0.63 = **18,114 원/kg**(+6.6%)이고, 탄력성 상한
 * 0.73 을 쓰면 18,297 원/kg 이다.
 */
export function estimateSizePrice(
  anchor: PriceAnchor,
  targetAbwG: number,
  options: EstimateOptions = {},
): SizePriceEstimate {
  const elasticity = options.elasticity ?? DEFAULT_SIZE_ELASTICITY

  if (
    !Number.isFinite(anchor.krwPerKg) ||
    anchor.krwPerKg <= 0 ||
    !Number.isFinite(anchor.abwG) ||
    anchor.abwG <= 0
  ) {
    return failEstimate(anchor, targetAbwG, "anchor_invalid")
  }
  if (anchor.premium) {
    return failEstimate(anchor, targetAbwG, "anchor_premium_excluded", [
      { code: "price_ladder_premium_excluded", quantity: 1, unit: "count" },
    ])
  }
  if (!Number.isFinite(targetAbwG) || targetAbwG <= 0) {
    return failEstimate(anchor, targetAbwG, "target_invalid")
  }
  // **냉동 계수로 활 단가를 계산하는 길을 여기서 막는다.**
  if (elasticity.family !== formFamily(anchor.form)) {
    return failEstimate(anchor, targetAbwG, "elasticity_form_mismatch", [
      { code: "price_ladder_form_not_slope_eligible", quantity: null, unit: null },
    ])
  }
  if (
    !Number.isFinite(elasticity.value) ||
    elasticity.value < ELASTICITY_PLAUSIBLE_RANGE.min ||
    elasticity.value > ELASTICITY_PLAUSIBLE_RANGE.max
  ) {
    return failEstimate(anchor, targetAbwG, "elasticity_out_of_plausible_range", [
      { code: "price_ladder_elasticity_implausible", quantity: elasticity.value, unit: "ratio" },
    ])
  }

  const sizeRatio = targetAbwG / anchor.abwG
  const priceRatio = Math.pow(sizeRatio, elasticity.value)
  // 계절 보정은 1.0 이다. 곱하는 자리를 남겨 두되 값은 바꾸지 않는다 —
  // 자리를 없애면 나중에 추정이 들어올 때 호출부 전체를 고쳐야 한다.
  const krwPerKg = anchor.krwPerKg * priceRatio * SEASONAL_ADJUSTMENT.factor

  const bandEnds = [elasticity.band.low, elasticity.band.high].map(
    (e) => anchor.krwPerKg * Math.pow(sizeRatio, e) * SEASONAL_ADJUSTMENT.factor,
  )
  const bandKrwPerKg = { low: Math.min(...bandEnds), high: Math.max(...bandEnds) }

  const exclusions: PricingExclusion[] = [
    { code: "price_extrapolated_from_anchor", quantity: targetAbwG, unit: "gram" },
    { code: "price_elasticity_form_specific", quantity: null, unit: null },
    // 계절항이 0 이라는 사실은 숨기지 않는다. quantity 0 은 "보정량이 0" 이고
    // "모른다" 가 아니다 — 모른다는 것은 seasonal.modeled: false 가 말한다.
    { code: "price_seasonality_not_modeled", quantity: 0, unit: "ratio" },
    {
      code: "price_official_statistics_unavailable",
      quantity: PENDING_OFFICIAL_SOURCES.length,
      unit: "count",
    },
  ]
  if (elasticity.provisional) {
    exclusions.push({ code: "price_elasticity_provisional", quantity: elasticity.value, unit: "ratio" })
  }
  if (elasticity.vendorCount <= 1) {
    exclusions.push({
      code: "price_elasticity_single_vendor",
      quantity: elasticity.vendorCount,
      unit: "count",
    })
  }
  if (elasticity.band.high > elasticity.value) {
    exclusions.push({
      code: "price_elasticity_lower_bound",
      quantity: elasticity.band.high,
      unit: "ratio",
    })
  }
  if (elasticity.sizeDependent === true) {
    exclusions.push({ code: "price_elasticity_size_dependent", quantity: null, unit: "ratio" })
  }
  const range = elasticity.observedAbwRangeG
  if (range !== null && (targetAbwG < range.min || targetAbwG > range.max)) {
    exclusions.push({ code: "price_target_outside_observed_size", quantity: targetAbwG, unit: "gram" })
  }

  // 앵커가 농가 수취 단계(산지·도매)가 아니면 결과도 농가가 받는 돈이 아니다.
  //
  // 이 모듈의 다른 사고는 전부 단가를 null 로 막지만 이것만은 막지 않는다 —
  // "소매에서 31.6 g 이 얼마냐" 는 질문 자체가 정당하기 때문이다. 대신 경고를
  // 올린다. 소매 앵커로 계산하면 같은 크기의 농가 수취가보다 약 1.9배 높게
  // 나오고, 그 수는 멀쩡해 보여서 stage 를 안 읽으면 그대로 수익이 된다.
  //
  // quantity 에 농가 수취가로 되돌릴 배수를 실어, 호출자가 경고만 보고도
  // 환산할 수 있게 한다.
  if (anchor.stage !== "farmgate" && anchor.stage !== "wholesale") {
    const toFarmgate = STAGE_MULTIPLIER[anchor.stage].point / STAGE_MULTIPLIER.farmgate.point
    exclusions.push({ code: "price_anchor_not_farmgate", quantity: toFarmgate, unit: "ratio" })
  }

  return {
    krwPerKg,
    bandKrwPerKg,
    anchorKrwPerKg: anchor.krwPerKg,
    anchorAbwG: anchor.abwG,
    targetAbwG,
    targetCountPerKg: countPerKgFromAbwG(targetAbwG),
    priceRatio,
    elasticity,
    stage: anchor.stage,
    form: anchor.form,
    seasonal: {
      factor: SEASONAL_ADJUSTMENT.factor,
      modeled: SEASONAL_ADJUSTMENT.modeled,
      grade: SEASONAL_ADJUSTMENT.grade,
    },
    failure: null,
    exclusions,
  }
}

/**
 * 여러 목표 크기의 단가를 한 번에 낸다. **스칼라 테이블이 아니다** — 행마다
 * 앵커의 단계·상태와 경고 목록이 그대로 붙어 나간다. 판매처를 무시한 단가
 * 테이블을 만들지 말라는 것이 이 모듈의 설계 제약이고, 표 형태가 필요하다는
 * 이유로 그 제약을 우회하지 않는다.
 */
export function sizePriceTable(
  anchor: PriceAnchor,
  targetsAbwG: readonly number[],
  options: EstimateOptions = {},
): readonly SizePriceEstimate[] {
  return targetsAbwG.map((t) => estimateSizePrice(anchor, t, options))
}
