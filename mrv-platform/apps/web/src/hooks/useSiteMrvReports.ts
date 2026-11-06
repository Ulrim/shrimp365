import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { MrvReportListResponse } from "@/types/api";

/*
 * GET /sites/{siteId}/mrv-reports?limit=&offset= — MRV 리포트 이력 목록(MASTER 화면10,
 * phase-3 1.5절, 슬라이스 M-FE). PRO 이상만 유효(require_plan) — 403은 화면에서 안내로 전환.
 * 재계산 없음(백엔드 응답 그대로).
 */
export const siteMrvReportsQueryKey = (siteId: string, limit: number, offset: number) =>
  ["site-mrv-reports", siteId, limit, offset] as const;

export function useSiteMrvReports(
  siteId: string,
  params: { limit?: number; offset?: number } = {},
): UseQueryResult<MrvReportListResponse, unknown> {
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;
  return useQuery<MrvReportListResponse, unknown>({
    queryKey: siteMrvReportsQueryKey(siteId, limit, offset),
    enabled: Boolean(siteId),
    queryFn: ({ signal }) =>
      apiFetch<MrvReportListResponse>(`/sites/${encodeURIComponent(siteId)}/mrv-reports`, {
        query: { limit, offset },
        signal,
      }),
  });
}
