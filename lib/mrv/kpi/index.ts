/**
 * culiver KPI/MRV 산식 엔진 (순수·결정론).
 *
 * 원본 Python 패키지 `mrv-platform/packages/kpi/culiver_kpi` 를 TypeScript 로 이식한 것으로,
 * 산식의 단일 진실 공급원이다. API Route 와 화면은 이 모듈의 공개 API 만 호출하고
 * 산식을 재구현하지 않는다.
 *
 * 공개 범위:
 *   - EI(eiTotal / eiAeration)        — energy.ts
 *   - FCR(사료요구율)                  — feed.ts
 *   - OEI(산소운전 효율지수)            — oxygen.ts   (ADR 0003)
 *   - Mortality(폐사율: 누적/일일/7일 MA) — mortality.ts
 *   - KPI 신호등(red/amber/green/na)    — status.ts
 *   - 추천(운전 레시피)                 — recommend.ts
 *   - Scope2 MRV(감축량 산정)           — scope2.ts
 *   - 전·후 비교(표시 산술)             — comparison.ts
 */

export * from "./types"
export * from "./status"
export * from "./config"
export { computeEi } from "./energy"
export { computeFcr } from "./feed"
export { computeOei } from "./oxygen"
export { computeMortality } from "./mortality"
export { computeRecommendation } from "./recommend"
export { computeScope2Reduction } from "./scope2"
export type { Scope2Input, Scope2Result } from "./scope2"
export { compareMetric, METRIC_DIRECTION } from "./comparison"
export type { MetricComparison } from "./comparison"
