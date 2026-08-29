import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { siteMetersQueryKey } from "./useSiteMeters";
import { onboardingStatusQueryKey } from "./useOnboardingStatus";
import type { Meter, MeterCreateRequest } from "@/types/api";

/*
 * POST /sites/{siteId}/meters — 계측기 등록(require_writer, phase-3 7.2절). viewer는 폼 자체가
 * 비활성(OnboardingWizardPage). 성공 시 meter 목록 + onboarding-status(sensor_mapping 단계
 * 반영)를 함께 무효화한다.
 */
export function useCreateMeter(
  siteId: string,
): UseMutationResult<Meter, unknown, MeterCreateRequest> {
  const qc = useQueryClient();
  return useMutation<Meter, unknown, MeterCreateRequest>({
    mutationFn: (body) =>
      apiFetch<Meter>(`/sites/${encodeURIComponent(siteId)}/meters`, {
        method: "POST",
        json: body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: siteMetersQueryKey(siteId) });
      void qc.invalidateQueries({ queryKey: onboardingStatusQueryKey(siteId) });
    },
  });
}
