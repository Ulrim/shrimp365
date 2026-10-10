/**
 * Scope2 탄소 MRV 산정 — MASTER 3.3절 산식 그대로 구현.
 *
 * ```
 * Scope2 배출량(tCO2e) = 전력사용량(MWh) × 전력 배출계수(tCO2e/MWh)
 * 감축량(tCO2e)        = (EI_baseline − EI_after) × 생산량(kg) × 배출계수
 *   → 동일 생산량 기준으로 정규화하여 "절감"을 분리(생산량 증가 효과와 혼동 방지)
 * ```
 *
 * 원본: mrv-platform/packages/kpi/culiver_kpi/mrv.py
 * ★ 이 모듈은 Scope2 산식의 단일 진실 공급원이다. 순수·결정론.
 * 전력 배출계수는 하드코딩하지 않는다 — 이 모듈은 값을 계산하지 않고 Scope2Input 으로
 * 주입받기만 한다(값 자체는 mrv_emission_factors 테이블에서 서비스 계층이 로드).
 *
 * --- 게이트 결정(phase-3.md 1.3절, data-kpi-engineer 최종 확정) ---
 *
 * (a) 감축량 정규화의 productionKg = After 기간 실제 biomassDeltaKg.
 *     근거: 감축량 산식은 "동일 생산량으로 baseline 효율을 냈다면 썼을 전력" 대비 "실제로
 *     쓴 전력"의 반사실적 차이를 tCO2e 로 환산하는 것이다. 두 항(EI_baseline, EI_after)
 *     모두에 동일한, 실제로 관측된 생산량을 곱해야 비교가 의미를 갖는다.
 *       - baseline 기간 생산량을 쓰면 개선 효과가 아니라 단순 과거 재현이 된다.
 *       - 두 기간 생산량을 각각 곱하면 생산량 증감 효과가 감축량에 섞인다 — MASTER 3.3
 *         "생산량 증가 효과와 혼동 방지" 와 정면 배치.
 *
 * (b) before/after 총배출량에 **단일** 배출계수 적용.
 *     근거: MASTER 3.3 감축량 산식 자체가 배출계수 항을 하나만 갖는다. 기간별로 다른
 *     계수를 쓰면 "설비/운영 효율 개선에 의한 감축"과 "국가 전력망이 청정해진 효과"가
 *     뒤섞여 "달성/미달성" 판정이 흐려진다. 과거 배출계수로 재현 검증이 필요하면
 *     emissionFactorId 를 명시해 별도 리포트를 재생성한다.
 *
 * 단위 정합: EI(kWh/kg) × productionKg(kg) = kWh → ÷1000 = MWh → × factor = tCO2e.
 * scope2TCo2eBaseline/After 는 입력이 이미 MWh 이므로 추가 환산 없이 MWh × factor.
 */

import { fmt, optionalRepr, requireFinite } from "./internal"
import { KpiValueError } from "./status"

/**
 * Scope2 산정 입력. 서비스가 조립한다(잠긴 baseline 값 + after 기간 라이브 EI/전력 +
 * 활성 emission_factors 1행의 투영).
 *
 * EI 는 kWh/kg(computeEi 결과 EiResult.eiTotal), 전력은 MWh(서비스가
 * EiResult.totalPowerKwh 를 /1000 해서 조립한 값)다.
 *
 * baselineEiTotal/afterEiTotal 이 null 인 경우는 computeEi 가 '산출 불가'로 반환한
 * eiTotal=null 을 그대로 전파한 것이다(산출 불가를 조용히 0 으로 치환하지 않는다).
 */
export type Scope2Input = {
  /** baseline.ei_total (잠긴 값, kWh/kg) */
  readonly baselineEiTotal: number | null
  /** after 기간 라이브 EI(kWh/kg) */
  readonly afterEiTotal: number | null
  /** after 기간 생산량(감축량 정규화 기준 — 게이트 (a)) */
  readonly afterBiomassDeltaKg: number
  /** before 기간 총 전력(MWh). 없으면 총배출량 계산 생략 */
  readonly baselinePowerMwh: number | null
  /** after 기간 총 전력(MWh) */
  readonly afterPowerMwh: number
  readonly emissionFactorTco2ePerMwh: number
  readonly emissionFactorSource: string
  readonly emissionFactorYear: number
  readonly emissionFactorVersion: string
}

/**
 * Scope2 산정 결과.
 * formulaText 는 실제 대입값을 포함한 재현 가능한 텍스트다(MASTER 3.3 ③ "산식 전문
 * 출력", ⑤ "적용 로직·버전"). 배출계수의 출처/연도/버전도 첫 줄에 명시한다.
 */
export type Scope2Result = {
  /** baselinePowerMwh 없으면 null */
  readonly scope2TCo2eBaseline: number | null
  readonly scope2TCo2eAfter: number
  /** EI 중 하나라도 null 이면 null(전파, 조용한 오염 방지) */
  readonly reductionTco2e: number | null
  readonly formulaText: string
  readonly emissionFactorVersion: string
}

/**
 * MASTER 3.3절 Scope2 산식 그대로. 순수·결정론.
 *
 * 규칙:
 *   - baselineEiTotal 또는 afterEiTotal 이 null → reductionTco2e = null
 *     (미산출 전파. EI/FCR/OEI 와 동일한 '산출 불가' 규약 — 조용히 0 으로 감추지 않는다).
 *   - baselinePowerMwh 가 null → scope2TCo2eBaseline = null
 *     (EI 산출 가능 여부와 무관 — 참고용 총배출량은 전력 존재 여부만으로 판단).
 *   - scope2TCo2eAfter 는 afterPowerMwh 로 항상 산출(EI 미산출과 무관).
 *
 * 방어(데이터 정합):
 *   - emissionFactorTco2ePerMwh 가 비유한이거나 0 이하 → KpiValueError
 *     (배출계수 부재를 묵시적 0 으로 처리하지 않는다).
 *   - afterBiomassDeltaKg 가 비유한이거나 0 이하 → KpiValueError
 *     (감축량 정규화 기준 생산량은 반드시 양수 실측값이어야 한다).
 *   - 나머지 EI/전력값이 비유한 → KpiValueError. 전력이 음수 → KpiValueError.
 */
export function computeScope2Reduction(inputs: Scope2Input): Scope2Result {
  const factor = inputs.emissionFactorTco2ePerMwh
  requireFinite(factor, "emissionFactorTco2ePerMwh")
  if (factor <= 0) {
    throw new KpiValueError(`emissionFactorTco2ePerMwh must be > 0, got ${factor}`)
  }

  const productionKg = inputs.afterBiomassDeltaKg
  requireFinite(productionKg, "afterBiomassDeltaKg")
  if (productionKg <= 0) {
    throw new KpiValueError(`afterBiomassDeltaKg must be > 0, got ${productionKg}`)
  }

  requireFinite(inputs.afterPowerMwh, "afterPowerMwh")
  if (inputs.afterPowerMwh < 0) {
    throw new KpiValueError(`afterPowerMwh must be >= 0, got ${inputs.afterPowerMwh}`)
  }

  if (inputs.baselinePowerMwh !== null) {
    requireFinite(inputs.baselinePowerMwh, "baselinePowerMwh")
    if (inputs.baselinePowerMwh < 0) {
      throw new KpiValueError(`baselinePowerMwh must be >= 0, got ${inputs.baselinePowerMwh}`)
    }
  }

  if (inputs.baselineEiTotal !== null) requireFinite(inputs.baselineEiTotal, "baselineEiTotal")
  if (inputs.afterEiTotal !== null) requireFinite(inputs.afterEiTotal, "afterEiTotal")

  const scope2TCo2eAfter = inputs.afterPowerMwh * factor
  const scope2TCo2eBaseline =
    inputs.baselinePowerMwh !== null ? inputs.baselinePowerMwh * factor : null

  const lines: string[] = [
    `적용 배출계수: ${inputs.emissionFactorVersion} ` +
      `(${inputs.emissionFactorSource}, ${inputs.emissionFactorYear}년, ` +
      `${fmt(factor)} tCO2e/MWh)`,
    `Scope2 배출량(after) = ${fmt(inputs.afterPowerMwh)} MWh × ` +
      `${fmt(factor)} tCO2e/MWh = ${fmt(scope2TCo2eAfter)} tCO2e`,
  ]
  if (scope2TCo2eBaseline !== null && inputs.baselinePowerMwh !== null) {
    lines.push(
      `Scope2 배출량(before) = ${fmt(inputs.baselinePowerMwh)} MWh × ` +
        `${fmt(factor)} tCO2e/MWh = ${fmt(scope2TCo2eBaseline)} tCO2e`,
    )
  }

  let reductionTco2e: number | null
  if (inputs.baselineEiTotal === null || inputs.afterEiTotal === null) {
    reductionTco2e = null
    lines.push(
      "감축량 = 산출 불가 (EI_baseline=" +
        `${optionalRepr(inputs.baselineEiTotal)}, ` +
        `EI_after=${optionalRepr(inputs.afterEiTotal)} 중 미산출(None) 값 존재)`,
    )
  } else {
    const eiDiff = inputs.baselineEiTotal - inputs.afterEiTotal
    reductionTco2e = ((eiDiff * productionKg) / 1000.0) * factor
    lines.push(
      `감축량 = (${fmt(inputs.baselineEiTotal)} - ${fmt(inputs.afterEiTotal)}) ` +
        `kWh/kg × ${fmt(productionKg)} kg / 1000 × ${fmt(factor)} tCO2e/MWh = ` +
        `${fmt(reductionTco2e)} tCO2e`,
    )
  }

  return {
    scope2TCo2eBaseline,
    scope2TCo2eAfter,
    reductionTco2e,
    formulaText: lines.join("\n"),
    emissionFactorVersion: inputs.emissionFactorVersion,
  }
}
