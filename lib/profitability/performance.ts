// 현재까지의 실적 지표 — **이미 일어난 일**을 계산한다. 예측은 projection.ts 다.
//
// 돌려주는 것: 생존율 · FCR · kg당 원가 · 영업이익. 그리고 그 금액들이 무엇을
// 빼놓고 계산된 것인지(exclusions).
//
// ── FCR 을 순증체로 나누는 이유 ───────────────────────────────────────────
// FCR = 급이량 ÷ **증체량**(출하 바이오매스 − 입식 바이오매스)이다.
// app/(dashboard)/production/page.tsx 의 기존 집계는 출하 중량으로 그냥 나눈다
// (16,378.5 ÷ 5,111.6 = 3.20). 천황수산 코호트는 입식이 9.0 kg 뿐이라 차이가
// 0.3% (3.20 대 3.21) 밖에 안 되지만, 치하를 크게 넣는 농가에서는 벌어진다.
// 사료가 만든 살만 세는 쪽이 사료 효율의 정의이므로 순증체를 쓴다.
// **기존 집계 산식을 지우지 않는다** — 예측값의 검증 기준으로 그대로 남는다.
//
// ── kg당 원가는 출하 총중량으로 나눈다 ───────────────────────────────────
// 원가는 "내보낸 1 kg 이 얼마에 만들어졌나"이므로 증체량이 아니라 출하 총중량이
// 분모다. 천황수산 코호트: 74,062,800 ÷ 5,111.6 = 14,489 원/kg.

import { resolvePrice } from "./channel"
import type { PriceBasis, ResolvedPrice } from "./channel"
import type { CostBreakdown } from "./cost"
import { mergeExclusions } from "./exclusions"
import type { Exclusion } from "./exclusions"

/** 미판매 재고 — 사이클이 안 닫혔을 때. */
export type UnsoldInventoryInput = {
  /** 재고 중량(kg). */
  weightKg?: number | null
  /**
   * 재고를 얼마로 잡나. **엔진이 정하지 않는다.**
   *
   * 천황수산 코호트의 냉동 재고 1,221 kg 은 `transfer_to_freezer` 7건으로
   * 나갔는데 freezer 채널 기록 9건의 중량·금액이 전부 비어 있다. 도매가로
   * 치면 2,000만원대이고 그만큼 손익이 달라진다. **그 2,000만원을 매출로
   * 잡을지는 사람이 정할 일이다** — 엔진이 0 으로 가정하면 손실이 과대하게
   * 보이고, 도매가로 가정하면 팔리지도 않은 돈이 이익에 들어간다.
   *
   * null 이면 매출에 넣지 않고 EXCLUSION "revenue_unsold_inventory" 에
   * 중량만 담아 돌려준다.
   */
  valuation?: PriceBasis | null
}

export type RevenueInput = {
  /** 확정 매출(원). 실제로 돈이 들어온 것만. */
  confirmedKrw?: number | null
  /** 그 매출의 거래 건수. 화면이 "41건" 을 띄울 수 있게. */
  recordCount?: number | null
  /**
   * 확정 매출이 덮는 중량(kg). 없으면 출하 총중량을 쓴다.
   *
   * 없을 때의 실현 단가는 **아래로 치우친다** — 천황수산 코호트는 분자에
   * 1,221 kg 분 매출이 빠져 있는데 분모에는 그 중량이 들어 있어 8,775 원/kg 이
   * 나온다(도매 중앙값 17,000 원의 절반). 그 수를 "우리 농가 단가" 로 읽으면
   * 안 된다.
   */
  soldWeightKg?: number | null
  unsoldInventory?: UnsoldInventoryInput
  /**
   * 이벤트 원장에 없는 출하(kg). 천황수산 코호트의 12월 출하 209 kg
   * (T1 출하 116 + 냉동 93)이 메모에만 있다. 출하 중량·매출 어느 쪽에도 안
   * 잡혀 있으므로 중량만 받아 EXCLUSION 으로 알린다. **엔진이 매출로
   * 환산하지 않는다** — 단가를 모른다.
   */
  outOfLedgerHarvestKg?: number | null
}

export type RevenueBreakdown = {
  confirmedKrw: number | null
  recordCount: number | null
  inventoryWeightKg: number | null
  /** 재고 평가액. 평가 기준을 안 받으면 null — **0 이 아니다.** */
  inventoryValuationKrw: number | null
  inventoryPrice: ResolvedPrice | null
  /** 확정 + 재고평가. 둘 다 없으면 null 이다. */
  knownTotalKrw: number | null
  complete: boolean
  exclusions: Exclusion[]
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** 매출 내역. 확정 매출과 재고 평가액을 **합치되 따로 남긴다.** */
export function computeRevenue(input: RevenueInput = {}): RevenueBreakdown {
  const confirmedKrw = isNum(input.confirmedKrw) ? input.confirmedKrw : null
  const inventoryWeightKg = isNum(input.unsoldInventory?.weightKg)
    ? (input.unsoldInventory?.weightKg as number)
    : null

  const exclusions: Exclusion[] = []
  let inventoryValuationKrw: number | null = null
  let inventoryPrice: ResolvedPrice | null = null

  if (inventoryWeightKg !== null) {
    const valuation = input.unsoldInventory?.valuation
    if (valuation == null) {
      // 0 으로 치지 않는다. 중량만 알리고 매출에서 뺀다.
      exclusions.push({ code: "revenue_unsold_inventory", quantity: inventoryWeightKg, unit: "kg" })
    } else {
      inventoryPrice = resolvePrice(valuation, {
        revenueKrw: confirmedKrw,
        weightKg: isNum(input.soldWeightKg) ? input.soldWeightKg : null,
      })
      if (inventoryPrice.krwPerKg === null) {
        exclusions.push({ code: "revenue_unsold_inventory", quantity: inventoryWeightKg, unit: "kg" })
        exclusions.push(...inventoryPrice.exclusions)
      } else {
        inventoryValuationKrw = inventoryWeightKg * inventoryPrice.krwPerKg
        exclusions.push(...inventoryPrice.exclusions)
      }
    }
  }

  if (isNum(input.outOfLedgerHarvestKg)) {
    exclusions.push({
      code: "harvest_not_in_event_ledger",
      quantity: input.outOfLedgerHarvestKg,
      unit: "kg",
    })
  }

  const parts = [confirmedKrw, inventoryValuationKrw].filter(isNum)
  const knownTotalKrw = parts.length > 0 ? parts.reduce((s, v) => s + v, 0) : null

  return {
    confirmedKrw,
    recordCount: isNum(input.recordCount) ? input.recordCount : null,
    inventoryWeightKg,
    inventoryValuationKrw,
    inventoryPrice,
    knownTotalKrw,
    complete: exclusions.length === 0,
    exclusions,
  }
}

export type ActualsInput = {
  /** 입식 마리수. */
  stockedCount?: number | null
  /** 입식 바이오매스(kg). FCR 의 순증체 계산에 쓴다. */
  stockedBiomassKg?: number | null
  /** 출하 총중량(kg) — 외부 반출분. */
  harvestedKg?: number | null
  /** 출하 총 마리수. 생존율의 분자다. */
  harvestedCount?: number | null
  /** 총 급이량(kg). */
  feedKg?: number | null
  revenue?: RevenueInput
  /**
   * 생존율·FCR 의 분모(= 회차 경계)가 어디서 왔나.
   *
   *   "source_data"   원본 데이터에 회차 ID 가 있다. 경고 없음.
   *   "human_derived" **사람이 메모를 읽어 복원한 파생 라벨이다.** 천황수산
   *                   데이터가 이쪽이다 — 단일 코호트로 복원되지만 그 복원은
   *                   원본의 사실이 아니고, 수조별 분해는 메모 해석에
   *                   의존한다(dataset-assessment 4-7·4-8).
   *   "unresolved"    복원하지 못했다. 분모를 모르면 생존율도 FCR 도 뜻이 없다.
   *
   * 생략하면 경고하지 않는다 — **엔진은 분모의 출처를 알 수 없고, 모르는 것을
   * 추측해 경고하지도 않는다.** 호출자가 적어 넣는 자리다.
   */
  cycleBoundary?: "source_data" | "human_derived" | "unresolved"
}

export type ActualPerformance = {
  /** 0~1. 백분율로 바꾸는 것은 화면 일이다. */
  survivalRate: number | null
  /** 급이량 ÷ 순증체량. 증체가 0 이하면 null — 1 로 보정하지 않는다. */
  fcr: number | null
  /** 출하 1 kg 당 원가(원). 분모는 출하 총중량이다. */
  costPerKgKrw: number | null
  /** 출하 개체 평균중량(g). */
  meanHarvestWeightG: number | null
  /** 확정 매출 ÷ 중량(원/kg). 위 soldWeightKg 주석의 치우침을 읽을 것. */
  realizedPriceKrwPerKg: number | null
  harvestedKg: number | null
  /** 순증체량(kg) = 출하 − 입식. */
  biomassGainKg: number | null
  cost: CostBreakdown
  revenue: RevenueBreakdown
  /** 매출 − 비용. 어느 한쪽이 없으면 null. */
  operatingProfitKrw: number | null
  /** 영업이익 ÷ 매출. */
  operatingMarginRate: number | null
  /** 영업이익 ÷ 비용. 기존 화면의 roi 와 같은 양이고 단위만 비율이다. */
  returnOnCostRate: number | null
  /** 비용·매출·실적 세 층에서 올라온 「포함되지 않은 것」 전부. */
  exclusions: Exclusion[]
  /** 비용과 매출이 모두 빠진 것 없이 채워졌나. */
  complete: boolean
}

/**
 * 실적 지표. **금액만 돌려주지 않는다** — exclusions 가 함께 나간다.
 *
 * 천황수산 2024 코호트(입식 1,200,000마리 9.0 kg · 급이 16,378.5 kg · 출하
 * 5,111.6 kg 537,562마리 · 확정매출 44,853,100원 · 비용 74,062,800원)에서
 *   생존율 44.8% · FCR 3.21 · kg당 원가 14,489원 · 영업이익 −29,209,700원
 * 이 나온다. 재현 확인은 scripts/profitability/verify.mjs.
 */
export function computeActuals(input: ActualsInput, cost: CostBreakdown): ActualPerformance {
  const harvestedKg = isNum(input.harvestedKg) ? input.harvestedKg : null
  const harvestedCount = isNum(input.harvestedCount) ? input.harvestedCount : null
  const stockedCount = isNum(input.stockedCount) ? input.stockedCount : null
  const stockedBiomassKg = isNum(input.stockedBiomassKg) ? input.stockedBiomassKg : null
  const feedKg = isNum(input.feedKg) ? input.feedKg : null

  const revenue = computeRevenue(input.revenue)

  const survivalRate =
    harvestedCount !== null && stockedCount !== null && stockedCount > 0
      ? harvestedCount / stockedCount
      : null

  // 입식 바이오매스를 안 받았으면 **0 으로 치지 않는다.** 치하가 가벼워 차이가
  // 작을 뿐이지 없는 값은 없는 값이다 — 순증체를 모르면 FCR 도 모른다.
  const biomassGainKg =
    harvestedKg !== null && stockedBiomassKg !== null ? harvestedKg - stockedBiomassKg : null
  const fcr = feedKg !== null && biomassGainKg !== null && biomassGainKg > 0 ? feedKg / biomassGainKg : null

  const costPerKgKrw = harvestedKg !== null && harvestedKg > 0 ? cost.knownTotalKrw / harvestedKg : null
  const meanHarvestWeightG =
    harvestedKg !== null && harvestedCount !== null && harvestedCount > 0
      ? (harvestedKg * 1000) / harvestedCount
      : null

  const priceDenominatorKg = isNum(input.revenue?.soldWeightKg) ? input.revenue?.soldWeightKg : harvestedKg
  const realizedPriceKrwPerKg =
    revenue.confirmedKrw !== null && isNum(priceDenominatorKg) && priceDenominatorKg > 0
      ? revenue.confirmedKrw / priceDenominatorKg
      : null

  const operatingProfitKrw = revenue.knownTotalKrw !== null ? revenue.knownTotalKrw - cost.knownTotalKrw : null
  const operatingMarginRate =
    operatingProfitKrw !== null && revenue.knownTotalKrw !== null && revenue.knownTotalKrw !== 0
      ? operatingProfitKrw / revenue.knownTotalKrw
      : null
  const returnOnCostRate =
    operatingProfitKrw !== null && cost.knownTotalKrw !== 0 ? operatingProfitKrw / cost.knownTotalKrw : null

  const own: Exclusion[] = []
  if (input.cycleBoundary === "human_derived") {
    own.push({ code: "cycle_boundary_derived_label", quantity: null, unit: null })
  } else if (input.cycleBoundary === "unresolved") {
    own.push({ code: "cycle_boundary_not_resolved", quantity: null, unit: null })
  }

  return {
    survivalRate,
    fcr,
    costPerKgKrw,
    meanHarvestWeightG,
    realizedPriceKrwPerKg,
    harvestedKg,
    biomassGainKg,
    cost,
    revenue,
    operatingProfitKrw,
    operatingMarginRate,
    returnOnCostRate,
    exclusions: mergeExclusions(cost.exclusions, revenue.exclusions, own),
    complete: cost.complete && revenue.complete && own.length === 0,
  }
}
