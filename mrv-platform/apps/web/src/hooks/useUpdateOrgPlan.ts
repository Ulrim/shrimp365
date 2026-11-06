import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { authMeQueryKey } from "./useAuthMe";
import type { OrgPlanUpdateRequest, OrgPlanUpdateResponse } from "@/types/api";

/*
 * PATCH /organizations/{orgId}/plan — 유료 전환(plan 변경, owner 한정, phase-3 7.4절).
 * 결제 연동은 범위 밖 — 이 엔드포인트는 확인 후 수동 호출을 전제한다. 성공 시 GET /auth/me
 * 캐시를 무효화해 usePlan/useAuth의 plan이 즉시 갱신되게 한다(메뉴 게이팅 등 즉시 반영).
 */
export function useUpdateOrgPlan(
  orgId: string,
): UseMutationResult<OrgPlanUpdateResponse, unknown, OrgPlanUpdateRequest> {
  const qc = useQueryClient();
  return useMutation<OrgPlanUpdateResponse, unknown, OrgPlanUpdateRequest>({
    mutationFn: (body) =>
      apiFetch<OrgPlanUpdateResponse>(
        `/organizations/${encodeURIComponent(orgId)}/plan`,
        { method: "PATCH", json: body },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: authMeQueryKey });
    },
  });
}
