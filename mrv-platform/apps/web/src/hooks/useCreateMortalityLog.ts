import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type {
  MortalityLogRequest,
  MortalityLogResponse,
} from "@/types/api";

/*
 * POST /sites/{siteId}/mortality-logs — 폐사 기록 생성(폐사율 분자, 슬라이스 B).
 * 성공 시 사이트 KPI 무효화 → 폐사율 카드 갱신.
 * dead_count>=0 정수 검증은 폼에서 선제 처리, 서버 422도 표면화.
 */
export function useCreateMortalityLog(
  siteId: string,
): UseMutationResult<MortalityLogResponse, unknown, MortalityLogRequest> {
  const qc = useQueryClient();
  return useMutation<MortalityLogResponse, unknown, MortalityLogRequest>({
    mutationFn: (body) =>
      apiFetch<MortalityLogResponse>(
        `/sites/${encodeURIComponent(siteId)}/mortality-logs`,
        { method: "POST", json: body },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["site-kpi", siteId] });
    },
  });
}
