import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { AlertItem } from "@/types/api";

/*
 * POST /alerts/{id}/ack — 알림 확인 처리(idempotent, owner/operator 전용, phase-2 1.6절).
 * 성공 시 알림 목록 쿼리를 모두 무효화해 화면을 갱신한다(status 필터별 캐시가 여러 개 존재).
 */
export function useAckAlert(): UseMutationResult<AlertItem, unknown, string> {
  const qc = useQueryClient();
  return useMutation<AlertItem, unknown, string>({
    mutationFn: (alertId) =>
      apiFetch<AlertItem>(`/alerts/${encodeURIComponent(alertId)}/ack`, {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["site-alerts"] });
    },
  });
}
