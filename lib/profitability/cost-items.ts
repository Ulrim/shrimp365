// 비용 항목 코드. **새 어휘를 만들지 않고 DB 의 것을 쓴다** —
// types/index.ts 의 CycleCost.category 와 같은 여섯 가지다.
// 엔진이 자기만의 항목 이름을 쓰면 cycle_costs 행을 엔진 입력으로 옮길 때마다
// 매핑 표가 필요해지고, 그 표가 어긋나면 비용이 조용히 사라진다.
//
//   pl          종묘
//   feed        사료
//   electricity 전기
//   labor       인건
//   chemicals   약품
//   other       기타
//
// 감가상각은 DB 에도 이 목록에도 없다. 그래서 "other" 로 묶지 않고
// EXCLUSION 코드 "cost_depreciation_not_modeled" 로 따로 알린다 — other 에
// 섞으면 감가가 계산에 들어갔는지 아닌지 반환값에서 구분되지 않는다.
export type CostItem = "pl" | "feed" | "electricity" | "labor" | "chemicals" | "other"

/** 반환 순서를 고정한다. 화면이 항목 순서를 매번 다르게 그리지 않도록. */
export const COST_ITEMS: readonly CostItem[] = ["pl", "feed", "electricity", "labor", "chemicals", "other"]
