/*
 * 온보딩 마법사 표시 메타데이터(MASTER 화면16, phase-3 7절). 4단계 순서/라벨 — 표시 전용,
 * 진행 판정 자체는 백엔드(GET /sites/{siteId}/onboarding-status, 7.3절)가 파생 계산한다.
 */
import type { OnboardingStepKey, Plan } from "@/types/api";

export const ONBOARDING_STEP_ORDER: OnboardingStepKey[] = [
  "install_kit",
  "sensor_mapping",
  "baseline_locked",
  "plan_active",
];

export const ONBOARDING_STEP_LABEL: Record<OnboardingStepKey, string> = {
  install_kit: "설치 키트",
  sensor_mapping: "센서 매핑",
  baseline_locked: "기준선 수집",
  plan_active: "유료 전환",
};

export const PLAN_OPTIONS: Plan[] = ["START", "PRO", "ENTERPRISE"];

export const PLAN_LABEL: Record<Plan, string> = {
  START: "START",
  PRO: "PRO",
  ENTERPRISE: "ENTERPRISE",
};
