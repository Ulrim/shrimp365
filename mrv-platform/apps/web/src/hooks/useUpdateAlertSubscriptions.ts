import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type {
  AlertSubscriptionUpdateRequest,
  AlertSubscriptionsResponse,
} from "@/types/api";

/*
 * PATCH /sites/{siteId}/alert-subscriptions — 알림 유형별 on/off 스위치 갱신
 * (owner/operator 전용, phase-2 1.7절). 부분 갱신(전달된 키만 반영).
 */
export function useUpdateAlertSubscriptions(
  siteId: string,
): UseMutationResult<
  AlertSubscriptionsResponse,
  unknown,
  AlertSubscriptionUpdateRequest
> {
  const qc = useQueryClient();
  return useMutation<
    AlertSubscriptionsResponse,
    unknown,
    AlertSubscriptionUpdateRequest
  >({
    mutationFn: (body) =>
      apiFetch<AlertSubscriptionsResponse>(
        `/sites/${encodeURIComponent(siteId)}/alert-subscriptions`,
        { method: "PATCH", json: body },
      ),
    onSuccess: (data) => {
      qc.setQueryData(["site-alert-subscriptions", siteId], data);
    },
  });
}
