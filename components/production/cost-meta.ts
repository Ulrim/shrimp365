// 비용 항목의 색. **app/(dashboard)/production/page.tsx 에 있던 것을 그대로
// 옮겨왔고 값을 바꾸지 않았다** — 기존 화면의 칩 색이 바뀌면 안 된다.
//
// format.ts 와 같은 이유로 모듈이 됐다: 비용 구성 막대가 이 색을 그대로 써야
// 하는데(설계서 1-1·3-1 「새 팔레트를 만들지 않는다」), 두 곳에 같은 표가
// 있으면 한쪽만 고치는 날이 온다.
//
// 항목 순서는 **엔진 2 의 COST_ITEMS 와 같다**(종묘·사료·전기·인건·약품·기타).
// 엔진이 반환 순서를 고정한 이유가 「화면이 항목 순서를 매번 다르게 그리지
// 않도록」이므로, 화면도 같은 순서를 쓴다.

import type { CostItem } from "@/lib/profitability"

export type CostCategoryMeta = {
  value: CostItem
  /** Tailwind 배경 클래스. 막대 세그먼트와 칩이 같은 색을 쓴다. */
  color: string
}

export const COST_CATEGORY_META: readonly CostCategoryMeta[] = [
  { value: "pl", color: "bg-teal-500" },
  { value: "feed", color: "bg-blue-500" },
  { value: "electricity", color: "bg-yellow-500" },
  { value: "labor", color: "bg-purple-500" },
  { value: "chemicals", color: "bg-orange-500" },
  { value: "other", color: "bg-muted-foreground" },
]

export function costColor(item: CostItem): string {
  return COST_CATEGORY_META.find(m => m.value === item)?.color ?? "bg-muted-foreground"
}
