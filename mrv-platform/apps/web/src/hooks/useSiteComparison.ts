import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ComparisonResponse } from "@/types/api";

/*
 * GET /sites/{siteId}/comparison?compare_from&compare_to — 전·후(A/B) 비교(phase-2 3.2절,
 * 슬라이스 J-FE). PRO 이상만 유효 — 404(baseline 미잠금)/403(플랜·권한 부족)은 화면에서
 * 각각 다른 안내로 구분 처리한다(ApiError.status 그대로 표면화, 재계산 없음).
 */
export const siteComparisonQueryKey = (
  siteId: string,
  compareFrom: string,
  compareTo: string,
) => ["site-comparison", siteId, compareFrom, compareTo] as const;

export function useSiteComparison(
  siteId: string,
  compareFrom: string,
  compareTo: string,
): UseQueryResult<ComparisonResponse, unknown> {
  return useQuery<ComparisonResponse, unknown>({
    queryKey: siteComparisonQueryKey(siteId, compareFrom, compareTo),
    enabled: Boolean(siteId && compareFrom && compareTo),
    queryFn: ({ signal }) =>
      apiFetch<ComparisonResponse>(
        `/sites/${encodeURIComponent(siteId)}/comparison`,
        { query: { compare_from: compareFrom, compare_to: compareTo }, signal },
      ),
  });
}
