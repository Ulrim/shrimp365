import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { FeedLogRequest, FeedLogResponse } from "@/types/api";

/*
 * POST /sites/{siteId}/feed-logs — 급이 기록 생성(FCR 분자 데이터원, 슬라이스 A).
 * 성공 시 해당 사이트의 KPI 쿼리를 무효화해 카드(FCR 등)가 갱신되게 한다.
 * 검증(feed_kg>0 등)은 폼에서 선제 처리하고, 서버 422도 그대로 표면화한다.
 */
export function useCreateFeedLog(
  siteId: string,
): UseMutationResult<FeedLogResponse, unknown, FeedLogRequest> {
  const qc = useQueryClient();
  return useMutation<FeedLogResponse, unknown, FeedLogRequest>({
    mutationFn: (body) =>
      apiFetch<FeedLogResponse>(
        `/sites/${encodeURIComponent(siteId)}/feed-logs`,
        { method: "POST", json: body },
      ),
    onSuccess: () => {
      // 사이트 KPI 전체(기간 무관) 무효화 → 카드 갱신.
      void qc.invalidateQueries({ queryKey: ["site-kpi", siteId] });
    },
  });
}
