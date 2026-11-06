import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-client";

/*
 * TanStack Query 전역 설정.
 * - 인증 오류(401/403)는 재시도하지 않는다(재시도해도 실패, 사용자 재로그인 필요).
 * - KPI 수치는 서버가 계산한 결과이므로 적당히 캐시(staleTime)한다.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError) {
          if (error.status === 401 || error.status === 403 || error.status === 404) {
            return false;
          }
        }
        return failureCount < 2;
      },
    },
  },
});
