/**
 * 전·후(A/B) 비교 표시 유틸 — phase-2 슬라이스 J.
 *
 * 원본: mrv-platform/packages/kpi/culiver_kpi/comparison.py
 *
 * ★ 경계: 이 모듈은 "산식"이 아니라 이미 확정된 두 값(baseline/current)의 단순
 * 산술(delta/개선율)이다. 위치만 KPI 엔진 안에 고정해 Scope2 감축량 계산과 일관된
 * 자리에서 재사용한다. 순수·결정론.
 */

import { KpiValueError } from "./status"
import type { MetricDirection } from "./status"

/** 지표별 방향 — MASTER 3.2 산식 정의의 재인용이며 새 판단이 아니다. */
export const METRIC_DIRECTION: Record<string, MetricDirection> = {
  ei_total: "lower_is_better",
  ei_aeration: "lower_is_better",
  oei: "higher_is_better",
  fcr: "lower_is_better",
  mortality_rate: "lower_is_better",
}

/** 단일 지표의 baseline vs current 비교 결과(표시 전용, 산식 아님). */
export type MetricComparison = {
  readonly baselineValue: number | null
  readonly currentValue: number | null
  /** current - baseline. 어느 한쪽 null 이면 null. */
  readonly delta: number | null
  /** 방향 보정 개선율(%). null 조건은 아래 규약 참조. */
  readonly improvementPct: number | null
  readonly direction: MetricDirection
}

/**
 * baselineValue/currentValue 를 direction 에 따라 비교한다(단순 산술, 산식 아님).
 *
 * 규약:
 *   - 둘 중 하나라도 null → delta=null, improvementPct=null.
 *   - delta = currentValue - baselineValue.
 *   - improvementPct:
 *       lower_is_better:  (baseline - current) / baseline * 100
 *       higher_is_better: (current - baseline) / baseline * 100
 *   - baselineValue <= 0 → improvementPct=null(0 나눗셈/부호 왜곡 방지). delta 는 계산.
 *   - direction 이 두 값 외 → KpiValueError.
 */
export function compareMetric(
  baselineValue: number | null,
  currentValue: number | null,
  direction: MetricDirection,
): MetricComparison {
  if (direction !== "lower_is_better" && direction !== "higher_is_better") {
    throw new KpiValueError(`unknown direction: ${direction}`)
  }

  if (baselineValue === null || currentValue === null) {
    return { baselineValue, currentValue, delta: null, improvementPct: null, direction }
  }

  const delta = currentValue - baselineValue

  let improvementPct: number | null
  if (baselineValue <= 0) {
    improvementPct = null
  } else if (direction === "lower_is_better") {
    improvementPct = ((baselineValue - currentValue) / baselineValue) * 100.0
  } else {
    improvementPct = ((currentValue - baselineValue) / baselineValue) * 100.0
  }

  return { baselineValue, currentValue, delta, improvementPct, direction }
}
