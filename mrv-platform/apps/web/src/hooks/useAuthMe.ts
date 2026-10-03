/*
 * GET /auth/me — 현재 세션의 org_id/role/user_id/plan 조회.
 * plan은 JWT 클레임에 없어 이 엔드포인트가 유일한 출처다(phase-2 QA 갭 해소).
 * 세션 동안 plan이 바뀌는 일은 드물어 staleTime을 넉넉히 둔다(불필요한 재조회 방지).
 * 로딩 중에는 plan을 "미확정"으로 다룬다(성급하게 START/PRO로 단정하지 않음) — 소비하는
 * 쪽(usePlan)이 isLoading을 함께 노출해 UI가 확정 전까지 관련 항목을 숨기도록 한다.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api-client";
import { getCachedAccessToken } from "@/lib/supabase-client";
import type { AuthMeResponse } from "@/types/api";

export const authMeQueryKey = ["auth-me"] as const;

export function useAuthMe(): UseQueryResult<AuthMeResponse, unknown> {
  return useQuery<AuthMeResponse, unknown>({
    queryKey: authMeQueryKey,
    // 토큰이 없으면(비로그인) 호출하지 않는다 — 불필요한 401 왕복 방지.
    enabled: Boolean(getCachedAccessToken()),
    queryFn: async ({ signal }) => apiFetch<AuthMeResponse>("/auth/me", { signal }),
    // 세션 동안 자주 안 바뀌는 값이므로 대시보드 기본(60s)보다 훨씬 길게 캐시.
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        return false;
      }
      return failureCount < 2;
    },
  });
}
