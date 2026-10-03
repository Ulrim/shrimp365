"use client"

/**
 * MRV 리포트 생성.
 * 원본: mrv-platform/apps/web/src/features/mrv/MrvReportGeneratePage.tsx
 *
 * 생성은 되돌릴 수 없다(수정 경로가 없고, 다시 만들면 새 리포트가 발급된다). 그래서
 * 확인 대화상자를 한 번 세우고, 어떤 배출계수를 쓰는지 미리 보여 준다 — 계수가 달라지면
 * 같은 데이터로도 감축량이 달라지므로 사용자가 그것을 알고 눌러야 한다.
 */

import { useRouter } from "next/navigation"
import { useState } from "react"
import { apiFetch, errorMessage, useApiMutation, useApiQuery } from "@/lib/mrv/client"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { useMrvSite } from "@/lib/mrv/ui/site"
import { isoDay, recentPeriod } from "@/lib/mrv/ui/period"
import { ConfirmDialog } from "@/components/mrv/confirm-dialog"
import {
  CenteredMessage,
  INPUT_CLASS,
  PRIMARY_BUTTON,
  PageHeader,
} from "@/components/mrv/ui"
import type {
  EmissionFactorListResponse,
  MrvReportResponse,
} from "@/lib/mrv/api-types"

const WRITER_ROLES = new Set(["owner", "operator"])

export default function MrvReportGeneratePage() {
  const router = useRouter()
  const { selectedSiteId, selectedSite } = useMrvSite()
  const { isPro, role, isLoading: sessionLoading } = useMrvSession()
  const canWrite = role !== null && WRITER_ROLES.has(role)

  const initial = recentPeriod(30)
  const [fromDay, setFromDay] = useState(isoDay(initial.from))
  const [toDay, setToDay] = useState(isoDay(initial.to))
  const [emissionFactorId, setEmissionFactorId] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const factors = useApiQuery<EmissionFactorListResponse>(
    (signal) => apiFetch<EmissionFactorListResponse>("/emission-factors", { signal }),
    [],
    { enabled: isPro },
  )

  const mutation = useApiMutation(async (body: unknown) =>
    apiFetch<MrvReportResponse>(
      `/sites/${encodeURIComponent(selectedSiteId as string)}/mrv-reports/generate`,
      { method: "POST", json: body },
    ),
  )

  const header = (
    <PageHeader
      title="MRV 리포트 생성"
      description={`${selectedSite?.name ?? "사이트"} · 잠긴 기준선(Before) 대비 지정 기간(After)`}
    />
  )

  if (sessionLoading) return null

  if (!isPro || !canWrite) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
        {header}
        <CenteredMessage>
          {!isPro
            ? "MRV 리포트 생성은 PRO 이상 요금제에서 이용할 수 있습니다."
            : "리포트 생성은 owner/operator 만 가능합니다."}
        </CenteredMessage>
      </div>
    )
  }

  function openConfirm() {
    if (!fromDay || !toDay) return setFieldError("기간을 입력하세요.")
    if (new Date(`${fromDay}T00:00:00Z`) >= new Date(`${toDay}T23:59:59Z`)) {
      return setFieldError("시작일은 종료일보다 앞서야 합니다.")
    }
    setFieldError(null)
    setConfirmOpen(true)
  }

  async function handleGenerate() {
    try {
      const report = await mutation.mutate({
        after_period: { from: `${fromDay}T00:00:00Z`, to: `${toDay}T23:59:59Z` },
        emission_factor_id: emissionFactorId || null,
      })
      setConfirmOpen(false)
      router.push(`/mrv/mrv-reports/${encodeURIComponent(report.id)}`)
    } catch {
      setConfirmOpen(false)
    }
  }

  const selectedFactor = factors.data?.items.find((f) => f.id === emissionFactorId)
  const activeFactor = factors.data?.items[0]
  const factorForConfirm = selectedFactor ?? activeFactor

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      {header}

      <section className="flex flex-col gap-4 rounded-xl border border-mrv-border bg-mrv-surface p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-mrv-fg">
            After 시작일
            <input
              type="date"
              value={fromDay}
              onChange={(e) => setFromDay(e.target.value)}
              className={`${INPUT_CLASS} py-2`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-mrv-fg">
            After 종료일
            <input
              type="date"
              value={toDay}
              onChange={(e) => setToDay(e.target.value)}
              className={`${INPUT_CLASS} py-2`}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm text-mrv-fg">
          전력 배출계수
          <select
            value={emissionFactorId}
            onChange={(e) => setEmissionFactorId(e.target.value)}
            className={`${INPUT_CLASS} py-2`}
          >
            <option value="">활성 계수 자동 선택(최신)</option>
            {(factors.data?.items ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.version} · {f.factor_tco2e_per_mwh} tCO2e/MWh · {f.year}년
              </option>
            ))}
          </select>
          <span className="text-xs text-mrv-muted">
            계수가 달라지면 같은 데이터로도 감축량이 달라집니다. 리포트에는 적용한 계수의
            출처·연도·버전이 함께 기록됩니다.
          </span>
        </label>

        {fieldError && (
          <p role="alert" className="text-sm text-mrv-red">
            {fieldError}
          </p>
        )}
        {mutation.error !== undefined && (
          <p role="alert" className="text-sm text-mrv-red">
            {errorMessage(mutation.error, "리포트 생성에 실패했습니다.")}
          </p>
        )}

        <button
          type="button"
          onClick={openConfirm}
          disabled={mutation.isPending}
          className={`${PRIMARY_BUTTON} self-start`}
        >
          리포트 생성
        </button>
      </section>

      <ConfirmDialog
        open={confirmOpen}
        title="MRV 리포트를 생성하시겠습니까?"
        confirmLabel="생성"
        pendingLabel="생성 중…"
        pending={mutation.isPending}
        onConfirm={handleGenerate}
        onCancel={() => setConfirmOpen(false)}
        description={
          <>
            생성된 리포트는 <strong className="text-mrv-fg">수정·삭제할 수 없습니다</strong>.
            다시 만들면 새 리포트가 발급되며 이전 리포트도 그대로 남습니다.
          </>
        }
        detail={
          <>
            <div>
              대상 기간: {fromDay} ~ {toDay}
            </div>
            <div>
              적용 배출계수:{" "}
              {factorForConfirm
                ? `${factorForConfirm.version} (${factorForConfirm.factor_tco2e_per_mwh} tCO2e/MWh)`
                : "활성 계수"}
            </div>
          </>
        }
      />
    </div>
  )
}
