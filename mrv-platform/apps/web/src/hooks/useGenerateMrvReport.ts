import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { MrvReportGenerateRequest, MrvReportResponse } from "@/types/api";

/*
 * POST /sites/{siteId}/mrv-reports/generate — MRV 리포트 생성(★Phase 3 헤드라인,
 * require_writer + PRO 이상, phase-3 1.5절 1~11단계는 백엔드가 전부 수행 — FE는 결과를
 * 그대로 표시만 한다). 성공 시 이력 목록 쿼리를 무효화해 새 리포트가 목록에 즉시 반영되게 한다.
 */
export function useGenerateMrvReport(
  siteId: string,
): UseMutationResult<MrvReportResponse, unknown, MrvReportGenerateRequest> {
  const qc = useQueryClient();
  return useMutation<MrvReportResponse, unknown, MrvReportGenerateRequest>({
    mutationFn: (body) =>
      apiFetch<MrvReportResponse>(
        `/sites/${encodeURIComponent(siteId)}/mrv-reports/generate`,
        { method: "POST", json: body },
      ),
    onSuccess: () => {
      // "site-mrv-reports" 접두 매치(limit/offset 무관 전부 무효화, exact:false 기본값).
      void qc.invalidateQueries({ queryKey: ["site-mrv-reports", siteId] });
    },
  });
}
