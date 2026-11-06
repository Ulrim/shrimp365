import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { EmissionFactorListResponse } from "@/types/api";

/*
 * GET /emission-factors — 배출계수 목록(effective_from 내림차순, items[0]=활성값).
 * MRV 리포트 생성 화면의 배출계수 선택 UI가 소비한다(자유 텍스트 ID 입력 대신 select).
 * 인증만 요구(전역 설정 열람, 쓰기보다 위험도 낮음). 재계산 없음(백엔드 응답 그대로).
 */
export const emissionFactorsQueryKey = ["emission-factors"] as const;

export function useEmissionFactors(): UseQueryResult<EmissionFactorListResponse, unknown> {
  return useQuery<EmissionFactorListResponse, unknown>({
    queryKey: emissionFactorsQueryKey,
    queryFn: ({ signal }) =>
      apiFetch<EmissionFactorListResponse>("/emission-factors", { signal }),
    staleTime: 5 * 60 * 1000,
  });
}
