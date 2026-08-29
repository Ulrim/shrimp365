import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ControlAction, ControlActionRejectRequest } from "@/types/api";

/*
 * POST /control-actions/{id}/reject — 거부(require_writer + ENTERPRISE, phase-3 3.2절).
 * status가 정확히 'pending'일 때만 서버가 전이를 허용, 그 외 409. 거부 사유(note)는
 * result_json이 아니라 audit_logs.note로 남는다(백엔드 처리, FE는 note만 전달).
 */
export function useRejectControlAction(): UseMutationResult<
  ControlAction,
  unknown,
  { id: string; body: ControlActionRejectRequest }
> {
  const qc = useQueryClient();
  return useMutation<ControlAction, unknown, { id: string; body: ControlActionRejectRequest }>({
    mutationFn: ({ id, body }) =>
      apiFetch<ControlAction>(`/control-actions/${encodeURIComponent(id)}/reject`, {
        method: "POST",
        json: body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["control-actions"] });
    },
  });
}
