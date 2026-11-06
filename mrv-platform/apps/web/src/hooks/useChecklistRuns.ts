import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ChecklistRunListResponse } from "@/types/api";

/*
 * GET /sites/{siteId}/sop/checklist-runs?sop_id=&from=&to= — 체크리스트 실행 이력(증빙,
 * phase-3 2.2절). sop_id를 지정하면 해당 SOP의 이력만, 생략하면 사이트 전체.
 * 재계산 없음(백엔드 응답 그대로).
 */
export const checklistRunsQueryKeyPrefix = (siteId: string) =>
  ["checklist-runs", siteId] as const;

export function checklistRunsQueryKey(
  siteId: string,
  params: { sopId?: string; from?: string; to?: string } = {},
) {
  return [...checklistRunsQueryKeyPrefix(siteId), params.sopId ?? null, params.from ?? null, params.to ?? null] as const;
}

export function useChecklistRuns(
  siteId: string,
  params: { sopId?: string; from?: string; to?: string } = {},
): UseQueryResult<ChecklistRunListResponse, unknown> {
  return useQuery<ChecklistRunListResponse, unknown>({
    queryKey: checklistRunsQueryKey(siteId, params),
    enabled: Boolean(siteId),
    queryFn: ({ signal }) =>
      apiFetch<ChecklistRunListResponse>(
        `/sites/${encodeURIComponent(siteId)}/sop/checklist-runs`,
        { query: { sop_id: params.sopId, from: params.from, to: params.to }, signal },
      ),
  });
}
