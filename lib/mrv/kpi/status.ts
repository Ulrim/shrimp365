/**
 * KPI 신호등(status) red/amber/green/na 판정.
 *
 * 원본: mrv-platform/packages/kpi/culiver_kpi/status.py (phase-2 슬라이스 G)
 * ★ 이 모듈은 신호등 산식의 단일 진실 공급원이다. API/화면 어디에도 임계 판정을
 * 중복 구현하지 말 것. 순수·결정론: 동일 입력 → 동일 출력. now()/난수 금지.
 *
 * 경계값 판정 규약(방향별 부등호, "경계값 포함" 방향 명시):
 *   - lower_is_better (EI, FCR, 폐사율):
 *       value >= red   → 'red'    (경계값 자체도 red 에 포함)
 *       value >= amber → 'amber'
 *       그 외          → 'green'
 *       요구: red >= amber
 *   - higher_is_better (OEI):
 *       value <= red   → 'red'
 *       value <= amber → 'amber'
 *       그 외          → 'green'
 *       요구: red <= amber
 *   - value=null → 'na' (측정/산출 불가. 임계 판정 이전 단계이므로 최우선 처리)
 *
 * 임계값 선정 근거(잠정치 — 실증 전 가정, kpi_config 버전 상향으로 보정 예정):
 *   - ei_aeration: MASTER 1.1 "폭기전력 평균 ~5000kWh/t" = 5.0 kWh/kg 를 amber,
 *     20% 초과한 6.0 을 red.
 *   - ei_total: 폭기 외 순환·냉난방 포함 → amber=7.0, red=8.5.
 *   - fcr: MASTER 1.1 "FCR 평균 1.4~1.6" → 1.5 amber, 1.6 red.
 *   - oei: 실증 전 지수 → 60 amber, 50 red.
 *   - mortality_rate: 누적 8% amber, 12% red.
 */

export type KpiMetricStatus = "green" | "amber" | "red" | "na"
export type MetricDirection = "lower_is_better" | "higher_is_better"

/** 신호등 판정 대상 5개 지표의 방향(kpi_red 알림 감시 대상과 동일 명명). */
export const METRIC_DIRECTIONS: Record<string, MetricDirection> = {
  ei_total: "lower_is_better",
  ei_aeration: "lower_is_better",
  fcr: "lower_is_better",
  oei: "higher_is_better",
  mortality_rate: "lower_is_better",
}

/** 지표 1개의 red/amber 경계값. 경계값은 산식 파라미터이므로 kpi_config 버전 관리 대상. */
export type MetricThresholds = {
  redThreshold: number
  amberThreshold: number
}

/** 5개 지표의 MetricThresholds 묶음. kpi_config.params_json.alerting.thresholds 에서 로드. */
export type KpiThresholds = {
  ei_total: MetricThresholds
  ei_aeration: MetricThresholds
  fcr: MetricThresholds
  oei: MetricThresholds
  mortality_rate: MetricThresholds
}

/** 잠정 초기 임계값(위 주석 근거). kpi_config 미설정 시 기본값. */
export const DEFAULT_KPI_THRESHOLDS: KpiThresholds = {
  ei_total: { redThreshold: 8.5, amberThreshold: 7.0 },
  ei_aeration: { redThreshold: 6.0, amberThreshold: 5.0 },
  fcr: { redThreshold: 1.6, amberThreshold: 1.5 },
  oei: { redThreshold: 50.0, amberThreshold: 60.0 },
  mortality_rate: { redThreshold: 12.0, amberThreshold: 8.0 },
}

/** 산식 입력이 물리적으로/논리적으로 불가능할 때 던진다(API 계층에서 422 로 매핑). */
export class KpiValueError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "KpiValueError"
  }
}

/**
 * value/direction/thresholds → 신호등 4단계. 순수·결정론.
 *
 * - value=null → 'na'(측정/산출 불가. 임계 판정보다 우선)
 * - value 가 비유한(NaN/Infinity) → KpiValueError(신호등을 조용히 오염시키지 않음)
 * - thresholds 방향 정합성 위배 → KpiValueError
 */
export function classifyMetricStatus(
  value: number | null,
  direction: MetricDirection,
  thresholds: MetricThresholds,
): KpiMetricStatus {
  if (value === null) return "na"
  if (!Number.isFinite(value)) {
    throw new KpiValueError(`metric value must be finite or null, got ${value}`)
  }

  if (direction === "lower_is_better") {
    if (thresholds.redThreshold < thresholds.amberThreshold) {
      throw new KpiValueError(
        "lower_is_better thresholds must satisfy red >= amber: " +
          `red=${thresholds.redThreshold} amber=${thresholds.amberThreshold}`,
      )
    }
    if (value >= thresholds.redThreshold) return "red"
    if (value >= thresholds.amberThreshold) return "amber"
    return "green"
  }

  if (direction === "higher_is_better") {
    if (thresholds.redThreshold > thresholds.amberThreshold) {
      throw new KpiValueError(
        "higher_is_better thresholds must satisfy red <= amber: " +
          `red=${thresholds.redThreshold} amber=${thresholds.amberThreshold}`,
      )
    }
    if (value <= thresholds.redThreshold) return "red"
    if (value <= thresholds.amberThreshold) return "amber"
    return "green"
  }

  throw new KpiValueError(`unknown direction: ${direction}`)
}
