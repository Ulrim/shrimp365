// 단가 앵커의 **농가 수취 단계 검문소.**
//
// lib/pricing 은 소매 앵커로 계산하는 것 자체를 막지 않는다 — "소매에서
// 31.6 g 이 얼마냐" 는 질문이 정당하기 때문이고, 대신
// `price_anchor_not_farmgate` 경고를 올린다. **엔진 3 은 그 경고가 붙은 단가로
// 농가 수익을 계산하면 안 된다.** 같은 크기에서 약 1.9배 과대가 되고(소매
// 33,743원 대 농가 18,114원), 그 수는 멀쩡해 보여서 stage 를 읽지 않으면
// 그대로 영업이익이 된다.
//
// 그래서 이 파일은 **두 가지만 한다 — 거부하거나 변환한다.** 그냥 통과시키는
// 경로가 없다.
//
//   stage 가 farmgate · wholesale  → 그대로 쓴다(농가가 받는 단계다)
//   stage 가 online_retail         → retailToFarmgate(÷2.2, 허용 2.0~2.4)
//   그 밖의 단계                   → convertStage(stage → farmgate)
//   online_premium / premium: true → 거부(유통마진이 아니라 상품 차별화다)
//
// 기본 동작은 **거부**다("reject"). 변환은 호출자가 명시적으로 켜야 하고,
// 변환했다는 사실과 곱한 배수가 `harvest_anchor_converted_to_farmgate` 로
// 반환값에 담겨 나간다.

import {
  STAGE_MULTIPLIER,
  convertStage,
  estimateSizePrice,
  retailToFarmgate,
} from "@/lib/pricing"
import type {
  DistributionStage,
  PriceAnchor,
  SizeElasticity,
  SizePriceEstimate,
} from "@/lib/pricing"

import type { HarvestExclusion } from "./exclusions"

/** 농가가 실제로 돈을 받는 단계. 이 둘만 농가 수익 계산에 쓸 수 있다. */
const FARMGATE_STAGES: readonly DistributionStage[] = ["farmgate", "wholesale"]

export type HarvestPriceInput = {
  /**
   * 단가 앵커. `FARM_PRICE_ANCHOR`(천황수산 도매 17,000 원/kg @ 28.57 g)가
   * 기본 선택지이고, 농가가 받은 실단가가 있으면 그것으로 만든다
   * (`anchorFromCountPerKg`).
   */
  anchor: PriceAnchor
  /** 쓸 탄력성. 기본은 lib/pricing 의 DEFAULT_SIZE_ELASTICITY(0.63, 잠정). */
  elasticity?: SizeElasticity
  /**
   * 농가 수취 단계가 아닌 앵커를 어떻게 하나. **기본 "reject"** 다.
   * "convert" 면 농가 수취 단계로 변환해서 쓴다. **그냥 통과시키는 값은 없다.**
   */
  nonFarmgateAnchor?: "reject" | "convert"
  /** 소매 → 농가 변환 계수. 기본 2.2, 허용 2.0~2.4. 범위 밖은 거부된다. */
  retailToFarmgateDivisor?: number
}

export type HarvestAnchorFailure =
  /** 앵커가 농가 수취 단계가 아니고, 변환이 꺼져 있다. */
  | "price_anchor_not_farmgate"
  /** 변환을 켰지만 변환이 거부됐다(프리미엄 상품·범위 밖 계수·알 수 없는 단계). */
  | "price_anchor_unconvertible"

export type ResolvedHarvestAnchor = {
  /** 농가 수취 단계로 정리된 앵커. 거부되면 null 이다. */
  anchor: PriceAnchor | null
  /** 호출자가 넘긴 원래 앵커. 화면이 "무엇을 변환했나" 를 보여줄 수 있도록. */
  inputAnchor: PriceAnchor
  /** 변환했으면 원래 단계. 안 했으면 null. */
  convertedFrom: DistributionStage | null
  /** 곱한 배수. ÷2.2 면 0.4545… 다. **반올림하지 않는다.** */
  conversionMultiplier: number | null
  failure: HarvestAnchorFailure | null
  exclusions: HarvestExclusion[]
}

/**
 * 앵커를 농가 수취 단계로 정리한다. **거부가 기본 동작이다.**
 */
export function resolveHarvestAnchor(input: HarvestPriceInput): ResolvedHarvestAnchor {
  const anchor = input.anchor
  const base: Omit<ResolvedHarvestAnchor, "anchor" | "failure" | "exclusions"> = {
    inputAnchor: anchor,
    convertedFrom: null,
    conversionMultiplier: null,
  }

  if (FARMGATE_STAGES.includes(anchor.stage)) {
    return { ...base, anchor, failure: null, exclusions: [] }
  }

  const multiplier = STAGE_MULTIPLIER[anchor.stage]
  const mode = input.nonFarmgateAnchor ?? "reject"

  if (mode === "reject") {
    // 거부하면서도 「얼마로 나누면 농가 수취가 되는가」를 함께 알린다 —
    // lib/pricing 의 같은 코드가 담는 수와 같다.
    const toFarmgate = multiplier === undefined ? null : multiplier.point / STAGE_MULTIPLIER.farmgate.point
    return {
      ...base,
      anchor: null,
      failure: "price_anchor_not_farmgate",
      exclusions: [{ code: "price_anchor_not_farmgate", quantity: toFarmgate, unit: "ratio" }],
    }
  }

  // 온라인몰 소매는 전용 변환을 쓴다 — 계수 허용 범위(2.0~2.4) 검사가 거기
  // 붙어 있고, 범위 밖 계수는 끌어당기지 않고 거부된다.
  const conversion =
    anchor.stage === "online_retail"
      ? retailToFarmgate(anchor.krwPerKg, {
          divisor: input.retailToFarmgateDivisor,
          premium: anchor.premium,
        })
      : convertStage(anchor.krwPerKg, anchor.stage, "farmgate")

  if (conversion.krwPerKg === null || conversion.multiplier === null) {
    return {
      ...base,
      anchor: null,
      failure: "price_anchor_unconvertible",
      exclusions: conversion.exclusions,
    }
  }

  // 프리미엄 인증 상품은 유통단계 배수로 환산되지 않는다. convertStage 는
  // online_premium 단계만 거부하므로, premium 플래그가 선 앵커는 여기서 막는다
  // (estimateSizePrice 도 뒤에서 한 번 더 막지만, 변환해 놓고 막으면 변환된
  // 수가 반환값에 남아 화면에 올라갈 수 있다).
  if (anchor.premium) {
    return {
      ...base,
      anchor: null,
      failure: "price_anchor_unconvertible",
      exclusions: [{ code: "price_ladder_premium_excluded", quantity: 1, unit: "count" }],
    }
  }

  return {
    anchor: {
      krwPerKg: conversion.krwPerKg,
      abwG: anchor.abwG,
      stage: "farmgate",
      form: anchor.form,
      premium: anchor.premium,
      observedAt: anchor.observedAt,
      grade: anchor.grade,
      source: anchor.source,
    },
    inputAnchor: anchor,
    convertedFrom: anchor.stage,
    conversionMultiplier: conversion.multiplier,
    failure: null,
    exclusions: [
      {
        code: "harvest_anchor_converted_to_farmgate",
        quantity: conversion.multiplier,
        unit: "ratio",
      },
      ...conversion.exclusions,
    ],
  }
}

/**
 * 한 후보 시점의 단가. lib/pricing 의 estimateSizePrice 를 그대로 쓰고,
 * **탄력성 값만 바꿔 밴드의 양끝을 따로 뽑는다.**
 *
 * 밴드를 estimateSizePrice 의 bandKrwPerKg 에서 읽지 않고 변종 탄력성으로 다시
 * 추정하는 이유 — 이익 밴드는 단가만이 아니라 **개체중 불확실성까지 함께** 양
 * 끝을 잡아야 하고(아래 abwShiftG), 그러려면 같은 함수에 다른 개체중·다른
 * 탄력성을 넣어 끝에서 끝까지 다시 계산하는 쪽이 맞다. 두 수가 일치하는지는
 * scripts/harvest/verify.mjs 가 대조한다.
 */
export function elasticityVariant(elasticity: SizeElasticity, value: number): SizeElasticity {
  return { ...elasticity, value }
}

/** 후보 시점의 단가 추정. 실패하면 estimate.failure 에 이유가 담긴다. */
export function candidatePrice(
  anchor: PriceAnchor,
  targetAbwG: number,
  elasticity: SizeElasticity | undefined,
): SizePriceEstimate {
  return estimateSizePrice(anchor, targetAbwG, elasticity === undefined ? {} : { elasticity })
}
