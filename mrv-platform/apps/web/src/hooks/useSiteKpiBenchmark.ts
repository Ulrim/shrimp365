import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { SiteKpiBenchmark } from "@/types/api";

/*
 * GET /sites/kpi-benchmark?from=&to= — 멀티사이트 KPI 벤치마크(require_plan("ENTERPRISE"),
 * phase-3 4.2절). 신규 산식 없음(site별 compute_site_kpi_results 반복 호출 결과를 그대로
 * 나열) — 정렬/랭킹은 FE 표시 로직에서만 수행한다.
 */
export const siteKpiBenchmarkQueryKey = (from: string, to: string) =>
  ["site-kpi-benchmark", from, to] as const;

export function useSiteKpiBenchmark(
  from: string,
  to: string,
): UseQueryResult<SiteKpiBenchmark, unknown> {
  return useQuery<SiteKpiBenchmark, unknown>({
    queryKey: siteKpiBenchmarkQueryKey(from, to),
    enabled: Boolean(from && to),
    queryFn: ({ signal }) =>
      apiFetch<SiteKpiBenchmark>("/sites/kpi-benchmark", { query: { from, to }, signal }),
  });
}
