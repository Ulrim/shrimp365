import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { MrvReportResponse } from "@/types/api";

/*
 * GET /mrv-reports/{id} — MRV 리포트 재조회(생성 응답과 동일 shape, phase-3 1.5절).
 * 3중 테넌시 방어는 백엔드가 담당(타 org 접근 시 403). 재계산 없음(백엔드 응답 그대로).
 */
export const mrvReportQueryKey = (id: string) => ["mrv-report", id] as const;

export function useMrvReport(id: string): UseQueryResult<MrvReportResponse, unknown> {
  return useQuery<MrvReportResponse, unknown>({
    queryKey: mrvReportQueryKey(id),
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      apiFetch<MrvReportResponse>(`/mrv-reports/${encodeURIComponent(id)}`, { signal }),
  });
}
