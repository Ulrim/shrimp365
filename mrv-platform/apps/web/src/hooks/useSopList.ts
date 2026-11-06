import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { SopListResponse } from "@/types/api";

/*
 * GET /sop — SOP 라이브러리 목록(MASTER 화면8, phase-3 2.1절, PRO 이상).
 * 콘텐츠는 정적 파일 기반(백엔드가 파일을 읽어 노출) — 산식/재계산 없음. require_plan("PRO",
 * "ENTERPRISE") 이므로 START 플랜은 403(화면에서 안내로 전환, MrvReportListPage와 동일 관례).
 */
export const sopListQueryKey = ["sop-list"] as const;

export function useSopList(): UseQueryResult<SopListResponse, unknown> {
  return useQuery<SopListResponse, unknown>({
    queryKey: sopListQueryKey,
    queryFn: ({ signal }) => apiFetch<SopListResponse>("/sop", { signal }),
    staleTime: 5 * 60_000, // 정적 콘텐츠 — 세션 동안 자주 안 바뀜.
  });
}
