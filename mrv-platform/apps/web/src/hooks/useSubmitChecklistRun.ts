import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { checklistRunsQueryKeyPrefix } from "./useChecklistRuns";
import type { ChecklistRunRequest, ChecklistRunResponse } from "@/types/api";

/*
 * POST /sites/{siteId}/sop/{sopId}/checklist-runs — 체크리스트 실행 기록 생성(증빙,
 * append-only, require_writer, phase-3 2.2절). viewer는 호출 폼 자체가 비활성(SopDetailPage).
 * 성공 시 해당 site/sop의 이력 쿼리를 무효화해 방금 제출한 실행이 즉시 반영되게 한다.
 */
export function useSubmitChecklistRun(
  siteId: string,
  sopId: string,
): UseMutationResult<ChecklistRunResponse, unknown, ChecklistRunRequest> {
  const qc = useQueryClient();
  return useMutation<ChecklistRunResponse, unknown, ChecklistRunRequest>({
    mutationFn: (body) =>
      apiFetch<ChecklistRunResponse>(
        `/sites/${encodeURIComponent(siteId)}/sop/${encodeURIComponent(sopId)}/checklist-runs`,
        { method: "POST", json: body },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: checklistRunsQueryKeyPrefix(siteId) });
    },
  });
}
