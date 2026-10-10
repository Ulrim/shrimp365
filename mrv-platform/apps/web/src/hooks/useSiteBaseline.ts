import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { BaselineResponse } from "@/types/api";

/*
 * GET /sites/{siteId}/baseline — 현재 locked baseline 조회.
 * 없으면 백엔드가 404 → 여기서는 "아직 잠금 안 됨"(null)으로 해석해 UI가
 * 잠금 흐름을 열도록 한다. 그 외 오류는 그대로 표면화.
 */
export const siteBaselineQueryKey = (siteId: string) =>
  ["site-baseline", siteId] as const;

export function useSiteBaseline(
  siteId: string,
): UseQueryResult<BaselineResponse | null, unknown> {
  return useQuery<BaselineResponse | null, unknown>({
    queryKey: siteBaselineQueryKey(siteId),
    enabled: Boolean(siteId),
    queryFn: async ({ signal }) => {
      try {
        return await apiFetch<BaselineResponse>(
          `/sites/${encodeURIComponent(siteId)}/baseline`,
          { signal },
        );
      } catch (err) {
        // 404 = 아직 잠긴 기준선 없음(정상 상태) → null.
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  });
}
