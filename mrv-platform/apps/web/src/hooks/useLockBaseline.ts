import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { siteBaselineQueryKey } from "./useSiteBaseline";
import type {
  BaselineLockRequest,
  BaselineResponse,
} from "@/types/api";

/*
 * POST /sites/{siteId}/baseline/lock — 기준선 잠금(불변).
 * 성공 시 baseline 쿼리를 무효화해 잠금 상태 UI로 즉시 전환한다.
 * 재잠금(이미 locked) 시도는 백엔드가 409 → ApiError(status=409)로 표면화되어
 * 호출부가 안내 메시지로 처리한다. 프론트는 값을 재계산하지 않는다.
 */
export function useLockBaseline(
  siteId: string,
): UseMutationResult<BaselineResponse, unknown, BaselineLockRequest> {
  const qc = useQueryClient();
  return useMutation<BaselineResponse, unknown, BaselineLockRequest>({
    mutationFn: (body) =>
      apiFetch<BaselineResponse>(
        `/sites/${encodeURIComponent(siteId)}/baseline/lock`,
        { method: "POST", json: body },
      ),
    onSuccess: (data) => {
      // 잠금 결과를 캐시에 반영하고 재검증.
      qc.setQueryData(siteBaselineQueryKey(siteId), data);
      void qc.invalidateQueries({ queryKey: siteBaselineQueryKey(siteId) });
    },
  });
}
