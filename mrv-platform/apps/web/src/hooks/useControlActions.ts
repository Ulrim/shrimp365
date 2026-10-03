import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ControlActionListResponse, ControlActionStatusFilter } from "@/types/api";

/*
 * GET /control-actions?site_id=&status= — 승인 대기열 조회(phase-3 3.2절, ENTERPRISE).
 * 조회는 require_writer 불요(viewer도 대기열 확인 가능) — require_plan("ENTERPRISE")만
 * 서버가 강제한다. 재계산 없음(백엔드 응답 그대로).
 */
export const controlActionsQueryKey = (siteId: string, status: ControlActionStatusFilter) =>
  ["control-actions", siteId, status] as const;

export function useControlActions(
  siteId: string,
  status: ControlActionStatusFilter = "pending",
): UseQueryResult<ControlActionListResponse, unknown> {
  return useQuery<ControlActionListResponse, unknown>({
    queryKey: controlActionsQueryKey(siteId, status),
    enabled: Boolean(siteId),
    queryFn: ({ signal }) =>
      apiFetch<ControlActionListResponse>("/control-actions", {
        query: { site_id: siteId, status },
        signal,
      }),
  });
}
