// 후보 시점 하나의 손익 — **엔진 1·2·단가를 합치는 자리다.**
//
//   개체중    엔진 1 predictAbw (outlook.ts 가 날짜 축으로 올린다)
//   마리수    일별 생존율^d (survival.ts)
//   단가      엔진 단가 estimateSizePrice (price.ts 가 유통단계를 검문한다)
//   금액      엔진 2 projectHarvestScenarios — **금액 산식을 다시 쓰지 않는다**
//
// ── 금액을 엔진 2 에 맡기는 이유 ─────────────────────────────────────────
// 바이오매스 × 단가 − 비용은 한 줄이라 여기서 다시 쓰고 싶어진다. 쓰지 않는다.
// 엔진 2 의 projectHarvestScenarios 가 이미 그 산식이고, 누적비용 + 잔여기간
// 비용 합산(addCosts), 미입력 항목 처리(knownTotalKrw·missingItems), 확정매출
// 합산, 그리고 시나리오마다 붙는 경고(abw_from_growth_projection ·
// survival_rate_assumed · remaining_period_cost_not_estimated)가 전부 거기
// 있다. 여기서 다시 쓰면 두 엔진의 금액이 조용히 벌어지고, 어느 쪽이 맞는지
// 아무도 모르게 된다.
//
// **엔진 2 를 후보마다 한 번씩 부른다** — 엔진 2 는 시나리오 묶음 하나에 단가
// 하나를 쓰도록 설계돼 있고(크기에 따라 단가를 올리지 않는다는 경계), 엔진 3 은
// 후보마다 단가가 다르기 때문이다. 단가는 `{ kind: "explicit" }` 로 넣는다 —
// 채널 중앙값으로 조용히 떨어지는 경로를 타지 않는다.
//
// `channel` 은 넘기지 않는다. 엔진 2 의 채널 어휘(wholesale / retail_live /
// retail_frozen)와 단가 모델의 유통단계 어휘(farmgate / wholesale /
// online_retail / …)가 같은 축이 아니어서, 억지로 대응시키면 반환값의 channel
// 이 실제와 다른 뜻을 갖는다. 대신 엔진 3 이 단가의 stage·form 을 돌려준다.
//
// ── 밴드는 양끝을 다시 계산한다 ──────────────────────────────────────────
// 이익 밴드의 하한·상한은 **후보 하나를 세 번 평가해서** 만든다.
//
//   point : 탄력성 0.63(기본), 개체중 그대로
//   low   : 탄력성 밴드 하한, 개체중 −abwUncertaintyG
//   high  : 탄력성 밴드 상한, 개체중 +abwUncertaintyG
//
// 단가만 비례해 늘리지 않는 이유 — 개체중이 흔들리면 **바이오매스와 단가가
// 같이** 움직이고, 일급이량을 바이오매스 비율로 받은 경우 **비용까지** 움직인다.
// 양끝을 끝에서 끝까지 다시 계산하면 그 연결이 저절로 지켜진다.
//
// 기본 abwUncertaintyG 는 **0** 이다. 엔진 1 의 홀드아웃 MAE(0.895 g)를 엔진 3
// 이 제 값으로 박아 넣지 않는다 — 그것은 엔진 1 의 성능 주장이고, 복사해 두면
// 엔진 1 이 좋아져도 이 수가 남는다. 대신 밴드에 개체중 폭이 0 이라는 사실을
// `harvest_abw_uncertainty_not_in_band` 로 알린다.

import { computeCost, costOf, projectHarvestScenarios } from "@/lib/profitability"
import type {
  CostBreakdown,
  CostInput,
  CostItem,
  CostUnitPrices,
  HarvestScenario,
} from "@/lib/profitability"
import { countPerKgFromAbwG } from "@/lib/pricing"
import type { PriceAnchor, SizeElasticity, SizePriceEstimate } from "@/lib/pricing"

import { addDays } from "./dates"
import { mergeHarvestExclusions } from "./exclusions"
import type { HarvestExclusion } from "./exclusions"
import { abwAtDay } from "./outlook"
import type { AbwOutlook } from "./outlook"
import { candidatePrice, elasticityVariant } from "./price"
import { survivalOverDays } from "./survival"

/**
 * 하루치 추가 비용. **엔진 3 은 급이량을 추정하지 않는다** — 권장 급이량은
 * 엔진 5 의 몫이고, 엔진 2 projection.ts 가 같은 경계를 그어 두었다.
 * 아무것도 안 주면 0 으로 채우지 않고 엔진 2 의
 * `remaining_period_cost_not_estimated` 가 올라간다.
 */
export type HarvestCostInput = {
  /** 하루 급이량(kg). 호출자 입력이다. */
  feedKgPerDay?: number | null
  /**
   * 바이오매스 대비 일급이율(0~1). feedKgPerDay 가 없을 때만 쓴다.
   * **엔진 5 의 추정이 아니라 호출자가 넣은 수다** —
   * `harvest_feed_rate_caller_supplied` 로 그 사실이 나간다.
   */
  feedRateOfBiomassPerDay?: number | null
  /** 하루 전기 사용량(kWh). 단가는 unitPrices 로 받는다(기본 실청구 88.6원). */
  electricityKwhPerDay?: number | null
  /** 하루 전기요금(원). kWh 와 둘 다 주면 **금액이 이긴다**(엔진 2 규칙). */
  electricityKrwPerDay?: number | null
  /** 하루 기타 비용(원) — 인건·약품 등. */
  otherKrwPerDay?: number | null
}

/** 엔진 3 이 후보를 평가할 때 들고 다니는 것. 전부 이미 정리된 값이다. */
export type HarvestContext = {
  /** 지금 살아 있는 마리수. */
  survivingCountNow: number
  /** 입식 마리수. 엔진 2 가 코호트 생존율을 반환값에 담는 데만 쓴다. */
  stockedCount: number | null
  abw: AbwOutlook
  /** 하루 생존율(0~1). resolveDailySurvival 이 정한 값. */
  dailySurvivalRate: number
  /** 농가 수취 단계로 정리된 앵커. */
  anchor: PriceAnchor
  elasticity: SizeElasticity
  incurredCost: CostBreakdown
  confirmedRevenueKrw: number | null
  dailyCost: HarvestCostInput
  unitPrices: CostUnitPrices
  /** 밴드에 담을 개체중 폭(±g). 기본 0. */
  abwUncertaintyG: number
  /**
   * 기준일(YYYY-MM-DD) 또는 null. 후보에 날짜를 붙이는 데만 쓴다 —
   * **계산에는 들어가지 않는다**(계절 보정이 없으므로 달이 금액을 바꾸지
   * 않는다). null 이면 날짜 칸이 null 이고, 엔진이 오늘을 지어내지 않는다.
   */
  asOfDate: string | null
}

/** 밴드 양끝을 만드는 변종. */
export type VariantSpec = {
  /** 개체중에 더할 값(g). low 는 음수, high 는 양수. */
  abwShiftG: number
  /** 쓸 탄력성 값. */
  elasticityValue: number
}

export type CandidateVariant = {
  abwG: number
  cdd: number | null
  biomassKg: number
  priceKrwPerKg: number
  price: SizePriceEstimate
  /** 지금부터 그 시점까지 **추가로** 들어가는 비용만. */
  additional: CostBreakdown
  /** 누적 + 추가를 엔진 2 가 합친 시나리오. */
  scenario: HarvestScenario
  operatingProfitKrw: number
}

export type VariantResult = {
  variant: CandidateVariant | null
  failure: CandidateFailure | null
  /** 급이량을 바이오매스 비율로 구했는가. */
  feedFromRate: boolean
  /**
   * **실패했을 때 그 이유를 담은 경고.** 성공하면 비어 있다(성공 경로의 경고는
   * 후보가 따로 모은다).
   *
   * 이게 없으면 단가가 거부된 이유가 여기서 사라진다 — 호출자는
   * `failure: "price_unavailable"` 만 받고, 화면은 「그 크기의 단가를 구할 수
   * 없습니다」라고만 쓰게 된다. 냉동 계수로 활 단가를 계산하려다 막힌 것인지,
   * 앵커가 프리미엄 상품이라 막힌 것인지 구분되지 않는다.
   */
  exclusions: HarvestExclusion[]
}

/** 세 변종 묶음. 밴드와 차액 밴드의 기준이 된다. */
export type CandidateVariants = {
  point: CandidateVariant | null
  low: CandidateVariant | null
  high: CandidateVariant | null
}

/**
 * 근거 분해의 기준점 — **"지금 출하"** 다. 양끝까지 들고 있는 이유는 차액
 * 밴드가 「같은 쪽 끝끼리」 비교돼야 하기 때문이다. point 끝과 band 끝을 섞어
 * 비교하면 폭이 가짜로 넓어진다.
 */
export type HarvestBaseline = {
  dayOffset: number
  survivingCount: number
  variants: CandidateVariants
}

/** 근거 분해의 항목 코드. **문장이 아니라 코드다** — 번역은 화면이 맡는다. */
export type AttributionCode =
  /** 큰 개체의 kg당 단가 프리미엄. 지금 바이오매스 × 단가 상승분. */
  | "size_premium"
  /** 개체중 증가분. 마리수를 지금으로 고정하고 센 성장. */
  | "growth"
  /** 마리수 감소분. 개체중을 지금으로 고정하고 센 폐사. **음수다.** */
  | "mortality"
  /** 위 셋으로 나뉘지 않는 교차항(성장×폐사, 바이오매스×단가). */
  | "price_size_interaction"
  /** 추가 비용. 항목은 엔진 2 의 CostItem 그대로다. **음수다.** */
  | `cost_${CostItem}`

export type AttributionComponent = { code: AttributionCode; krw: number }

/**
 * 추천의 근거를 **구조로** 돌려준다. 화면이 이것을 보여줘야 농가가 납득한다.
 *
 * 항목의 합은 profitDeltaKrw 와 **정확히 같다** — 교차항을 잔차로 두어 그렇게
 * 만들었다. 그럴듯한 분해를 만들어 놓고 합이 안 맞으면 화면이 그 차이를
 * 숨기거나 꾸며야 한다.
 */
export type ProfitAttribution = {
  baselineDayOffset: number
  revenueDeltaKrw: number
  costDeltaKrw: number
  profitDeltaKrw: number
  components: readonly AttributionComponent[]
  /** 가장 큰 플러스 기여. 없으면 null. */
  dominantGainCode: AttributionCode | null
  /** 가장 큰 마이너스 기여. 없으면 null. */
  dominantLossCode: AttributionCode | null
}

export type CandidateFailure =
  /** 그 시점의 개체중을 못 구했다(수온 전망·개체중 배열이 모자라다). */
  | "abw_unavailable"
  /** 생존율에서 마리수를 못 구했다. */
  | "survival_unavailable"
  /** 단가 추정이 거부됐다. 이유는 변종의 price.failure 에 있다. */
  | "price_unavailable"
  /** 엔진 2 가 영업이익을 못 냈다(매출·비용 중 한쪽이 null). */
  | "profit_unavailable"

export type HarvestCandidate = {
  dayOffset: number
  /**
   * 그 시점의 날짜(YYYY-MM-DD). 기준일을 안 받으면 null 이다. 화면의 x축이
   * 날짜이므로 후보마다 들고 다닌다 — 적산수온이 아니라 날짜다.
   */
  date: string | null
  abwG: number | null
  /** 그 개체중의 미/kg. 농가가 등급으로 읽는 표기다. */
  countPerKg: number | null
  /** gompertz 경로일 때의 적산수온(℃·일). */
  cdd: number | null
  /** 지금 대비 누적 생존율(s^d). */
  survivalFromNow: number | null
  survivingCount: number | null
  biomassKg: number | null
  priceKrwPerKg: number | null
  /** 탄력성 밴드 양끝의 단가. */
  priceBandKrwPerKg: { low: number; high: number } | null
  /**
   * 앵커 단가에 대한 비(= 크기 프리미엄 배수). 1.0655 면 +6.55% 다.
   * 금액과 별개로 화면이 「크기 프리미엄」 행의 보조 수치로 쓴다.
   */
  priceRatioFromAnchor: number | null
  /** 그 크기가 사다리 관측 범위(23.5~33.3 g) 밖인가. */
  priceOutsideObservedSize: boolean
  /** 예측 개체중이 엔진 1 의 고정 상한(Winf)에 닿았는가. */
  abwAtWinfCeiling: boolean
  revenueKrw: number | null
  /**
   * 지금 대비 추가 비용(원). 0일 후보는 0 이고, **안 받았으면 0 이 아니라
   * null 이다.**
   */
  additionalCostKrw: number | null
  /** 누적 + 추가. 엔진 2 의 CostBreakdown 그대로. */
  cost: CostBreakdown | null
  costPerKgKrw: number | null
  operatingProfitKrw: number | null
  /** 이익 밴드. 단가 탄력성 양끝(+ 개체중 폭)으로 만든다. */
  profitBandKrw: { low: number; high: number } | null
  /** "지금 출하" 대비 영업이익 차액. 양수면 더 키우는 쪽이 이익이다. */
  profitDeltaFromNowKrw: number | null
  /** 그 차액의 밴드. 같은 쪽 끝끼리 비교한 값이다. */
  profitDeltaBandKrw: { low: number; high: number } | null
  attribution: ProfitAttribution | null
  failure: CandidateFailure | null
  exclusions: HarvestExclusion[]
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** 그 시점의 개체중(변종 보정 포함). */
function shiftedAbwG(ctx: HarvestContext, dayOffset: number, abwShiftG: number): number | null {
  const at = abwAtDay(ctx.abw, dayOffset)
  if (at.abwG === null) return null
  const abwG = at.abwG + abwShiftG
  return abwG > 0 ? abwG : null
}

/** 그 시점의 바이오매스(kg). 급이량을 바이오매스 비율로 받을 때 날마다 쓴다. */
function biomassAtDay(ctx: HarvestContext, dayOffset: number, abwShiftG: number): number | null {
  const abwG = shiftedAbwG(ctx, dayOffset, abwShiftG)
  if (abwG === null) return null
  const survival = survivalOverDays(ctx.dailySurvivalRate, dayOffset)
  if (survival === null) return null
  return (ctx.survivingCountNow * survival * abwG) / 1000
}

/**
 * 지금부터 d일까지 **추가로** 들어가는 비용의 수량. 금액 환산은 엔진 2 의
 * computeCost 가 한다(단가 기본값과 미입력 처리가 거기 있다).
 *
 * 급이량을 바이오매스 비율로 받으면 **날마다 바이오매스가 달라지므로 하루씩
 * 쌓는다.** d × (지금 바이오매스 × 비율)로 계산하면 성장분을 놓치고, 그 방향이
 * 사료비 과소 — 즉 "더 키우라" 쪽으로 틀린다.
 */
function accumulateAdditionalCost(
  ctx: HarvestContext,
  dayOffset: number,
  abwShiftG: number,
): { input: CostInput; feedFromRate: boolean } {
  if (dayOffset <= 0) return { input: {}, feedFromRate: false }

  const d = ctx.dailyCost
  const input: CostInput = {}
  let feedFromRate = false

  if (isNum(d.feedKgPerDay)) {
    input.feedKg = d.feedKgPerDay * dayOffset
  } else if (isNum(d.feedRateOfBiomassPerDay)) {
    let feedKg = 0
    let ok = true
    for (let t = 0; t < dayOffset; t++) {
      const biomass = biomassAtDay(ctx, t, abwShiftG)
      if (biomass === null) {
        ok = false
        break
      }
      feedKg += biomass * d.feedRateOfBiomassPerDay
    }
    if (ok) {
      input.feedKg = feedKg
      feedFromRate = true
    }
  }

  if (isNum(d.electricityKrwPerDay)) input.electricityKrw = d.electricityKrwPerDay * dayOffset
  if (isNum(d.electricityKwhPerDay)) input.electricityKwh = d.electricityKwhPerDay * dayOffset
  if (isNum(d.otherKrwPerDay)) input.otherKrw = d.otherKrwPerDay * dayOffset

  return { input, feedFromRate }
}

/** 후보 하나를 한 변종으로 평가한다. 어느 한 칸이라도 못 구하면 variant 가 null 이다. */
export function evaluateVariant(
  ctx: HarvestContext,
  dayOffset: number,
  variant: VariantSpec,
): VariantResult {
  const abwG = shiftedAbwG(ctx, dayOffset, variant.abwShiftG)
  if (abwG === null) return { variant: null, failure: "abw_unavailable", feedFromRate: false, exclusions: [] }

  const survival = survivalOverDays(ctx.dailySurvivalRate, dayOffset)
  if (survival === null) {
    return { variant: null, failure: "survival_unavailable", feedFromRate: false, exclusions: [] }
  }
  const survivingCount = ctx.survivingCountNow * survival

  const price = candidatePrice(
    ctx.anchor,
    abwG,
    elasticityVariant(ctx.elasticity, variant.elasticityValue),
  )
  if (price.krwPerKg === null) {
    // 단가 모델이 올린 거부 사유를 그대로 들고 나간다.
    return { variant: null, failure: "price_unavailable", feedFromRate: false, exclusions: price.exclusions }
  }

  const { input: additionalInput, feedFromRate } = accumulateAdditionalCost(
    ctx,
    dayOffset,
    variant.abwShiftG,
  )

  // 금액은 엔진 2 가 낸다. **여기서 다시 쓰지 않는다.**
  const projection = projectHarvestScenarios(
    {
      stockedCount: ctx.stockedCount,
      incurredCost: ctx.incurredCost,
      confirmedRevenueKrw: ctx.confirmedRevenueKrw,
      price: { kind: "explicit", krwPerKg: price.krwPerKg },
      unitPrices: ctx.unitPrices,
    },
    [{ dayOffset, abw: { kind: "abw_g", abwG }, survivingCount, additionalCost: additionalInput }],
  )
  const scenario = projection.scenarios[0]
  if (scenario === undefined || scenario.operatingProfitKrw === null || scenario.biomassKg === null) {
    return { variant: null, failure: "profit_unavailable", feedFromRate, exclusions: [] }
  }

  // 「지금 대비 추가분」만 따로 들고 있어야 근거 분해에서 비용 항목을 뽑을 수
  // 있다. 엔진 2 는 누적과 추가를 합쳐 돌려주므로 같은 입력으로 한 번 더 부른다.
  const additional = computeCost(additionalInput, ctx.unitPrices)

  return {
    variant: {
      abwG,
      cdd: abwAtDay(ctx.abw, dayOffset).cdd,
      biomassKg: scenario.biomassKg,
      priceKrwPerKg: price.krwPerKg,
      price,
      additional,
      scenario,
      operatingProfitKrw: scenario.operatingProfitKrw,
    },
    failure: null,
    feedFromRate,
    // 성공했을 때의 경고는 후보가 따로 모은다(아래 `own` · price.exclusions).
    exclusions: [],
  }
}

/**
 * 근거 분해 — 지금 출하 대비 이익 차액이 **어디서 왔나.**
 *
 *   매출 차액 = 크기 프리미엄 + 성장 + 폐사 + 교차항
 *     크기 프리미엄 = 지금 바이오매스 × (그때 단가 − 지금 단가)
 *     성장         = 지금 마리수 × (그때 개체중 − 지금 개체중) ÷ 1000 × 지금 단가
 *     폐사         = (그때 마리수 − 지금 마리수) × 지금 개체중 ÷ 1000 × 지금 단가
 *     교차항       = 잔차. 성장×폐사와 바이오매스×단가가 섞인 항이다
 *   비용 차액 = 추가 비용(항목별, 부호를 뒤집어 담는다)
 *
 * **잔차를 교차항으로 두어 합이 정확히 맞게 만든다.** 세 항만 보여 주고 합이
 * 안 맞으면 화면이 그 차이를 숨기거나 꾸며야 한다.
 */
export function attributeProfit(
  baseline: { dayOffset: number; variant: CandidateVariant; survivingCount: number },
  candidate: { variant: CandidateVariant; survivingCount: number },
): ProfitAttribution {
  const r0 = baseline.variant.scenario.projectedRevenueKrw ?? 0
  const rd = candidate.variant.scenario.projectedRevenueKrw ?? 0
  const revenueDeltaKrw = rd - r0

  const b0 = baseline.variant.biomassKg
  const p0 = baseline.variant.priceKrwPerKg
  const pd = candidate.variant.priceKrwPerKg
  const n0 = baseline.survivingCount
  const nd = candidate.survivingCount
  const w0 = baseline.variant.abwG
  const wd = candidate.variant.abwG

  const sizePremium = b0 * (pd - p0)
  const growth = ((n0 * (wd - w0)) / 1000) * p0
  const mortality = (((nd - n0) * w0) / 1000) * p0
  const interaction = revenueDeltaKrw - sizePremium - growth - mortality

  const components: AttributionComponent[] = [
    { code: "size_premium", krw: sizePremium },
    { code: "growth", krw: growth },
    { code: "mortality", krw: mortality },
    { code: "price_size_interaction", krw: interaction },
  ]

  let costDeltaKrw = 0
  for (const line of candidate.variant.additional.lines) {
    const baselineKrw = costOf(baseline.variant.additional, line.item) ?? 0
    const delta = line.krw - baselineKrw
    costDeltaKrw += delta
    components.push({ code: `cost_${line.item}`, krw: -delta })
  }

  let dominantGainCode: AttributionCode | null = null
  let dominantLossCode: AttributionCode | null = null
  let maxGain = 0
  let maxLoss = 0
  for (const c of components) {
    if (c.krw > maxGain) {
      maxGain = c.krw
      dominantGainCode = c.code
    }
    if (c.krw < maxLoss) {
      maxLoss = c.krw
      dominantLossCode = c.code
    }
  }

  return {
    baselineDayOffset: baseline.dayOffset,
    revenueDeltaKrw,
    costDeltaKrw,
    profitDeltaKrw: revenueDeltaKrw - costDeltaKrw,
    components,
    dominantGainCode,
    dominantLossCode,
  }
}

/** 두 끝의 차액. 같은 쪽 끝끼리만 뺀다. */
function endDelta(
  candidate: CandidateVariant | null,
  baseline: CandidateVariant | null,
): number | null {
  if (candidate === null || baseline === null) return null
  return candidate.operatingProfitKrw - baseline.operatingProfitKrw
}

/**
 * 후보 하나를 평가한다 — point·low·high 세 변종 + 근거 분해.
 *
 * baseline 이 null 이면(지금 출하 후보 자신을 평가할 때) 분해와 차액이 null 이다.
 */
export function evaluateCandidate(
  ctx: HarvestContext,
  dayOffset: number,
  baseline: HarvestBaseline | null,
): { candidate: HarvestCandidate; variants: CandidateVariants } {
  const u = ctx.abwUncertaintyG
  const band = ctx.elasticity.band

  const point = evaluateVariant(ctx, dayOffset, { abwShiftG: 0, elasticityValue: ctx.elasticity.value })
  const low = evaluateVariant(ctx, dayOffset, { abwShiftG: -u, elasticityValue: band.low })
  const high = evaluateVariant(ctx, dayOffset, { abwShiftG: u, elasticityValue: band.high })
  const variants: CandidateVariants = {
    point: point.variant,
    low: low.variant,
    high: high.variant,
  }

  const survival = survivalOverDays(ctx.dailySurvivalRate, dayOffset)
  const survivingCount = survival === null ? null : ctx.survivingCountNow * survival

  if (point.variant === null) {
    return {
      candidate: {
        dayOffset,
        date: addDays(ctx.asOfDate, dayOffset),
        abwG: null,
        countPerKg: null,
        cdd: null,
        survivalFromNow: survival,
        survivingCount,
        biomassKg: null,
        priceKrwPerKg: null,
        priceBandKrwPerKg: null,
        priceRatioFromAnchor: null,
        priceOutsideObservedSize: false,
        abwAtWinfCeiling: false,
        revenueKrw: null,
        additionalCostKrw: null,
        cost: null,
        costPerKgKrw: null,
        operatingProfitKrw: null,
        profitBandKrw: null,
        profitDeltaFromNowKrw: null,
        profitDeltaBandKrw: null,
        attribution: null,
        failure: point.failure,
        // **비워 두면 실패의 이유가 사라진다.** 단가가 거부된 경우 그 사유가
        // point.exclusions 에 들어 있다 — 예: 냉동 계수로 활 단가를 계산하려다
        // 막히면 price_ladder_form_not_slope_eligible. 호출자가
        // failure 코드만 받으면 「단가를 구할 수 없다」까지만 알 수 있고,
        // 화면은 농가에게 엉뚱한 원인을 지목하게 된다.
        exclusions: mergeHarvestExclusions(point.exclusions),
      },
      variants,
    }
  }

  const v = point.variant
  const at = abwAtDay(ctx.abw, dayOffset)

  const profitEnds = [low.variant?.operatingProfitKrw, high.variant?.operatingProfitKrw].filter(isNum)
  const profitBandKrw =
    profitEnds.length === 2 ? { low: Math.min(...profitEnds), high: Math.max(...profitEnds) } : null
  const priceEnds = [low.variant?.priceKrwPerKg, high.variant?.priceKrwPerKg].filter(isNum)
  const priceBandKrwPerKg =
    priceEnds.length === 2 ? { low: Math.min(...priceEnds), high: Math.max(...priceEnds) } : null

  const attribution =
    baseline === null || baseline.variants.point === null || survivingCount === null
      ? null
      : attributeProfit(
          {
            dayOffset: baseline.dayOffset,
            variant: baseline.variants.point,
            survivingCount: baseline.survivingCount,
          },
          { variant: v, survivingCount },
        )

  const deltaEnds =
    baseline === null
      ? []
      : [
          endDelta(low.variant, baseline.variants.low),
          endDelta(high.variant, baseline.variants.high),
        ].filter(isNum)
  const profitDeltaBandKrw =
    deltaEnds.length === 2 ? { low: Math.min(...deltaEnds), high: Math.max(...deltaEnds) } : null

  const own: HarvestExclusion[] = []
  if (at.atWinfCeiling && at.winfG !== null) {
    own.push({ code: "harvest_abw_at_winf_ceiling", quantity: at.winfG, unit: "gram" })
  }
  if (point.feedFromRate && isNum(ctx.dailyCost.feedRateOfBiomassPerDay)) {
    own.push({
      code: "harvest_feed_rate_caller_supplied",
      quantity: ctx.dailyCost.feedRateOfBiomassPerDay,
      unit: "ratio",
    })
  }

  return {
    candidate: {
      dayOffset,
      date: addDays(ctx.asOfDate, dayOffset),
      abwG: v.abwG,
      countPerKg: countPerKgFromAbwG(v.abwG),
      cdd: v.cdd,
      survivalFromNow: survival,
      survivingCount,
      biomassKg: v.biomassKg,
      priceKrwPerKg: v.priceKrwPerKg,
      priceBandKrwPerKg,
      priceRatioFromAnchor: v.price.priceRatio,
      priceOutsideObservedSize: v.price.exclusions.some(
        (e) => e.code === "price_target_outside_observed_size",
      ),
      abwAtWinfCeiling: at.atWinfCeiling,
      revenueKrw: v.scenario.revenueKrw,
      // 안 받은 추가 비용은 0 이 아니라 null 이다. 0일 후보만 실제로 0 이다.
      additionalCostKrw:
        dayOffset === 0 ? 0 : v.additional.lines.length > 0 ? v.additional.knownTotalKrw : null,
      cost: v.scenario.cost,
      costPerKgKrw: v.scenario.costPerKgKrw,
      operatingProfitKrw: v.operatingProfitKrw,
      profitBandKrw,
      profitDeltaFromNowKrw: attribution === null ? null : attribution.profitDeltaKrw,
      profitDeltaBandKrw,
      attribution,
      failure: null,
      // 대표값(point)의 경고를 먼저 넣는다 — 병합이 먼저 들어온 quantity 를
      // 남기므로, 화면에 올라가는 수가 추천 시점의 추정값이 된다.
      exclusions: mergeHarvestExclusions(v.price.exclusions, v.scenario.exclusions, own),
    },
    variants,
  }
}
