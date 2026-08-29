import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { MeterListResponse } from "@/types/api";

/*
 * GET /sites/{siteId}/meters — 등록된 계측기(meter) 목록(센서 매핑 단계, phase-3 7.2절).
 * 재계산 없음(백엔드 응답 그대로).
 */
export const siteMetersQueryKey = (siteId: string) => ["site-meters", siteId] as const;

export function useSiteMeters(siteId: string): UseQueryResult<MeterListResponse, unknown> {
  return useQuery<MeterListResponse, unknown>({
    queryKey: siteMetersQueryKey(siteId),
    enabled: Boolean(siteId),
    queryFn: ({ signal }) =>
      apiFetch<MeterListResponse>(`/sites/${encodeURIComponent(siteId)}/meters`, { signal }),
  });
}
