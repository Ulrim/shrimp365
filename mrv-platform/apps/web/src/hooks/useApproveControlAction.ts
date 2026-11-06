import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ControlAction } from "@/types/api";

/*
 * POST /control-actions/{id}/approve — 승인(require_writer + ENTERPRISE, phase-3 3.2절).
 * status가 정확히 'pending'일 때만 서버가 전이를 허용, 그 외 409 "invalid transition".
 * FE는 ConfirmLockDialog와 동형의 이중확인 다이얼로그를 거친 뒤에만 호출한다(오조작 방지 —
 * 최종 방어선은 서버). 성공 시 대기열 쿼리를 전부 무효화한다.
 */
export function useApproveControlAction(): UseMutationResult<ControlAction, unknown, string> {
  const qc = useQueryClient();
  return useMutation<ControlAction, unknown, string>({
    mutationFn: (id) =>
      apiFetch<ControlAction>(`/control-actions/${encodeURIComponent(id)}/approve`, {
        method: "POST",
        json: {},
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["control-actions"] });
    },
  });
}
