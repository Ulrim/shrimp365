import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { Batch } from "@/types/api";

/*
 * GET /sites/{siteId}/batches — 급이/폐사 입력의 대상 배치 목록.
 * 계약 타입(Batch[])에만 의존하므로 백엔드 미기동이어도 타입은 성립한다.
 * 로딩/에러/빈 상태는 호출 폼에서 명시적으로 처리한다.
 */
export const siteBatchesQueryKey = (siteId: string) =>
  ["site-batches", siteId] as const;

export function useSiteBatches(
  siteId: string,
): UseQueryResult<Batch[], unknown> {
  return useQuery<Batch[], unknown>({
    queryKey: siteBatchesQueryKey(siteId),
    enabled: Boolean(siteId),
    queryFn: ({ signal }) =>
      apiFetch<Batch[]>(`/sites/${encodeURIComponent(siteId)}/batches`, {
        signal,
      }),
  });
}
