// 생존율 민감도 — 생존율을 바꿔 가며 손익을 돌려준다.
//
// **이번 실데이터에서 생존율이 손익을 지배한다는 것이 확인됐다.** 천황수산 2024
// 코호트는 나머지를 전부 고정한 채 생존율만 움직여도 −2,921만원에서 +1,104만원
// 까지 간다 — 4,000만원 폭이다. 채널 차이(56%)보다도 크다.
//
//   생존율    영업이익      FCR
//   44.8%   −2,921만원     3.21   ← 실측
//   60%     −1,399만원     2.40
//   70%       −397만원     2.05
//   85%     +1,104만원     1.69
//   손익분기 약 74.0%
//
// 그래서 이 함수가 엔진 2 의 네 번째 수출품이다. 엔진 3 이 출하를 판단할 때도,
// 화면이 "무엇을 고치면 얼마가 달라지나" 를 보여 줄 때도 이것이 필요하다.
//
// ── 무엇을 고정하나 ──────────────────────────────────────────────────────
// 생존율만 바꾸고 **개체중·급이량·비용·단가를 고정한다.** 그래서
//   바이오매스(s) = 입식수 × s × 평균개체중
//   매출(s)       = 바이오매스(s) × 단가
//   비용          = 고정
//
// ── 이 표가 낙관 쪽으로 치우치는 지점 ─────────────────────────────────────
// **폐사한 개체도 죽기 전까지 사료를 먹었다.** 생존율이 높았다면 급이량이
// 같았을 이유가 없다 — 더 많은 개체가 더 오래 먹으므로 사료비가 늘고, 늘어난
// 사료비는 이 표에 없다. 즉 이 표의 "생존율 85% 였다면 +1,104만원" 은
// **상한에 가까운 추정이다.** 급이량·비용을 고정한다는 사실을 assumptions 로
// 함께 돌려주므로, 화면은 금액과 가정을 같이 띄울 수 있다.
//
// 반대 방향의 치우침도 있다 — 1,221 kg 냉동 재고와 12월 출하 209 kg 이 매출에
// 안 잡혀 있어 실측 행의 손실이 과대하다. 두 치우침이 상쇄되는지는 모른다.
// **그래서 둘 다 반환값에 적는다.**

import { resolvePrice } from "./channel"
import type { PriceBasis, RealizedContext, ResolvedPrice } from "./channel"
import type { CostBreakdown } from "./cost"
import { mergeExclusions } from "./exclusions"
import type { Exclusion } from "./exclusions"

export type SurvivalSensitivityInput = {
  /** 입식 마리수. */
  stockedCount?: number | null
  /** 입식 바이오매스(kg). FCR 의 순증체 계산에 쓴다. */
  stockedBiomassKg?: number | null
  /** 총 급이량(kg). **고정된다** — 위 주석의 치우침을 읽을 것. */
  feedKg?: number | null
  /** 출하 개체 평균중량(g). 직접 주거나 아래 두 칸으로 역산한다. */
  meanHarvestWeightG?: number | null
  /** 기준(실측) 출하 총중량(kg). */
  referenceHarvestedKg?: number | null
  /** 기준(실측) 출하 마리수. */
  referenceHarvestedCount?: number | null
  /** 비용. **전 행에서 고정된다.** */
  cost: CostBreakdown
  /**
   * 단가 근거. **필수다.** 민감도에서는 보통 { kind: "realized" } 를 쓴다 —
   * 실측 행과 이어지려면 실현 단가여야 하고, 여기서 채널 중앙값을 끼우면
   * 생존율이 아니라 단가를 바꾼 결과가 섞여 나온다.
   */
  price: PriceBasis | null | undefined
  priceRealizedContext?: RealizedContext
}

export type SurvivalSensitivityRow = {
  /** 0~1. */
  survivalRate: number
  survivingCount: number | null
  biomassKg: number | null
  revenueKrw: number | null
  /** 고정 비용(입력된 항목만). */
  knownCostKrw: number
  operatingProfitKrw: number | null
  costPerKgKrw: number | null
  fcr: number | null
  /** 실측 생존율과 같은 행인가. true 면 그 행만 가정이 아니다. */
  isReference: boolean
  exclusions: Exclusion[]
}

export type SurvivalSensitivity = {
  rows: SurvivalSensitivityRow[]
  /** 실측 생존율(0~1). 기준 실측을 안 받으면 null. */
  referenceSurvivalRate: number | null
  /** 영업이익이 0 이 되는 생존율. 못 구하면 null + failure. */
  breakEven: BreakEvenResult
  price: ResolvedPrice
  /** 고정한 값들. 금액만 보고 "생존율만 고치면 된다" 로 읽지 않도록. */
  assumptions: {
    meanHarvestWeightG: number | null
    feedKgHeldFixed: number | null
    costHeldFixedKrw: number
    priceKrwPerKg: number | null
  }
  exclusions: Exclusion[]
}

export type BreakEvenFailure =
  | "no_price"
  | "no_mean_weight"
  | "no_stocked_count"
  /** 단가·개체중이 0 이하라 어떤 생존율로도 비용을 못 넘는다. */
  | "unreachable"

export type BreakEvenResult = { survivalRate: number | null; failure: BreakEvenFailure | null }

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** 출하 개체 평균중량(g). 직접 받은 값이 먼저다. */
function resolveMeanWeightG(input: SurvivalSensitivityInput): number | null {
  if (isNum(input.meanHarvestWeightG)) return input.meanHarvestWeightG
  if (
    isNum(input.referenceHarvestedKg) &&
    isNum(input.referenceHarvestedCount) &&
    input.referenceHarvestedCount > 0
  ) {
    return (input.referenceHarvestedKg * 1000) / input.referenceHarvestedCount
  }
  return null
}

/**
 * 손익분기 생존율 — 영업이익이 0 이 되는 지점. 닫힌 해다.
 *
 *     s* = 고정비용 ÷ (입식수 × 평균개체중(kg) × 단가)
 *
 * 천황수산 코호트에서 **74.0%** 가 나온다
 * (74,062,800 ÷ (1,200,000 × 0.0095088 kg × 8,774.76 원/kg)).
 *
 * **1 을 넘는 값도 그대로 돌려준다.** 1 을 넘으면 "입식한 전부가 살아도
 * 적자" 라는 뜻이고, 그 신호를 1 로 잘라 버리면 사라진다 — 엔진 1 의
 * cddForAbw 가 음수를 안 자르는 것과 같은 이유다.
 */
export function breakEvenSurvivalRate(
  input: SurvivalSensitivityInput,
  price?: ResolvedPrice,
): BreakEvenResult {
  const resolved = price ?? resolvePrice(input.price, input.priceRealizedContext)
  const meanWeightG = resolveMeanWeightG(input)
  const stockedCount = isNum(input.stockedCount) ? input.stockedCount : null

  if (resolved.krwPerKg === null) return { survivalRate: null, failure: "no_price" }
  if (meanWeightG === null) return { survivalRate: null, failure: "no_mean_weight" }
  if (stockedCount === null || stockedCount <= 0) return { survivalRate: null, failure: "no_stocked_count" }

  const revenuePerUnitSurvival = (stockedCount * meanWeightG * resolved.krwPerKg) / 1000
  if (!(revenuePerUnitSurvival > 0)) return { survivalRate: null, failure: "unreachable" }

  const survivalRate = input.cost.knownTotalKrw / revenuePerUnitSurvival
  if (!Number.isFinite(survivalRate)) return { survivalRate: null, failure: "unreachable" }
  return { survivalRate, failure: null }
}

/**
 * 생존율별 손익. **반올림하지 않는다** — 표시 반올림은 화면 일이다.
 *
 * 입력 생존율의 순서를 그대로 유지한다. 정렬해 주면 호출자가 만든 비교 순서가
 * 바뀐다.
 */
export function survivalSensitivity(
  input: SurvivalSensitivityInput,
  survivalRates: readonly number[],
): SurvivalSensitivity {
  const price = resolvePrice(input.price, input.priceRealizedContext)
  const meanWeightG = resolveMeanWeightG(input)
  const stockedCount = isNum(input.stockedCount) ? input.stockedCount : null
  const stockedBiomassKg = isNum(input.stockedBiomassKg) ? input.stockedBiomassKg : null
  const feedKg = isNum(input.feedKg) ? input.feedKg : null
  const knownCostKrw = input.cost.knownTotalKrw

  const referenceSurvivalRate =
    isNum(input.referenceHarvestedCount) && stockedCount !== null && stockedCount > 0
      ? input.referenceHarvestedCount / stockedCount
      : null

  const rows: SurvivalSensitivityRow[] = []
  for (const survivalRate of survivalRates) {
    const ok = isNum(survivalRate)
    const survivingCount = ok && stockedCount !== null ? stockedCount * survivalRate : null
    const biomassKg =
      survivingCount !== null && meanWeightG !== null ? (survivingCount * meanWeightG) / 1000 : null
    const revenueKrw = biomassKg !== null && price.krwPerKg !== null ? biomassKg * price.krwPerKg : null
    const operatingProfitKrw = revenueKrw !== null ? revenueKrw - knownCostKrw : null
    const costPerKgKrw = biomassKg !== null && biomassKg > 0 ? knownCostKrw / biomassKg : null

    const gainKg = biomassKg !== null && stockedBiomassKg !== null ? biomassKg - stockedBiomassKg : null
    const fcr = feedKg !== null && gainKg !== null && gainKg > 0 ? feedKg / gainKg : null

    const isReference =
      referenceSurvivalRate !== null && ok && Math.abs(survivalRate - referenceSurvivalRate) < 1e-9

    rows.push({
      survivalRate,
      survivingCount,
      biomassKg,
      revenueKrw,
      knownCostKrw,
      operatingProfitKrw,
      costPerKgKrw,
      fcr,
      isReference,
      // 실측 행이 아니면 생존율은 가정이다. 금액과 함께 그 사실이 나간다.
      exclusions: isReference
        ? []
        : [{ code: "survival_rate_assumed", quantity: ok ? survivalRate : null, unit: "ratio" }],
    })
  }

  return {
    rows,
    referenceSurvivalRate,
    breakEven: breakEvenSurvivalRate(input, price),
    price,
    assumptions: {
      meanHarvestWeightG: meanWeightG,
      feedKgHeldFixed: feedKg,
      costHeldFixedKrw: knownCostKrw,
      priceKrwPerKg: price.krwPerKg,
    },
    exclusions: mergeExclusions(input.cost.exclusions, price.exclusions),
  }
}
