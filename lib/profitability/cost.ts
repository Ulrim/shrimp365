// 비용 모델 — 입식수·사료량·전기사용량·기타비용 → 항목별 비용과 합계.
//
// 단가는 전부 인자로 받고, 기본값은 constants.ts 에 있다(출처·날짜 포함).
//
// ── 이 파일의 유일한 어려운 결정: 미입력을 어떻게 다루나 ──────────────────
// 「모르는 값을 0 으로 채우지 않는다」를 지키려면 합계를 어떻게 돌려줄지
// 정해야 한다. 세 가지 중 하나다.
//
//   (가) 미입력을 0 으로 더한다            → 합계가 조용히 작아진다. 금지.
//   (나) 미입력이 하나라도 있으면 합계 null → 인건비가 없는 지금 데이터에서
//        영업이익이 항상 null 이 되어 엔진 2 가 아무것도 못 돌려준다.
//   (다) **입력된 것만 더하고, 그 합계가 부분합임을 반환값에 적는다.** ← 채택
//
// 그래서 합계 필드 이름이 totalKrw 가 아니라 **knownTotalKrw** 다. 이름 자체가
// "아는 것만 더했다"를 말한다. 거기에 complete 플래그와 missingItems 목록이
// 붙는다. 호출자가 knownTotalKrw 를 총비용으로 쓰는 것은 막을 수 없지만,
// totalKrw 라고 적어 두고 속이는 것과는 다르다.
//
// ── 0 원과 미입력은 다르다 ────────────────────────────────────────────────
// labor: 0 은 "인건비가 0 원이었다"(가족 노동 등)이고 기록으로 인정한다 —
// items 에 0 으로 들어가고 missingItems 에는 없다.
// labor: null / undefined 는 "모른다"이고 missingItems 에 들어간다.
// 이 구분이 없으면 농가가 입력을 안 한 것과 실제로 안 쓴 것이 같아진다.

import {
  DEFAULT_ELECTRICITY_KRW_PER_KWH,
  DEFAULT_FEED_KRW_PER_KG,
  DEFAULT_SEED_KRW_PER_PL,
} from "./constants"
import { COST_ITEMS } from "./cost-items"
import type { CostItem } from "./cost-items"
import { mergeExclusions } from "./exclusions"
import type { Exclusion } from "./exclusions"

/** 단가. 전부 선택이고 빠지면 constants.ts 의 기본값을 쓴다. */
export type CostUnitPrices = {
  /** 사료 원/kg. 기본 2,300(농가 제공 2026-10-02). */
  feedKrwPerKg?: number | null
  /** 종묘 원/마리. 기본 10(농가 제공 2026-10-02). */
  seedKrwPerPl?: number | null
  /**
   * 전기 원/kWh. 기본은 **실청구 기준** 약 88.6
   * (고지서 청구액 ÷ 사용량). 요금표 전력량요금 65.9 가 아니다 —
   * constants.ts 의 DEFAULT_ELECTRICITY_KRW_PER_KWH 주석을 읽을 것.
   */
  electricityKrwPerKwh?: number | null
}

/**
 * 비용 입력. 각 항목은 **수량(단가 × 수량) 또는 금액** 중 하나로 넣는다.
 * 둘 다 넣으면 금액이 이긴다 — 고지서 실청구액이 단가 추정보다 정확하기
 * 때문이고, 어느 쪽을 썼는지는 항목의 basis 로 돌려준다.
 */
export type CostInput = {
  /** 입식 마리수. 종묘비 = 마리수 × 단가. */
  stockedCount?: number | null
  /** 종묘비 실액(원). 넣으면 stockedCount × 단가 대신 이 값을 쓴다. */
  plKrw?: number | null

  /** 총 급이량(kg). 사료비 = kg × 단가. */
  feedKg?: number | null
  /** 사료비 실액(원). */
  feedKrw?: number | null

  /** 전기 사용량(kWh). 전기비 = kWh × 단가. */
  electricityKwh?: number | null
  /** 전기비 실액(원). 고지서가 있으면 이쪽이 정확하다. */
  electricityKrw?: number | null
  /**
   * 전기 고지서가 덮지 못한 개월 수. 천황수산 코호트는 고지서가 2024-10 까지라
   * **11·12월 2개월이 빠져 있다.** 그 두 달 전기비는 electricityKrw 에 들어
   * 있지 않으므로 EXCLUSION "electricity_billing_incomplete" 로 알린다.
   *
   * **엔진이 월평균으로 추정해 채우지 않는다.** 3월 5,869,350원과 10월
   * 1,909,650원이 3배 차이 나는 계절성이 있고, 추정액을 실청구액에 섞으면
   * 반환값에서 어느 쪽이 고지서인지 구분되지 않는다. 추정할지 말지는 사람이
   * 정하고, 정하면 otherKrw 로 넣는다.
   */
  electricityUnbilledMonths?: number | null

  /** 인건비(원). **null 과 0 은 다르다** — 위 주석 참조. */
  laborKrw?: number | null
  /** 약품비(원). */
  chemicalsKrw?: number | null
  /** 기타(원). */
  otherKrw?: number | null
}

export type CostBasis = "amount" | "unit_price"

export type CostLine = {
  item: CostItem
  krw: number
  /** 실액을 받았나(amount), 단가 × 수량으로 계산했나(unit_price). */
  basis: CostBasis
  /** unit_price 일 때의 수량. amount 면 null. */
  quantity: number | null
  /** unit_price 일 때의 단가. amount 면 null. */
  unitPriceKrw: number | null
}

export type CostBreakdown = {
  /** 항목별 비용. **입력된 항목만** 들어간다. 순서는 COST_ITEMS 고정. */
  lines: CostLine[]
  /**
   * **입력된 항목만 더한 합계.** 총비용이 아니다 — missingItems 가 비어 있지
   * 않으면 이 값은 실제 총비용보다 작다. complete 를 보고 쓸 것.
   */
  knownTotalKrw: number
  /** 미입력 항목. 비어 있으면 complete 가 true 다. */
  missingItems: CostItem[]
  complete: boolean
  /** 미입력 항목 하나하나를 EXCLUSION 코드로도 돌려준다. 화면이 그대로 띄운다. */
  exclusions: Exclusion[]
}

function resolveLine(
  item: CostItem,
  amount: number | null | undefined,
  quantity: number | null | undefined,
  unitPrice: number,
): CostLine | null {
  // 실액이 먼저다. 0 원도 유효한 실액이다.
  if (typeof amount === "number" && Number.isFinite(amount)) {
    return { item, krw: amount, basis: "amount", quantity: null, unitPriceKrw: null }
  }
  if (typeof quantity === "number" && Number.isFinite(quantity)) {
    return {
      item,
      krw: quantity * unitPrice,
      basis: "unit_price",
      quantity,
      unitPriceKrw: unitPrice,
    }
  }
  return null
}

/**
 * 항목별 비용과 합계. **미입력을 0 으로 채우지 않는다.**
 *
 * 감가상각은 항목에 없으므로 언제나
 * "cost_depreciation_not_modeled" 를 EXCLUSION 으로 돌려준다 — 호출자가
 * other 에 감가를 넣었더라도 엔진은 그것이 감가인지 알 수 없기 때문에 경고를
 * 거두지 않는다. 거두는 판단은 사람이 화면에서 한다.
 */
export function computeCost(input: CostInput, prices: CostUnitPrices = {}): CostBreakdown {
  const feedKrwPerKg = prices.feedKrwPerKg ?? DEFAULT_FEED_KRW_PER_KG
  const seedKrwPerPl = prices.seedKrwPerPl ?? DEFAULT_SEED_KRW_PER_PL
  const electricityKrwPerKwh = prices.electricityKrwPerKwh ?? DEFAULT_ELECTRICITY_KRW_PER_KWH

  const byItem: Partial<Record<CostItem, CostLine | null>> = {
    pl: resolveLine("pl", input.plKrw, input.stockedCount, seedKrwPerPl),
    feed: resolveLine("feed", input.feedKrw, input.feedKg, feedKrwPerKg),
    electricity: resolveLine("electricity", input.electricityKrw, input.electricityKwh, electricityKrwPerKwh),
    labor: resolveLine("labor", input.laborKrw, null, 0),
    chemicals: resolveLine("chemicals", input.chemicalsKrw, null, 0),
    other: resolveLine("other", input.otherKrw, null, 0),
  }

  const lines: CostLine[] = []
  const missingItems: CostItem[] = []
  let knownTotalKrw = 0

  for (const item of COST_ITEMS) {
    const line = byItem[item]
    if (line == null) {
      missingItems.push(item)
      continue
    }
    lines.push(line)
    knownTotalKrw += line.krw
  }

  const exclusions: Exclusion[] = missingItems.map((item) => ({
    code: "cost_not_recorded" as const,
    item,
    quantity: null,
    unit: "krw" as const,
  }))
  exclusions.push({ code: "cost_depreciation_not_modeled", quantity: null, unit: "krw" })

  const unbilled = input.electricityUnbilledMonths
  if (typeof unbilled === "number" && Number.isFinite(unbilled) && unbilled > 0) {
    exclusions.push({ code: "electricity_billing_incomplete", quantity: unbilled, unit: "month" })
  }

  return {
    lines,
    knownTotalKrw,
    missingItems,
    // 고지서가 덮지 못한 구간이 있으면 전기비가 들어와 있어도 완전하지 않다.
    complete: missingItems.length === 0 && !(typeof unbilled === "number" && unbilled > 0),
    exclusions,
  }
}

/** 두 비용 묶음을 더한다 — 누적 실적 + 잔여기간 추정에 쓴다. */
export function addCosts(base: CostBreakdown, extra: CostBreakdown): CostBreakdown {
  const sum = new Map<CostItem, CostLine>()
  for (const line of [...base.lines, ...extra.lines]) {
    const prev = sum.get(line.item)
    if (prev === undefined) {
      sum.set(line.item, { ...line })
      continue
    }
    // 합산하면 단가·수량의 뜻이 사라진다. 섞인 항목은 금액만 남긴다.
    sum.set(line.item, {
      item: line.item,
      krw: prev.krw + line.krw,
      basis: "amount",
      quantity: null,
      unitPriceKrw: null,
    })
  }

  const lines: CostLine[] = []
  const missingItems: CostItem[] = []
  let knownTotalKrw = 0
  for (const item of COST_ITEMS) {
    const line = sum.get(item)
    if (line === undefined) {
      missingItems.push(item)
      continue
    }
    lines.push(line)
    knownTotalKrw += line.krw
  }

  // 항목 경고는 합산 결과에서 다시 구하고, 그 밖의 경고(전기 고지서 미비 등)는
  // 양쪽에서 그대로 들고 온다 — 더하면서 떨어뜨리면 경고가 조용히 사라진다.
  const carried = [...base.exclusions, ...extra.exclusions].filter((e) => e.code !== "cost_not_recorded")
  const exclusions = mergeExclusions(
    missingItems.map((item) => ({
      code: "cost_not_recorded" as const,
      item,
      quantity: null,
      unit: "krw" as const,
    })),
    carried,
  )

  return {
    lines,
    knownTotalKrw,
    missingItems,
    complete: missingItems.length === 0 && base.complete && extra.complete,
    exclusions,
  }
}

/** 항목 하나의 금액. 미입력이면 null — 0 이 아니다. */
export function costOf(breakdown: CostBreakdown, item: CostItem): number | null {
  return breakdown.lines.find((l) => l.item === item)?.krw ?? null
}
