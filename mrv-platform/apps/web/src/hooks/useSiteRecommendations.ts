import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { RecommendationsResponse } from "@/types/api";

/*
 * GET /sites/{siteId}/recommendations — 추천(운전 레시피) 보드(phase-2 2.3절, 슬라이스 K-FE).
 * PRO 이상만 유효 — 403(플랜/권한 부족)은 화면에서 안내로 전환한다(ApiError.status 그대로
 * 표면화, 산식/추천값 재계산 없음. rationale·params는 백엔드 응답을 그대로 표시).
 */
export const siteRecommendationsQueryKey = (siteId: string) =>
  ["site-recommendations", siteId] as const;

export function useSiteRecommendations(
  siteId: string,
): UseQueryResult<RecommendationsResponse, unknown> {
  return useQuery<RecommendationsResponse, unknown>({
    queryKey: siteRecommendationsQueryKey(siteId),
    enabled: Boolean(siteId),
    queryFn: ({ signal }) =>
      apiFetch<RecommendationsResponse>(
        `/sites/${encodeURIComponent(siteId)}/recommendations`,
        { signal },
      ),
  });
}
