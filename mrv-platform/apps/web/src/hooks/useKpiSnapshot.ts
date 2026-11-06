import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { KpiSnapshotDetail } from "@/types/api";

/*
 * GET /kpi-snapshots/{id} — drill-down 종착점(phase-3 1.7절, 절대 규칙: MRV 리포트의 모든
 * 숫자는 클릭 시 근거 데이터로 이동 가능해야 한다). id가 null인 동안은 호출하지 않는다
 * (lazy — 사용자가 수치를 클릭해 스냅샷을 선택했을 때만 조회).
 */
export const kpiSnapshotQueryKey = (id: string) => ["kpi-snapshot", id] as const;

export function useKpiSnapshot(
  id: string | null,
): UseQueryResult<KpiSnapshotDetail, unknown> {
  return useQuery<KpiSnapshotDetail, unknown>({
    queryKey: kpiSnapshotQueryKey(id ?? ""),
    enabled: Boolean(id),
    queryFn: ({ signal }) =>
      apiFetch<KpiSnapshotDetail>(`/kpi-snapshots/${encodeURIComponent(id as string)}`, {
        signal,
      }),
  });
}
