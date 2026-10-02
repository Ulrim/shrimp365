// 예상 지표 — **엔진 1 의 성장 예측 위에 올라간다.**
//
// 「지금 출하 / N일 뒤 출하」 각각의 예상 바이오매스·매출·원가·영업이익.
// 계획서 2-2 가 요구한 "예상 영업이익" 이 이것이다
// (docs/plans/tips-2026-gap-and-plan.md 4절 엔진 2).
//
// ── 엔진 경계 ─────────────────────────────────────────────────────────────
// 여기서 **하지 않는** 것 세 가지다. 셋 다 하고 싶어지지만 하면 안 된다.
//
//  1. **적산수온을 날짜로 바꾸지 않는다.** "N일 뒤의 적산수온" 은 수온 전망이
//     필요하고 그건 엔진 3 의 몫이다(lib/growth/gompertz.ts 의 cddForAbw 주석).
//     호출자가 시나리오마다 cdd 또는 ABW 를 직접 넣는다.
//  2. **크기에 따라 단가를 올리지 않는다.** 실데이터의 (크기, 단가) 조합이 단
//     1개라 기울기가 정의되지 않는다(constants.ts 의 SIZE_PRICE_ANCHOR).
//     "더 키우면 kg당 단가가 오른다" 를 넣으려면 외부 시세가 먼저다.
//  3. **잔여기간 급이량을 추정하지 않는다.** 권장 급이량은 엔진 5 다. 안 받으면
//     0 으로 채우지 않고 EXCLUSION "remaining_period_cost_not_estimated" 로
//     알린다 — 0 으로 채우면 N일 뒤 이익이 사료비만큼 부풀고, 그 방향이
//     "더 키워라" 라서 가장 위험한 착각이다.
//
// ── 출하 적기 판정은 여기가 아니다 ───────────────────────────────────────
// 시나리오별 금액과 지금 대비 차액까지만 돌려준다. "한계수익 = 한계비용" 으로
// 구간을 고르는 것은 엔진 3 이다. **문장은 만들지 않는다.**

import { predictAbw } from "@/lib/growth"
import type { GompertzParams } from "@/lib/growth"
import { resolvePrice } from "./channel"
import type { PriceBasis, RealizedContext, ResolvedPrice, SalesChannel } from "./channel"
import { addCosts, computeCost } from "./cost"
import type { CostBreakdown, CostInput, CostUnitPrices } from "./cost"
import { mergeExclusions } from "./exclusions"
import type { Exclusion } from "./exclusions"

/** 출하 시점의 개체중. 엔진 1 의 출력을 그대로 받는 두 가지 형태. */
export type ProjectedAbw =
  /** 이미 g 으로 가진 값. */
  | { kind: "abw_g"; abwG: number }
  /** 엔진 1 적합 결과 + 그 시점의 적산수온. predictAbw 로 푼다. */
  | { kind: "gompertz"; params: GompertzParams; cdd: number }

export type HarvestScenarioInput = {
  /** 지금부터 출하까지 남은 일수. **0 이면 "지금 출하"** 다. */
  dayOffset: number
  abw: ProjectedAbw
  /** 그 시점의 예상 생존 마리수. */
  survivingCount?: number | null
  /** 마리수 대신 생존율(0~1)로 줄 수도 있다. stockedCount 와 함께 쓴다. */
  survivalRate?: number | null
  /**
   * 지금부터 그 시점까지 **추가로** 들어갈 비용. dayOffset > 0 인데 비어 있으면
   * 이익이 과대평가되므로 EXCLUSION 으로 알린다.
   */
  additionalCost?: CostInput
}

export type ProjectionBase = {
  /** 입식 마리수. survivalRate 로 마리수를 구할 때만 쓴다. */
  stockedCount?: number | null
  /** 지금까지의 누적 비용(실적). computeCost 의 결과를 넣는다. */
  incurredCost: CostBreakdown
  /** 이미 확정된 매출(부분 출하분). 없으면 생략한다 — 0 과 다르다. */
  confirmedRevenueKrw?: number | null
  /**
   * 출하 단가의 근거. **필수 인자다** — 안 넘기면 기본 채널로 떨어지지 않고
   * 매출이 null 로 나온다. 도매 17,000 과 소매 활새우 26,500 이 56% 벌어지므로
   * 조용히 하나를 고르면 56% 틀린 금액이 화면에 올라간다.
   */
  price: PriceBasis | null | undefined
  /** price.kind 가 "realized" 일 때의 역산 근거. */
  priceRealizedContext?: RealizedContext
  /** 잔여기간 비용을 수량으로 넣을 때의 단가. 기본값은 constants.ts. */
  unitPrices?: CostUnitPrices
}

export type HarvestScenario = {
  dayOffset: number
  abwG: number | null
  survivingCount: number | null
  survivalRate: number | null
  /** 예상 바이오매스(kg) = 마리수 × 개체중 ÷ 1000. */
  biomassKg: number | null
  priceKrwPerKg: number | null
  channel: SalesChannel | null
  /** 바이오매스 × 단가. 확정 매출은 포함하지 않는다. */
  projectedRevenueKrw: number | null
  confirmedRevenueKrw: number | null
  /** 확정 + 예상. 둘 다 없으면 null. */
  revenueKrw: number | null
  /** 누적 + 잔여기간. */
  cost: CostBreakdown
  /** 예상 바이오매스 1 kg 당 원가(원). */
  costPerKgKrw: number | null
  operatingProfitKrw: number | null
  operatingMarginRate: number | null
  /**
   * 첫 시나리오(보통 "지금 출하") 대비 영업이익 차액(원). 양수면 더 키우는 쪽이
   * 이익이다. **판정은 하지 않는다** — 차액만 돌려주고 출하 구간 선택은 엔진 3.
   */
  profitDeltaFromFirstKrw: number | null
  exclusions: Exclusion[]
}

export type HarvestProjection = {
  scenarios: HarvestScenario[]
  /** 어느 단가 근거로 계산했나. 채널이 반환값에 담겨 나간다. */
  price: ResolvedPrice
  exclusions: Exclusion[]
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** 시나리오의 개체중(g). gompertz 형태면 엔진 1 의 predictAbw 로 푼다. */
export function resolveAbwG(abw: ProjectedAbw | null | undefined): number | null {
  if (abw == null) return null
  if (abw.kind === "abw_g") return isNum(abw.abwG) ? abw.abwG : null
  const { params, cdd } = abw
  if (!isNum(cdd) || !isNum(params?.winfG) || !isNum(params?.b) || !isNum(params?.k)) return null
  const abwG = predictAbw(params, cdd)
  return isNum(abwG) ? abwG : null
}

/**
 * 「지금 출하 / N일 뒤 출하」 시나리오별 예상 손익.
 *
 * 돌려주는 금액은 **예측이다.** 그래서 시나리오마다
 * "abw_from_growth_projection"·"survival_rate_assumed" 가 EXCLUSION 에 항상
 * 들어간다 — 실적(computeActuals)과 섞여 화면에 올라가도 어느 쪽이 예측인지
 * 반환값만 보고 구분할 수 있어야 한다.
 */
export function projectHarvestScenarios(
  base: ProjectionBase,
  scenarios: readonly HarvestScenarioInput[],
): HarvestProjection {
  const price = resolvePrice(base.price, base.priceRealizedContext)
  const stockedCount = isNum(base.stockedCount) ? base.stockedCount : null
  const confirmedRevenueKrw = isNum(base.confirmedRevenueKrw) ? base.confirmedRevenueKrw : null

  const out: HarvestScenario[] = []
  let firstProfit: number | null = null

  for (const s of scenarios) {
    const abwG = resolveAbwG(s.abw)

    let survivalRate = isNum(s.survivalRate) ? s.survivalRate : null
    let survivingCount = isNum(s.survivingCount) ? s.survivingCount : null
    if (survivingCount === null && survivalRate !== null && stockedCount !== null) {
      survivingCount = stockedCount * survivalRate
    }
    if (survivalRate === null && survivingCount !== null && stockedCount !== null && stockedCount > 0) {
      survivalRate = survivingCount / stockedCount
    }

    const biomassKg = abwG !== null && survivingCount !== null ? (survivingCount * abwG) / 1000 : null

    const additional = computeCost(s.additionalCost ?? {}, base.unitPrices)
    const hasAdditional = additional.lines.length > 0
    const cost = hasAdditional ? addCosts(base.incurredCost, additional) : base.incurredCost

    const projectedRevenueKrw =
      biomassKg !== null && price.krwPerKg !== null ? biomassKg * price.krwPerKg : null
    const revenueParts = [confirmedRevenueKrw, projectedRevenueKrw].filter(isNum)
    const revenueKrw = revenueParts.length > 0 ? revenueParts.reduce((a, b) => a + b, 0) : null

    const costPerKgKrw = biomassKg !== null && biomassKg > 0 ? cost.knownTotalKrw / biomassKg : null
    const operatingProfitKrw = revenueKrw !== null ? revenueKrw - cost.knownTotalKrw : null
    const operatingMarginRate =
      operatingProfitKrw !== null && revenueKrw !== null && revenueKrw !== 0
        ? operatingProfitKrw / revenueKrw
        : null

    if (firstProfit === null && operatingProfitKrw !== null) firstProfit = operatingProfitKrw

    const own: Exclusion[] = [
      { code: "abw_from_growth_projection", quantity: abwG, unit: "gram" },
      { code: "survival_rate_assumed", quantity: survivalRate, unit: "ratio" },
    ]
    if (s.dayOffset > 0 && !hasAdditional) {
      own.push({
        code: "remaining_period_cost_not_estimated",
        quantity: s.dayOffset,
        unit: "day",
      })
    }

    out.push({
      dayOffset: s.dayOffset,
      abwG,
      survivingCount,
      survivalRate,
      biomassKg,
      priceKrwPerKg: price.krwPerKg,
      channel: price.channel,
      projectedRevenueKrw,
      confirmedRevenueKrw,
      revenueKrw,
      cost,
      costPerKgKrw,
      operatingProfitKrw,
      operatingMarginRate,
      profitDeltaFromFirstKrw:
        operatingProfitKrw !== null && firstProfit !== null ? operatingProfitKrw - firstProfit : null,
      exclusions: mergeExclusions(cost.exclusions, price.exclusions, own),
    })
  }

  return {
    scenarios: out,
    price,
    exclusions: mergeExclusions(base.incurredCost.exclusions, price.exclusions),
  }
}
