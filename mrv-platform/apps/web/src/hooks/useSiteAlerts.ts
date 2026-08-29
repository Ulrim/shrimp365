import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { AlertsResponse, AlertStatusFilter } from "@/types/api";

/*
 * GET /sites/{siteId}/alerts?status= — 알림 목록 조회(phase-2 1.6절, 슬라이스 H-FE).
 * 산식/판정 재계산 없음 — 백엔드가 이미 판정한 alert 목록을 그대로 표시.
 */
export const siteAlertsQueryKey = (siteId: string, status: AlertStatusFilter) =>
  ["site-alerts", siteId, status] as const;

export function useSiteAlerts(
  siteId: string,
  status: AlertStatusFilter = "open",
): UseQueryResult<AlertsResponse, unknown> {
  return useQuery<AlertsResponse, unknown>({
    queryKey: siteAlertsQueryKey(siteId, status),
    enabled: Boolean(siteId),
    queryFn: ({ signal }) =>
      apiFetch<AlertsResponse>(`/sites/${encodeURIComponent(siteId)}/alerts`, {
        query: { status },
        signal,
      }),
  });
}
