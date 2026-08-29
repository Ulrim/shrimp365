import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { SopDetail } from "@/types/api";

/*
 * GET /sop/{id} — SOP 상세(본문 마크다운 + 체크리스트 항목 정의, phase-3 2.1절, PRO 이상).
 * 정적 콘텐츠 조회 — 산식 없음.
 */
export const sopDetailQueryKey = (id: string) => ["sop-detail", id] as const;

export function useSopDetail(id: string): UseQueryResult<SopDetail, unknown> {
  return useQuery<SopDetail, unknown>({
    queryKey: sopDetailQueryKey(id),
    enabled: Boolean(id),
    queryFn: ({ signal }) => apiFetch<SopDetail>(`/sop/${encodeURIComponent(id)}`, { signal }),
    staleTime: 5 * 60_000,
  });
}
