"use client"

/**
 * 온보딩 마법사.
 * 원본: mrv-platform/apps/web/src/features/onboarding/{OnboardingWizardPage,MeterRegistrationForm,PlanChangeDialog}.tsx
 *
 * 진행 상태는 별도 테이블 없이 실제 데이터에서 파생된다(서버가 계산해 준다) — 상태를 따로
 * 저장하면 실제와 어긋나는 순간이 생기지만, 파생 계산에는 그 어긋남이 존재할 수 없다.
 *
 * 단계는 4개다: 설치키트 → 센서 매핑 → 기준선 잠금 → 유료 전환. 각 단계에서 지금 할 일로
 * 바로 갈 수 있게 한다.
 */

import Link from "next/link"
import { useState } from "react"
import { apiFetch, errorMessage, useApiMutation, useApiQuery } from "@/lib/mrv/client"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { useMrvSite } from "@/lib/mrv/ui/site"
import {
  Badge,
  CenteredMessage,
  INPUT_CLASS,
  LoadError,
  PRIMARY_BUTTON,
  PageHeader,
  SECONDARY_BUTTON,
} from "@/components/mrv/ui"
import type {
  MeterListResponse,
  MeterType,
  OnboardingStatus,
  OnboardingStepKey,
  Plan,
} from "@/lib/mrv/api-types"

const WRITER_ROLES = new Set(["owner", "operator"])

const STEP_LABEL: Record<OnboardingStepKey, string> = {
  install_kit: "1. 설치키트 (수집 API 키 발급)",
  sensor_mapping: "2. 센서 매핑 (계측기 등록)",
  baseline_locked: "3. 기준선 수집 · 잠금",
  plan_active: "4. 유료 전환",
}

const METER_TYPES: { value: MeterType; label: string; unit: string }[] = [
  { value: "power", label: "전력계", unit: "kWh_interval" },
  { value: "do", label: "용존산소(DO)", unit: "mg_l" },
  { value: "temp", label: "수온", unit: "degC" },
  { value: "ph", label: "pH", unit: "pH" },
  { value: "orp", label: "ORP", unit: "mV" },
  { value: "ec", label: "EC/염도", unit: "mS_cm" },
]

/** 계측기 등록 폼 — 센서 매핑 단계에서 쓴다. */
function MeterRegistrationForm({
  siteId,
  canWrite,
  onRegistered,
}: {
  siteId: string | null
  canWrite: boolean
  onRegistered: () => void
}) {
  const [type, setType] = useState<MeterType>("power")
  const [label, setLabel] = useState("")
  const [isAeration, setIsAeration] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const mutation = useApiMutation(async (body: unknown) =>
    apiFetch(`/sites/${encodeURIComponent(siteId as string)}/meters`, {
      method: "POST",
      json: body,
    }),
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canWrite || !siteId) return
    if (!label.trim()) return setFieldError("계측기 이름을 입력하세요.")
    setFieldError(null)

    const unit = METER_TYPES.find((t) => t.value === type)!.unit
    try {
      await mutation.mutate({
        type,
        unit,
        // 폭기 서브미터 여부가 폭기전력 EI 의 분자를 가른다 — 전력계일 때만 의미가 있다.
        is_aeration: type === "power" ? isAeration : false,
        label: label.trim(),
      })
      setLabel("")
      setIsAeration(false)
      onRegistered()
    } catch {
      /* 아래에 오류를 표시한다. */
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-md bg-mrv-bg p-4">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-mrv-fg">
          계측기 종류
          <select
            value={type}
            onChange={(e) => setType(e.target.value as MeterType)}
            className={INPUT_CLASS}
          >
            {METER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-mrv-fg">
          계측기 이름
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="예: A동 메인 전력계"
            className={INPUT_CLASS}
          />
        </label>
      </div>

      {type === "power" && (
        <label className="flex items-center gap-2 text-xs text-mrv-fg">
          <input
            type="checkbox"
            checked={isAeration}
            onChange={(e) => setIsAeration(e.target.checked)}
            className="h-4 w-4 rounded border-mrv-border"
          />
          폭기(블로워) 서브미터입니다 — 폭기전력 EI 산출에 쓰입니다
        </label>
      )}

      {fieldError && (
        <p role="alert" className="text-xs text-mrv-red">
          {fieldError}
        </p>
      )}
      {mutation.error !== undefined && (
        <p role="alert" className="text-xs text-mrv-red">
          {errorMessage(mutation.error, "계측기 등록에 실패했습니다.")}
        </p>
      )}

      <button
        type="submit"
        disabled={!canWrite || mutation.isPending}
        className={`${PRIMARY_BUTTON} self-start`}
      >
        {mutation.isPending ? "등록 중…" : "계측기 등록"}
      </button>
    </form>
  )
}

export default function OnboardingPage() {
  const { selectedSiteId, selectedSite } = useMrvSite()
  const { role, plan, orgId, refetch: refetchSession } = useMrvSession()
  const canWrite = role !== null && WRITER_ROLES.has(role)
  const isOwner = role === "owner"

  const status = useApiQuery<OnboardingStatus>(
    (signal) =>
      apiFetch<OnboardingStatus>(
        `/sites/${encodeURIComponent(selectedSiteId as string)}/onboarding-status`,
        { signal },
      ),
    [selectedSiteId],
    { enabled: Boolean(selectedSiteId) },
  )

  const meters = useApiQuery<MeterListResponse>(
    (signal) =>
      apiFetch<MeterListResponse>(
        `/sites/${encodeURIComponent(selectedSiteId as string)}/meters`,
        { signal },
      ),
    [selectedSiteId],
    { enabled: Boolean(selectedSiteId) },
  )

  const planMutation = useApiMutation(async (nextPlan: Plan) =>
    apiFetch(`/organizations/${encodeURIComponent(orgId as string)}/plan`, {
      method: "PATCH",
      json: { plan: nextPlan },
    }),
  )

  async function handlePlanChange(nextPlan: Plan) {
    try {
      await planMutation.mutate(nextPlan)
      refetchSession()
      status.refetch()
    } catch {
      /* 아래에 오류를 표시한다. */
    }
  }

  const steps = status.data?.steps
  const currentStep = status.data?.current_step ?? null

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <PageHeader
        title="온보딩"
        description={`${selectedSite?.name ?? "사이트"} · 설치키트부터 유료 전환까지 4단계`}
      />

      {status.isLoading && (
        <div
          role="status"
          aria-label="온보딩 상태 불러오는 중"
          className="h-64 animate-pulse rounded-xl border border-mrv-border bg-mrv-surface"
        />
      )}

      {status.isError && !status.isLoading && (
        <LoadError message="온보딩 상태를 불러오지 못했습니다." onRetry={status.refetch} />
      )}

      {steps && (
        <ol className="flex flex-col gap-4">
          {(Object.keys(STEP_LABEL) as OnboardingStepKey[]).map((key) => {
            const step = steps[key]
            const isCurrent = currentStep === key
            return (
              <li
                key={key}
                className={`flex flex-col gap-3 rounded-xl border bg-mrv-surface p-5 ${
                  isCurrent ? "border-mrv-primary" : "border-mrv-border"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-mrv-fg">{STEP_LABEL[key]}</h2>
                  <Badge
                    className={
                      step.done
                        ? "bg-mrv-green-bg text-mrv-green"
                        : isCurrent
                          ? "bg-mrv-amber-bg text-mrv-amber"
                          : "bg-mrv-na-bg text-mrv-muted"
                    }
                  >
                    {step.done ? "완료" : isCurrent ? "진행할 차례" : "대기"}
                  </Badge>
                </div>
                <p className="text-xs text-mrv-muted">{step.detail}</p>

                {key === "install_kit" && !step.done && (
                  <p className="rounded-md bg-mrv-na-bg px-3 py-2 text-xs text-mrv-muted">
                    수집용 API 키는 보안상 화면에서 발급하지 않습니다. 컬리버 운영진에게
                    게이트웨이 등록을 요청하면 사이트별 키가 발급됩니다.
                  </p>
                )}

                {key === "sensor_mapping" && (
                  <>
                    {(meters.data?.items.length ?? 0) > 0 && (
                      <ul className="flex flex-col gap-1 text-xs text-mrv-muted">
                        {meters.data!.items.map((m) => (
                          <li key={m.id}>
                            {m.label ?? m.id} · {m.type}
                            {m.is_aeration ? " · 폭기 서브미터" : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    {canWrite && (
                      <MeterRegistrationForm
                        siteId={selectedSiteId}
                        canWrite={canWrite}
                        onRegistered={() => {
                          meters.refetch()
                          status.refetch()
                        }}
                      />
                    )}
                  </>
                )}

                {key === "baseline_locked" && !step.done && (
                  <Link href="/mrv/baseline" className={`${SECONDARY_BUTTON} self-start`}>
                    기준선 잠금으로 이동
                  </Link>
                )}

                {key === "plan_active" && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-mrv-muted">
                      현재 플랜: <strong className="text-mrv-fg">{plan ?? "-"}</strong>
                    </p>
                    {isOwner ? (
                      <div className="flex flex-wrap gap-2">
                        {(["START", "PRO", "ENTERPRISE"] as Plan[]).map((p) => (
                          <button
                            key={p}
                            type="button"
                            disabled={p === plan || planMutation.isPending}
                            onClick={() => handlePlanChange(p)}
                            className={SECONDARY_BUTTON}
                          >
                            {p} 로 변경
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-mrv-muted">
                        플랜 변경은 owner 만 가능합니다.
                      </p>
                    )}
                    <p className="text-xs text-mrv-muted">
                      결제는 별도 절차로 진행되며, 이 버튼은 결제 확인 후 플랜을 반영하는
                      용도입니다.
                    </p>
                    {planMutation.error !== undefined && (
                      <p role="alert" className="text-xs text-mrv-red">
                        {errorMessage(planMutation.error, "플랜 변경에 실패했습니다.")}
                      </p>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {steps && currentStep === null && (
        <CenteredMessage>온보딩이 모두 완료되었습니다.</CenteredMessage>
      )}
    </div>
  )
}
