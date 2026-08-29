/**
 * 기준선 행 ↔ API 응답 매핑. 원본 `routers/baseline.py` 의 `_row_to_response` 이식본.
 *
 * 기준선의 신호등은 임계 판정을 하지 않는다 — 값이 있으면 green, 없으면 na 다.
 * 기준선은 "잘하고 있는가"를 묻는 값이 아니라 비교의 원점이기 때문이며, 원본도 같다.
 */

import type { KpiMetric } from "./api-types"

export type BaselineRow = {
  id: string
  site_id: string
  org_id: string
  period_start: string
  period_end: string
  ei_total: number | null
  ei_aeration: number | null
  oei: number | null
  fcr: number | null
  mortality_rate: number | null
  config_version: string
  kpi_snapshot_id: string | null
  status: "draft" | "locked"
  locked_by: string | null
  locked_at: string | null
}

function metric(value: number | null, unit: string): KpiMetric {
  return { value, unit, status: value !== null ? "green" : "na" }
}

export function baselineRowToResponse(row: BaselineRow) {
  return {
    id: row.id,
    site_id: row.site_id,
    org_id: row.org_id,
    period: {
      from: row.period_start,
      to: row.period_end,
      granularity: "period",
    },
    status: row.status,
    metrics: {
      ei_total: metric(row.ei_total, "kWh/kg"),
      ei_aeration: metric(row.ei_aeration, "kWh/kg"),
      oei: metric(row.oei, "index"),
      fcr: metric(row.fcr, "kg/kg"),
      mortality_rate: metric(row.mortality_rate, "%"),
    },
    kpi_config: { version: row.config_version },
    provenance: { kpi_snapshot_id: row.kpi_snapshot_id },
    locked_by: row.locked_by,
    locked_at: row.locked_at,
  }
}
