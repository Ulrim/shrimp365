import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { KpiResponse } from "@/types/api";

export interface UseSiteKpiParams {
  siteId: string;
  /** ISO8601 UTC (예: 2026-06-01T00:00:00Z) */
  from: string;
  /** ISO8601 UTC */
  to: string;
}

export const siteKpiQueryKey = (params: UseSiteKpiParams) =>
  ["site-kpi", params.siteId, params.from, params.to] as const;

/**
 * GET /sites/{siteId}/kpi?from&to 를 TanStack Query로 호출해 KpiResponse를 반환.
 * 계약 타입(KpiResponse)에만 의존하므로 백엔드가 아직 안 떠 있어도 컴파일/타입은 성립한다.
 * 산식은 프론트에서 재계산하지 않는다 — 응답을 그대로 반환.
 */
export function useSiteKpi(
  params: UseSiteKpiParams,
): UseQueryResult<KpiResponse, unknown> {
  const { siteId, from, to } = params;
  return useQuery({
    queryKey: siteKpiQueryKey(params),
    enabled: Boolean(siteId && from && to),
    queryFn: ({ signal }) =>
      apiFetch<KpiResponse>(`/sites/${encodeURIComponent(siteId)}/kpi`, {
        query: { from, to },
        signal,
      }),
  });
}
