import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { usePlan } from "@/hooks/usePlan";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useSiteMeters } from "@/hooks/useSiteMeters";
import { useSites } from "@/hooks/useSites";
import { useUpdateOrgPlan } from "@/hooks/useUpdateOrgPlan";
import { ApiError } from "@/lib/api-client";
import { MeterRegistrationForm } from "./MeterRegistrationForm";
import { PlanChangeDialog } from "./PlanChangeDialog";
import {
  ONBOARDING_STEP_LABEL,
  ONBOARDING_STEP_ORDER,
  PLAN_LABEL,
  PLAN_OPTIONS,
} from "./onboarding-meta";
import type { OnboardingStepKey, OnboardingStepStatus, Plan } from "@/types/api";

/*
 * 온보딩 마법사(MASTER 화면16, phase-3 7절, 공통 — 플랜 무관).
 * 4단계(설치키트→센서매핑→기준선수집→유료전환)를 순서대로 안내한다. 각 단계 완료 여부는
 * GET /sites/{siteId}/onboarding-status(파생 조회, 7.3절)를 그대로 표시(재계산 금지).
 * 새 기능을 만들지 않고 기존 조각(기준선 잠금 화면)+최소 신규 API(meter 등록, plan 변경)를
 * 오케스트레이션한다.
 */

const DEMO_SITE_ID = import.meta.env.VITE_DEMO_SITE_ID ?? "demo-site";

export function OnboardingWizardPage() {
  const { role, orgId } = useAuth();
  const { plan } = usePlan();
  const isOwner = role === "owner";

  const statusQuery = useOnboardingStatus(DEMO_SITE_ID);
  const metersQuery = useSiteMeters(DEMO_SITE_ID);
  const sitesQuery = useSites();
  const updatePlanMutation = useUpdateOrgPlan(orgId ?? "");

  const [planDialogTarget, setPlanDialogTarget] = useState<Plan | null>(null);

  const siteName =
    sitesQuery.data?.items.find((s) => s.id === DEMO_SITE_ID)?.name ?? DEMO_SITE_ID;

  const steps = statusQuery.data?.steps;
  const currentStep = statusQuery.data?.current_step;

  function stepOf(key: OnboardingStepKey): OnboardingStepStatus | undefined {
    return steps?.[key];
  }

  function handleConfirmPlanChange() {
    if (!planDialogTarget) return;
    updatePlanMutation.mutate(
      { plan: planDialogTarget },
      { onSettled: () => setPlanDialogTarget(null) },
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-fg">온보딩 마법사</h1>
        <p className="text-sm text-muted">
          사이트 {siteName} · 설치 키트부터 유료 전환까지 순서대로 진행하세요.
        </p>
      </header>

      {statusQuery.isError && (
        <p role="alert" className="text-sm text-signal-red">
          {statusQuery.error instanceof ApiError && statusQuery.error.isUnauthorized
            ? "인증이 만료되었습니다. 다시 로그인해 주세요."
            : "온보딩 진행 상태를 불러오지 못했습니다. 아래 단계는 계속 진행할 수 있습니다."}
        </p>
      )}

      <Stepper
        isLoading={statusQuery.isLoading}
        steps={steps}
        currentStep={currentStep}
      />

      {/* 1. 설치 키트 */}
      <StepSection
        title="1. 설치 키트"
        status={stepOf("install_kit")}
        isCurrent={currentStep === "install_kit"}
        isLoading={statusQuery.isLoading}
      >
        <p className="text-sm text-fg">
          계측기 데이터를 전송하려면 API Key(설치 키트)가 필요합니다. 아직 발급받지 못했다면
          관리자에게 API Key 발급을 요청하세요.
        </p>
      </StepSection>

      {/* 2. 센서 매핑 */}
      <StepSection
        title="2. 센서 매핑"
        status={stepOf("sensor_mapping")}
        isCurrent={currentStep === "sensor_mapping"}
        isLoading={statusQuery.isLoading}
      >
        <div className="flex flex-col gap-4">
          <MeterRegistrationForm siteId={DEMO_SITE_ID} />

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-fg">등록된 계측기</h3>
            {metersQuery.isLoading && (
              <div
                role="status"
                aria-label="계측기 목록 불러오는 중"
                className="h-16 animate-pulse rounded-card border border-border bg-surface"
              />
            )}
            {metersQuery.isError && (
              <p role="alert" className="text-sm text-signal-red">
                계측기 목록을 불러오지 못했습니다.
              </p>
            )}
            {metersQuery.data && metersQuery.data.items.length === 0 && (
              <p role="status" className="text-sm text-muted">
                아직 등록된 계측기가 없습니다.
              </p>
            )}
            {metersQuery.data && metersQuery.data.items.length > 0 && (
              <ul className="flex flex-col gap-1">
                {metersQuery.data.items.map((meter) => (
                  <li
                    key={meter.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <span className="text-fg">
                      {meter.label ?? "(라벨 없음)"} ({meter.type}, {meter.unit})
                    </span>
                    {meter.is_aeration && (
                      <span className="rounded-full bg-signal-na-bg px-2 py-0.5 text-xs text-muted">
                        폭기
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </StepSection>

      {/* 3. 기준선 수집 */}
      <StepSection
        title="3. 기준선 수집"
        status={stepOf("baseline_locked")}
        isCurrent={currentStep === "baseline_locked"}
        isLoading={statusQuery.isLoading}
      >
        <p className="text-sm text-fg">
          기준선(Before) 데이터를 잠가야 전·후 비교와 MRV 리포트를 생성할 수 있습니다.
        </p>
        <Link
          to="/baseline"
          className="self-start rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-bg"
        >
          기준선 잠금으로 이동
        </Link>
      </StepSection>

      {/* 4. 유료 전환 */}
      <StepSection
        title="4. 유료 전환"
        status={stepOf("plan_active")}
        isCurrent={currentStep === "plan_active"}
        isLoading={statusQuery.isLoading}
      >
        <p className="text-sm text-fg">
          현재 요금제: <span className="font-semibold text-fg">{plan ?? "확인 중"}</span>
        </p>

        {!isOwner && (
          <p role="note" className="text-xs text-muted">
            요금제 변경은 owner만 가능합니다.
          </p>
        )}

        {isOwner && (
          <div className="flex flex-wrap items-center gap-2">
            {PLAN_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                disabled={option === plan || updatePlanMutation.isPending}
                onClick={() => setPlanDialogTarget(option)}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
              >
                {PLAN_LABEL[option]}
                {option === plan ? " (현재)" : ""}
              </button>
            ))}
          </div>
        )}

        {updatePlanMutation.isError && (
          <p role="alert" className="text-sm text-signal-red">
            {updatePlanMutation.error instanceof ApiError
              ? updatePlanMutation.error.message
              : "요금제 변경에 실패했습니다."}
          </p>
        )}
        {updatePlanMutation.isSuccess && (
          <p role="status" className="text-sm text-signal-green">
            요금제가 변경되었습니다.
          </p>
        )}
      </StepSection>

      <PlanChangeDialog
        open={planDialogTarget !== null}
        targetPlan={planDialogTarget}
        pending={updatePlanMutation.isPending}
        onConfirm={handleConfirmPlanChange}
        onCancel={() => setPlanDialogTarget(null)}
      />
    </div>
  );
}

function Stepper({
  isLoading,
  steps,
  currentStep,
}: {
  isLoading: boolean;
  steps: Record<OnboardingStepKey, OnboardingStepStatus> | undefined;
  currentStep: OnboardingStepKey | null | undefined;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="온보딩 단계">
      {ONBOARDING_STEP_ORDER.map((key, idx) => {
        const done = steps?.[key]?.done ?? false;
        const isCurrent = currentStep === key;
        return (
          <li key={key} className="flex items-center gap-2">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${
                done
                  ? "border-signal-green bg-signal-green-bg text-signal-green"
                  : isCurrent
                    ? "border-primary bg-primary text-white"
                    : "border-border bg-surface text-muted"
              }`}
              aria-label={done ? `${ONBOARDING_STEP_LABEL[key]} 완료` : ONBOARDING_STEP_LABEL[key]}
            >
              {isLoading ? "…" : done ? "✓" : idx + 1}
            </span>
            <span className={`text-sm ${isCurrent ? "font-semibold text-fg" : "text-muted"}`}>
              {ONBOARDING_STEP_LABEL[key]}
            </span>
            {idx < ONBOARDING_STEP_ORDER.length - 1 && (
              <span aria-hidden="true" className="mx-1 h-px w-6 bg-border" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StepSection({
  title,
  status,
  isCurrent,
  isLoading,
  children,
}: {
  title: string;
  status: OnboardingStepStatus | undefined;
  isCurrent: boolean;
  isLoading: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={`flex flex-col gap-3 rounded-card border p-5 ${
        isCurrent ? "border-primary bg-surface" : "border-border bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {!isLoading && status && (
          <span
            role="status"
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              status.done
                ? "bg-signal-green-bg text-signal-green"
                : "bg-signal-na-bg text-muted"
            }`}
          >
            {status.done ? "완료" : "미완료"}
          </span>
        )}
      </div>
      {status && <p className="text-xs text-muted">{status.detail}</p>}
      {children}
    </section>
  );
}
