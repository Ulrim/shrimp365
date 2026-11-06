import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { AuditLogListResponse } from "@/types/api";

/*
 * GET /audit-logs?entity=&action=&from=&to=&limit=&offset= — 감사 로그 조회
 * (require_plan("ENTERPRISE"), phase-3 5절). viewer도 허용(읽기 전용 투명성 자체가 목적).
 * entity/action은 화이트리스트 검증 없이 서버가 그대로 매칭 — FE는 자유 텍스트로 전달한다.
 */
export interface AuditLogFilters {
  entity?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export const auditLogsQueryKey = (filters: AuditLogFilters) =>
  ["audit-logs", filters] as const;

export function useAuditLogs(
  filters: AuditLogFilters = {},
): UseQueryResult<AuditLogListResponse, unknown> {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  return useQuery<AuditLogListResponse, unknown>({
    queryKey: auditLogsQueryKey({ ...filters, limit, offset }),
    queryFn: ({ signal }) =>
      apiFetch<AuditLogListResponse>("/audit-logs", {
        query: {
          entity: filters.entity || undefined,
          action: filters.action || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          limit,
          offset,
        },
        signal,
      }),
  });
}
