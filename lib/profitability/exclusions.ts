// 「이 계산에 포함되지 않은 것」 목록.
//
// 엔진 2 가 돌려주는 금액은 **확정 손익이 아니다.** 천황수산 2024 코호트에서
// 빠져 있는 것만 네 가지다 — 냉동 재고 1,221 kg, 11·12월 전기요금, 12월 출하
// 209 kg, 그리고 인건비·약품비·감가 전액. 금액만 돌려주면 호출자는 그것을
// 확정 손익으로 읽고, 화면은 "영업이익 −2,921만원" 을 숫자 하나로 띄운다.
//
// 그래서 **빠진 것을 반환값의 일부로 만든다.** 엔진 1 이 excluded·filledDays 를
// 함께 돌려주는 것과 같은 원칙이다. 호출자가 목록을 무시할 수는 있지만,
// 모르고 지나칠 수는 없다.
//
// **문장은 만들지 않는다.** 코드와 수치만 돌려주고 번역은 화면이 맡는다
// (엔진 6 이 이 위에 올라간다). raspberry-pi/advice.py 의
// {"code", "level", "value", "digits"} 와 같은 형태다.

import type { CostItem } from "./cost-items"

export type ExclusionCode =
  /** 비용 항목이 미입력이다. item 에 어느 항목인지 담긴다. 0 원 입력과 다르다. */
  | "cost_not_recorded"
  /** 감가상각이 모델에 없다. 이 엔진은 감가를 계산하지 않는다. */
  | "cost_depreciation_not_modeled"
  /** 전기 고지서가 사이클 전 구간을 덮지 못한다. quantity 는 미청구 개월 수. */
  | "electricity_billing_incomplete"
  /** 미판매 재고가 매출에 안 잡혔다. quantity 는 kg. 평가액을 받으면 사라진다. */
  | "revenue_unsold_inventory"
  /** 출하가 일어났는데 이벤트 원장에 없다(메모에만). quantity 는 kg. */
  | "harvest_not_in_event_ledger"
  /** 단가가 실거래가 아니라 채널 중앙값 가정이다. quantity 는 그 단가(원/kg). */
  | "price_from_channel_median"
  /** 단가를 못 정했다 — 채널도 금액도 안 받았다. 매출이 null 이 된다. */
  | "price_basis_not_selected"
  /** 잔여기간 비용을 못 받았다. quantity 는 남은 일수. 이익이 과대평가된다. */
  | "remaining_period_cost_not_estimated"
  /** 생존율이 실측이 아니라 가정값이다. quantity 는 그 생존율(0~1). */
  | "survival_rate_assumed"
  /** 개체중이 엔진 1 의 예측값이다 — 실측이 아니다. quantity 는 g. */
  | "abw_from_growth_projection"
  /** 회차 경계가 라벨되지 않았다. 생존율·FCR 의 정답이 없다는 뜻이다. */
  | "cycle_boundary_not_labeled"

export type ExclusionUnit = "krw" | "krw_per_kg" | "kg" | "count" | "month" | "day" | "gram" | "ratio"

export type Exclusion = {
  code: ExclusionCode
  /** cost_not_recorded 일 때만 채워진다. */
  item?: CostItem
  /**
   * 수량. **모르면 null 이고 0 으로 채우지 않는다** — "재고가 없다" 와
   * "재고가 얼마인지 모른다" 는 다른 사건이다.
   */
  quantity: number | null
  unit: ExclusionUnit | null
}

/** 같은 (code, item) 중복을 없앤다. 여러 계층이 같은 경고를 올려도 한 번만 나간다. */
export function mergeExclusions(...groups: readonly (readonly Exclusion[] | undefined)[]): Exclusion[] {
  const out: Exclusion[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    for (const e of group ?? []) {
      const key = `${e.code}|${e.item ?? ""}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(e)
    }
  }
  return out
}
