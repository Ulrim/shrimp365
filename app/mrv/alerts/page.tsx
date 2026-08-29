"use client"

/**
 * 알림 센터.
 * 원본: mrv-platform/apps/web/src/features/alerts/AlertCenterPage.tsx
 *
 * 목록과 구독 스위치를 한 화면에 둔다. 알림은 append-only 이며 상태는 미확인→확인으로만
 * 간다 — 지우는 경로가 없다. 확인 처리는 감사 로그에 남는다.
 */

import { useState } from "react"
import { ApiError, apiFetch, errorMessage, useApiMutation, useApiQuery } from "@/lib/mrv/client"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { useMrvSite } from "@/lib/mrv/ui/site"
import { formatIsoLocal } from "@/lib/mrv/ui/datetime"
import {
  ALERT_SEVERITY_BADGE_CLASS,
  ALERT_SEVERITY_LABEL,
  ALERT_STATUS_LABEL,
  ALERT_TYPE_LABEL,
  summarizeAlertPayload,
} from "@/lib/mrv/ui/alert-meta"
import {
  Badge,
  CenteredMessage,
  INPUT_CLASS,
  LoadError,
  PageHeader,
  SECONDARY_BUTTON,
} from "@/components/mrv/ui"
import type {
  AlertItem,
  AlertStatusFilter,
  AlertSubscriptionsResponse,
  AlertsResponse,
  AlertType,
} from "@/lib/mrv/api-types"

const WRITER_ROLES = new Set(["owner", "operator"])

const STATUS_FILTERS: { value: AlertStatusFilter; label: string }[] = [
  { value: "open", label: "미확인" },
  { value: "ack", label: "확인됨" },
  { value: "all", label: "전체" },
]

const SUBSCRIPTION_TYPES: AlertType[] = ["do_low", "mortality_spike", "kpi_red"]

export default function AlertCenterPage() {
  const { selectedSiteId, selectedSite } = useMrvSite()
  const { role } = useMrvSession()
  const canWrite = role !== null && WRITER_ROLES.has(role)

  const [statusFilter, setStatusFilter] = useState<AlertStatusFilter>("open")

  const alerts = useApiQuery<AlertsResponse>(
    (signal) =>
      apiFetch<AlertsResponse>(
        `/sites/${encodeURIComponent(selectedSiteId as string)}/alerts`,
        { query: { status: statusFilter, limit: 100 }, signal },
      ),
    [selectedSiteId, statusFilter],
    { enabled: Boolean(selectedSiteId) },
  )

  const subscriptions = useApiQuery<AlertSubscriptionsResponse>(
    (signal) =>
      apiFetch<AlertSubscriptionsResponse>(
        `/sites/${encodeURIComponent(selectedSiteId as string)}/alert-subscriptions`,
        { signal },
      ),
    [selectedSiteId],
    { enabled: Boolean(selectedSiteId) },
  )

  const ackMutation = useApiMutation(async (alertId: string) =>
    apiFetch<AlertItem>(`/alerts/${encodeURIComponent(alertId)}/ack`, { method: "POST" }),
  )

  const subscriptionMutation = useApiMutation(async (patch: Partial<Record<AlertType, boolean>>) =>
    apiFetch<AlertSubscriptionsResponse>(
      `/sites/${encodeURIComponent(selectedSiteId as string)}/alert-subscriptions`,
      { method: "PATCH", json: patch },
    ),
  )

  async function handleAck(alertId: string) {
    try {
      await ackMutation.mutate(alertId)
      alerts.refetch()
    } catch {
      /* 아래에 오류를 표시한다. */
    }
  }

  async function handleToggle(type: AlertType, next: boolean) {
    try {
      await subscriptionMutation.mutate({ [type]: next })
      subscriptions.refetch()
    } catch {
      /* 아래에 오류를 표시한다. */
    }
  }

  const isUnauthorized = alerts.error instanceof ApiError && alerts.error.isUnauthorized
  const items = alerts.data?.items ?? []

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <PageHeader
        title="알림 센터"
        description={`${selectedSite?.name ?? "사이트"} · DO 저하 · 폐사 급증 · KPI 위험 알림`}
      />

      <section
        className="flex flex-col gap-3 rounded-xl border border-mrv-border bg-mrv-surface p-5"
        aria-label="알림 구독 설정"
      >
        <h2 className="text-base font-semibold text-mrv-fg">알림 구독</h2>
        {subscriptions.isLoading && (
          <div
            role="status"
            className="h-8 animate-pulse rounded-md bg-mrv-bg"
            aria-label="구독 설정 불러오는 중"
          />
        )}
        {subscriptions.data && (
          <div className="flex flex-wrap gap-4">
            {SUBSCRIPTION_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 text-sm text-mrv-fg">
                <input
                  type="checkbox"
                  checked={subscriptions.data!.alert_enabled_types[type] ?? true}
                  disabled={!canWrite || subscriptionMutation.isPending}
                  onChange={(e) => handleToggle(type, e.target.checked)}
                  className="h-4 w-4 rounded border-mrv-border"
                />
                {ALERT_TYPE_LABEL[type]}
              </label>
            ))}
          </div>
        )}
        {!canWrite && (
          <p role="note" className="text-xs text-mrv-muted">
            읽기 전용 권한(viewer)입니다. 구독 변경은 owner/operator 만 가능합니다.
          </p>
        )}
        {subscriptionMutation.error !== undefined && (
          <p role="alert" className="text-sm text-mrv-red">
            {errorMessage(subscriptionMutation.error, "구독 설정을 바꾸지 못했습니다.")}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label="알림 목록">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-mrv-fg">
            알림 {alerts.data ? `(${alerts.data.total}건)` : ""}
          </h2>
          <label className="flex items-center gap-2 text-sm text-mrv-muted">
            상태
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AlertStatusFilter)}
              className={INPUT_CLASS}
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {alerts.isLoading && (
          <div
            role="status"
            aria-label="알림 목록 불러오는 중"
            className="h-40 animate-pulse rounded-xl border border-mrv-border bg-mrv-surface"
          />
        )}

        {alerts.isError && !alerts.isLoading && (
          <LoadError
            message="알림을 불러오지 못했습니다."
            isUnauthorized={isUnauthorized}
            onRetry={alerts.refetch}
          />
        )}

        {!alerts.isLoading && !alerts.isError && items.length === 0 && (
          <CenteredMessage>
            {statusFilter === "open"
              ? "미확인 알림이 없습니다."
              : "표시할 알림이 없습니다."}
          </CenteredMessage>
        )}

        {ackMutation.error !== undefined && (
          <p role="alert" className="text-sm text-mrv-red">
            {errorMessage(ackMutation.error, "알림 확인 처리에 실패했습니다.")}
          </p>
        )}

        <ul className="flex flex-col gap-3">
          {items.map((alert) => (
            <li
              key={alert.id}
              className="flex flex-col gap-2 rounded-xl border border-mrv-border bg-mrv-surface p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={ALERT_SEVERITY_BADGE_CLASS[alert.severity]}>
                  {ALERT_SEVERITY_LABEL[alert.severity]}
                </Badge>
                <span className="text-sm font-semibold text-mrv-fg">
                  {ALERT_TYPE_LABEL[alert.type]}
                </span>
                <Badge className="bg-mrv-na-bg text-mrv-muted">
                  {ALERT_STATUS_LABEL[alert.status]}
                </Badge>
                <span className="ml-auto text-xs text-mrv-muted">
                  {formatIsoLocal(alert.created_at)}
                </span>
              </div>

              <p className="text-sm text-mrv-muted">
                {summarizeAlertPayload(alert.type, alert.payload)}
              </p>

              {alert.status === "ack" ? (
                <p className="text-xs text-mrv-muted">
                  {alert.acked_by ?? "-"} 이(가) {formatIsoLocal(alert.acked_at)} 에 확인
                </p>
              ) : (
                canWrite && (
                  <button
                    type="button"
                    onClick={() => handleAck(alert.id)}
                    disabled={ackMutation.isPending}
                    className={`${SECONDARY_BUTTON} self-start`}
                  >
                    확인 처리
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
