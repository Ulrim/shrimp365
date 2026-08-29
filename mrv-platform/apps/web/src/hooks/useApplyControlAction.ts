import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ControlAction, ControlActionApplyRequest } from "@/types/api";

/*
 * POST /control-actions/{id}/apply — 적용 기록(human-in-the-loop, require_writer +
 * ENTERPRISE, phase-3 3.2절). status가 정확히 'approved'일 때만 서버가 전이를 허용,
 * 그 외 409 "control action not approved"(승인 게이트 핵심 실행 지점). 실제 설비 제어를
 * 이 요청이 트리거하지 않는다 — 운영자가 물리적으로 적용한 "이후" 결과를 기록하는 것뿐이다.
 */
export function useApplyControlAction(): UseMutationResult<
  ControlAction,
  unknown,
  { id: string; body: ControlActionApplyRequest }
> {
  const qc = useQueryClient();
  return useMutation<ControlAction, unknown, { id: string; body: ControlActionApplyRequest }>({
    mutationFn: ({ id, body }) =>
      apiFetch<ControlAction>(`/control-actions/${encodeURIComponent(id)}/apply`, {
        method: "POST",
        json: body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["control-actions"] });
    },
  });
}
