/*
 * 요금제(plan) 게이팅 훅. GET /auth/me(useAuthMe) 결과에서 plan만 뽑아 UI 힌트로 노출한다.
 * useAuth(JWT role 기반)는 그대로 두고 별도 훅으로 분리했다 — 기존 role 게이팅 로직/테스트에
 * 영향을 주지 않기 위함이다. 서버가 최종 강제(403)하며, 이 훅은 메뉴 노출 등 선제 UI 힌트만
 * 제공한다(불명확할 땐 항상 숨기는 쪽 — isLoading true인 동안 isPro/isEnterprise는 false).
 */
import { useAuthMe } from "./useAuthMe";
import type { Plan } from "@/types/api";

export interface PlanState {
  plan: Plan | null;
  /** true인 동안은 plan이 아직 확정되지 않았다(PRO 전용 UI를 성급히 노출/숨김하지 말 것). */
  isLoading: boolean;
  isError: boolean;
  /** PRO 또는 ENTERPRISE. 로딩 중에는 항상 false(확정 전 노출 방지). */
  isPro: boolean;
  isEnterprise: boolean;
}

const PRO_OR_ABOVE: ReadonlySet<Plan> = new Set<Plan>(["PRO", "ENTERPRISE"]);

export function usePlan(): PlanState {
  const { data, isLoading, isError } = useAuthMe();
  const plan = data?.plan ?? null;
  return {
    plan,
    isLoading,
    isError,
    isPro: !isLoading && plan !== null && PRO_OR_ABOVE.has(plan),
    isEnterprise: !isLoading && plan === "ENTERPRISE",
  };
}
