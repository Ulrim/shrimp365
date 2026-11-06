import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ControlAction, ControlActionProposeRequest } from "@/types/api";

/*
 * POST /control-actions — 제어 후보 제안(require_writer + ENTERPRISE, phase-3 3.2절).
 * recipe_versions.params_json을 백엔드가 스냅샷 복사해 status='pending'으로 생성한다
 * (재계산 없음). 성공 시 대기열 쿼리를 전부 무효화한다.
 */
export function useProposeControlAction(): UseMutationResult<
  ControlAction,
  unknown,
  ControlActionProposeRequest
> {
  const qc = useQueryClient();
  return useMutation<ControlAction, unknown, ControlActionProposeRequest>({
    mutationFn: (body) =>
      apiFetch<ControlAction>("/control-actions", { method: "POST", json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["control-actions"] });
    },
  });
}
