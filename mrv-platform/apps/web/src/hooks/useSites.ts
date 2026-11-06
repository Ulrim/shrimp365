import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { SitesListResponse } from "@/types/api";

/*
 * GET /sites — org 소속 전체 site 요약 목록(phase-3 4.2절). 플랜 게이팅 없음(단일 site
 * 조직도 자기 site 목록을 볼 권리가 있다). 온보딩 화면(대상 site 선택)에서 사용.
 */
export const sitesQueryKey = ["sites"] as const;

export function useSites(): UseQueryResult<SitesListResponse, unknown> {
  return useQuery<SitesListResponse, unknown>({
    queryKey: sitesQueryKey,
    queryFn: ({ signal }) => apiFetch<SitesListResponse>("/sites", { signal }),
    staleTime: 60_000,
  });
}
