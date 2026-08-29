/**
 * 알림 행 ↔ API 응답 매핑과 기본 구독 설정.
 * 원본: apps/api/app/routers/alerts.py::_to_item, models/site.py::DEFAULT_ALERT_ENABLED_TYPES
 */

import type { AlertItem, AlertSeverity, AlertStatus, AlertType } from "./api-types"

export type AlertRow = {
  id: string
  site_id: string
  org_id: string
  type: AlertType
  severity: AlertSeverity
  payload_json: Record<string, unknown> | null
  status: AlertStatus
  created_at: string
  acked_by: string | null
  acked_at: string | null
}

/** 새 사이트는 세 종류 알림을 모두 켠 상태로 시작한다(놓치는 것보다 끄는 편이 낫다). */
export const DEFAULT_ALERT_ENABLED_TYPES: Record<AlertType, boolean> = {
  do_low: true,
  mortality_spike: true,
  kpi_red: true,
}

export function alertRowToItem(row: AlertRow): AlertItem {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    payload: row.payload_json ?? {},
    status: row.status,
    created_at: row.created_at,
    acked_by: row.acked_by,
    acked_at: row.acked_at,
  }
}
