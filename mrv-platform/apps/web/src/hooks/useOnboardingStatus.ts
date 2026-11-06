import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { OnboardingStatus } from "@/types/api";

/*
 * GET /sites/{siteId}/onboarding-status — 온보딩 4단계 진행 상태(파생 조회, 신규 상태 테이블
 * 없음, phase-3 7.3절). 인증만 요구, 플랜 게이팅 없음(공통 화면). 재계산 없음.
 */
export const onboardingStatusQueryKey = (siteId: string) =>
  ["onboarding-status", siteId] as const;

export function useOnboardingStatus(siteId: string): UseQueryResult<OnboardingStatus, unknown> {
  return useQuery<OnboardingStatus, unknown>({
    queryKey: onboardingStatusQueryKey(siteId),
    enabled: Boolean(siteId),
    queryFn: ({ signal }) =>
      apiFetch<OnboardingStatus>(`/sites/${encodeURIComponent(siteId)}/onboarding-status`, {
        signal,
      }),
  });
}
