// 유통단계 변환 — **수준(level)과 기울기(slope)를 분리하기 위한 층이다.**
//
// 크기별로 공개된 시세는 **온라인몰 소매**인데 농가가 받는 것은 **산지·도매**다.
// 두 수준이 2.2 배 벌어진다. 그래서:
//   · 기울기는 소매 사다리에서 가져온다(ladder.ts, 0.63)
//   · 수준은 농가 실수취가로 앵커한다(천황수산 도매 17,000 원/kg @ 35미/kg)
// 이 파일은 그 둘 사이를 오가는 변환만 한다.
//
// ── 두 가지를 거부한다 ───────────────────────────────────────────────────
//  1. **프리미엄 인증 상품은 변환하지 않는다.** 무항생제·친환경 49,900 원 @40미
//     는 산지 평균의 3.49 배다. ÷2.2 를 때리면 산지 22,682 원/kg 이 나오는데
//     이는 관측된 산지 최고가의 1.5 배가 넘는다. 인증 프리미엄은 유통마진이
//     아니라 상품 차별화라서 유통단계 배수로 환산되지 않는다.
//  2. **범위 밖 변환 계수는 끌어당기지 않고 거부한다.** 2.0~2.4 밖의 계수를
//     받아 주면 엔진 3 의 출하 판정이 계수 선택 하나로 뒤집힌다.

import {
  FARMGATE_BASE_KRW_PER_KG,
  RETAIL_TO_FARMGATE_DIVISOR,
  RETAIL_TO_FARMGATE_DIVISOR_RANGE,
  STAGE_MULTIPLIER,
} from "./constants"
import type { DistributionStage } from "./constants"
import type { PricingExclusion } from "./exclusions"

export type StageConversionFailure =
  /** 단가가 수가 아니거나 0 이하다. */
  | "invalid_price"
  /** 프리미엄 인증 단계가 끼어 있다. 유통단계 배수로 환산되지 않는다. */
  | "premium_not_convertible"
  /** 변환 계수가 허용 범위(2.0~2.4) 밖이다. **끌어당기지 않고 거부한다.** */
  | "divisor_out_of_range"
  /** 알 수 없는 단계다. */
  | "unknown_stage"

export type StageConversion = {
  /** 변환 결과(원/kg). 거부되면 null 이다 — 원값을 그대로 돌려주지 않는다. */
  krwPerKg: number | null
  /**
   * 관측 폭을 전부 쓴 하한·상한. 온라인몰 소매 → 산지는 1.96~2.44 가 폭이라
   * 28,000 원이 11,475 ~ 14,286 원으로 벌어진다. **point 만 보고 쓰지 말라는
   * 뜻으로 같이 돌려준다.**
   */
  lowKrwPerKg: number | null
  highKrwPerKg: number | null
  from: DistributionStage
  to: DistributionStage
  /** 실제로 곱한 배수 = mult[to] / mult[from]. */
  multiplier: number | null
  failure: StageConversionFailure | null
  exclusions: PricingExclusion[]
}

function failConversion(
  from: DistributionStage,
  to: DistributionStage,
  failure: StageConversionFailure,
  exclusions: PricingExclusion[] = [],
): StageConversion {
  return {
    krwPerKg: null,
    lowKrwPerKg: null,
    highKrwPerKg: null,
    from,
    to,
    multiplier: null,
    failure,
    exclusions,
  }
}

/** 그 단계의 참고 단가(원/kg) = 산지 평균 14,286 × 단계 배수. 관측 1점의 재현이다. */
export function stageReferenceKrwPerKg(stage: DistributionStage): number | null {
  const m = STAGE_MULTIPLIER[stage]
  if (!m) return null
  return FARMGATE_BASE_KRW_PER_KG * m.point
}

/**
 * 유통단계 사이 변환. **프리미엄 단계가 끼면 거부한다.**
 */
export function convertStage(
  krwPerKg: number,
  from: DistributionStage,
  to: DistributionStage,
): StageConversion {
  const mFrom = STAGE_MULTIPLIER[from]
  const mTo = STAGE_MULTIPLIER[to]
  if (!mFrom || !mTo) return failConversion(from, to, "unknown_stage")
  if (from === "online_premium" || to === "online_premium") {
    return failConversion(from, to, "premium_not_convertible", [
      { code: "price_ladder_premium_excluded", quantity: 1, unit: "count" },
    ])
  }
  if (!Number.isFinite(krwPerKg) || krwPerKg <= 0) return failConversion(from, to, "invalid_price")

  const multiplier = mTo.point / mFrom.point
  const exclusions: PricingExclusion[] = [
    { code: "price_stage_multiplier_assumed", quantity: multiplier, unit: "ratio" },
  ]
  const ranged = mFrom.low !== mFrom.high || mTo.low !== mTo.high
  if (ranged) {
    // 폭의 크기를 수량으로 담는다 — 1.0 이면 점이고, 1.25 면 25% 벌어진다.
    const spread = (mTo.high / mFrom.low) / (mTo.low / mFrom.high)
    exclusions.push({ code: "price_stage_multiplier_ranged", quantity: spread, unit: "ratio" })
  }

  return {
    krwPerKg: krwPerKg * multiplier,
    lowKrwPerKg: (krwPerKg / mFrom.high) * mTo.low,
    highKrwPerKg: (krwPerKg / mFrom.low) * mTo.high,
    from,
    to,
    multiplier,
    failure: null,
    exclusions,
  }
}

export type RetailFarmgateOptions = {
  /** 변환 계수. 기본 2.2, 허용 2.0~2.4. 범위 밖은 거부된다. */
  divisor?: number
  /** 프리미엄 인증 상품인가. true 면 거부된다. */
  premium?: boolean
}

/**
 * **온라인몰 소매 → 농가 실수취. ÷2.2(허용 2.0~2.4).**
 *
 * 28,000 원/kg 소매 → 12,727 원/kg 산지. 폭을 쓰면 11,475 ~ 14,286 원이다.
 *
 * 범위 밖 계수는 **클램프하지 않고 거부한다** — 끌어당기면 호출자는 2.8 을
 * 넣고 2.4 로 계산된 수를 2.8 의 결과로 읽는다. 엔진 2 의 resolvePrice 가
 * 기본 채널로 떨어지지 않는 것과 같은 원칙이다.
 */
export function retailToFarmgate(
  krwPerKg: number,
  options: RetailFarmgateOptions = {},
): StageConversion {
  const divisor = options.divisor ?? RETAIL_TO_FARMGATE_DIVISOR
  if (options.premium === true) {
    return failConversion("online_retail", "farmgate", "premium_not_convertible", [
      { code: "price_ladder_premium_excluded", quantity: 1, unit: "count" },
    ])
  }
  if (!Number.isFinite(krwPerKg) || krwPerKg <= 0) {
    return failConversion("online_retail", "farmgate", "invalid_price")
  }
  if (
    !Number.isFinite(divisor) ||
    divisor < RETAIL_TO_FARMGATE_DIVISOR_RANGE.min ||
    divisor > RETAIL_TO_FARMGATE_DIVISOR_RANGE.max
  ) {
    return failConversion("online_retail", "farmgate", "divisor_out_of_range")
  }

  const retail = STAGE_MULTIPLIER.online_retail
  return {
    krwPerKg: krwPerKg / divisor,
    // 하한·상한은 관측 폭 1.96~2.44 를 쓴다. 허용 계수 범위(2.0~2.4)보다 넓다.
    lowKrwPerKg: krwPerKg / retail.high,
    highKrwPerKg: krwPerKg / retail.low,
    from: "online_retail",
    to: "farmgate",
    multiplier: 1 / divisor,
    failure: null,
    exclusions: [{ code: "price_stage_multiplier_assumed", quantity: 1 / divisor, unit: "ratio" }],
  }
}

/** 농가 실수취 → 온라인몰 소매. ×2.2(허용 2.0~2.4). retailToFarmgate 의 역이다. */
export function farmgateToRetail(
  krwPerKg: number,
  options: RetailFarmgateOptions = {},
): StageConversion {
  const divisor = options.divisor ?? RETAIL_TO_FARMGATE_DIVISOR
  if (options.premium === true) {
    return failConversion("farmgate", "online_retail", "premium_not_convertible", [
      { code: "price_ladder_premium_excluded", quantity: 1, unit: "count" },
    ])
  }
  if (!Number.isFinite(krwPerKg) || krwPerKg <= 0) {
    return failConversion("farmgate", "online_retail", "invalid_price")
  }
  if (
    !Number.isFinite(divisor) ||
    divisor < RETAIL_TO_FARMGATE_DIVISOR_RANGE.min ||
    divisor > RETAIL_TO_FARMGATE_DIVISOR_RANGE.max
  ) {
    return failConversion("farmgate", "online_retail", "divisor_out_of_range")
  }

  const retail = STAGE_MULTIPLIER.online_retail
  return {
    krwPerKg: krwPerKg * divisor,
    lowKrwPerKg: krwPerKg * retail.low,
    highKrwPerKg: krwPerKg * retail.high,
    from: "farmgate",
    to: "online_retail",
    multiplier: divisor,
    failure: null,
    exclusions: [{ code: "price_stage_multiplier_assumed", quantity: divisor, unit: "ratio" }],
  }
}
