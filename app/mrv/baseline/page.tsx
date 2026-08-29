"use client"

/**
 * 기준선 확정 · 잠금.
 * 원본: mrv-platform/apps/web/src/features/baseline/BaselineLockPage.tsx
 *
 * ★ 이 화면의 동작은 되돌릴 수 없다. 잠긴 기준선은 API 에도 수정 경로가 없고 DB 트리거가
 * UPDATE/DELETE 자체를 거부한다. 그래서 순서를 강제한다: 기간 선택 → 미리보기 → 확인 →
 * 잠금. 미리보기를 거치지 않으면 잠금 버튼이 열리지 않는다.
 */

import { useState } from "react"
import { ApiError, apiFetch, errorMessage, useApiMutation, useApiQuery } from "@/lib/mrv/client"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { useMrvSite } from "@/lib/mrv/ui/site"
import { formatIsoLocal } from "@/lib/mrv/ui/datetime"
import { METRIC_META, METRIC_ORDER } from "@/lib/mrv/ui/metric-meta"
import { KpiCard } from "@/components/mrv/kpi-card"
import { ConfirmDialog } from "@/components/mrv/confirm-dialog"
import { INPUT_CLASS, PageHeader } from "@/components/mrv/ui"
import type { BaselineResponse, KpiMetrics, KpiResponse } from "@/lib/mrv/api-types"

const WRITER_ROLES = new Set(["owner", "operator"])

function dayToIsoUtc(day: string): string | null {
  if (!day) return null
  const iso = `${day}T00:00:00Z`
  return Number.isNaN(new Date(iso).getTime()) ? null : iso
}

function MetricsGrid({
  metrics,
  configVersion,
  period,
}: {
  metrics: KpiMetrics
  configVersion: string
  period: { from: string; to: string }
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {METRIC_ORDER.map((key) => (
        <KpiCard
          key={key}
          title={METRIC_META[key].title}
          metricKey={key}
          metric={metrics[key]}
          configVersion={configVersion}
          period={period}
          betterWhen={METRIC_META[key].betterWhen}
        />
      ))}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-mrv-muted">{label}</dt>
      <dd className="break-all text-mrv-fg">{value}</dd>
    </div>
  )
}

export default function BaselineLockPage() {
  const { selectedSiteId, selectedSite } = useMrvSite()
  const { role } = useMrvSession()
  const isViewer = role === "viewer"
  const canLock = role !== null && WRITER_ROLES.has(role)

  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [previewPeriod, setPreviewPeriod] = useState<{ from: string; to: string } | null>(
    null,
  )
  const [periodError, setPeriodError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const baselineQuery = useApiQuery<BaselineResponse | null>(
    async (signal) => {
      try {
        return await apiFetch<BaselineResponse>(
          `/sites/${encodeURIComponent(selectedSiteId as string)}/baseline`,
          { signal },
        )
      } catch (err) {
        // 404 는 "아직 잠긴 기준선이 없다"는 정상 상태다 — 오류로 다루지 않는다.
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    },
    [selectedSiteId],
    { enabled: Boolean(selectedSiteId) },
  )

  const previewQuery = useApiQuery<KpiResponse>(
    (signal) =>
      apiFetch<KpiResponse>(`/sites/${encodeURIComponent(selectedSiteId as string)}/kpi`, {
        query: { from: previewPeriod!.from, to: previewPeriod!.to },
        signal,
      }),
    [selectedSiteId, previewPeriod?.from, previewPeriod?.to],
    { enabled: Boolean(selectedSiteId && previewPeriod) },
  )

  const lockMutation = useApiMutation(async (period: { from: string; to: string }) =>
    apiFetch<BaselineResponse>(
      `/sites/${encodeURIComponent(selectedSiteId as string)}/baseline/lock`,
      { method: "POST", json: { period } },
    ),
  )

  function handlePreview() {
    const fromIso = dayToIsoUtc(from)
    const toIso = dayToIsoUtc(to)
    if (!fromIso || !toIso) return setPeriodError("기간이 올바르지 않습니다.")
    if (new Date(fromIso).getTime() >= new Date(toIso).getTime()) {
      return setPeriodError("시작일은 종료일보다 앞서야 합니다.")
    }
    setPeriodError(null)
    setPreviewPeriod({ from: fromIso, to: toIso })
  }

  async function handleConfirmLock() {
    if (!previewPeriod) return
    try {
      await lockMutation.mutate(previewPeriod)
      baselineQuery.refetch()
    } catch {
      /* 아래에 오류를 표시한다. */
    } finally {
      setConfirmOpen(false)
    }
  }

  const header = (
    <PageHeader
      title="기준선 확정 · 잠금"
      description={`${selectedSite?.name ?? "사이트"} · 기준선(Before)은 잠금 후 불변입니다.`}
    />
  )

  if (baselineQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
        {header}
        <div
          role="status"
          aria-label="기준선 상태 불러오는 중"
          className="h-40 animate-pulse rounded-xl border border-mrv-border bg-mrv-surface"
        />
      </div>
    )
  }

  if (baselineQuery.isError) {
    const unauthorized =
      baselineQuery.error instanceof ApiError && baselineQuery.error.isUnauthorized
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
        {header}
        <p role="alert" className="text-sm text-mrv-red">
          {unauthorized
            ? "인증이 만료되었습니다. 다시 로그인해 주세요."
            : "기준선 상태를 불러오지 못했습니다."}
        </p>
      </div>
    )
  }

  const locked = baselineQuery.data

  if (locked) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
        {header}
        <div className="flex items-center gap-2">
          <span
            role="status"
            className="inline-flex items-center gap-1 rounded-full bg-mrv-na-bg px-3 py-1 text-xs font-medium text-mrv-fg"
          >
            <span aria-hidden="true">🔒</span> 잠금됨(불변)
          </span>
          <span className="text-sm text-mrv-muted">
            기간 {locked.period.from.slice(0, 10)} ~ {locked.period.to.slice(0, 10)}
          </span>
        </div>

        <MetricsGrid
          metrics={locked.metrics}
          configVersion={locked.kpi_config.version}
          period={{ from: locked.period.from, to: locked.period.to }}
        />

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-mrv-border bg-mrv-surface p-4 text-sm sm:grid-cols-4">
          <Field label="잠금 사용자" value={locked.locked_by ?? "-"} />
          <Field label="잠금 시각" value={formatIsoLocal(locked.locked_at)} />
          <Field label="산식 버전" value={locked.kpi_config.version} />
          <Field label="스냅샷 ID" value={locked.provenance.kpi_snapshot_id ?? "-"} />
        </dl>

        <button
          type="button"
          disabled
          aria-disabled="true"
          className="self-start rounded-md border border-mrv-border px-4 py-2 text-sm text-mrv-muted opacity-60"
        >
          기준선 잠금 (이미 잠김)
        </button>
        <p className="text-xs text-mrv-muted">
          기준선은 잠금 후 수정·삭제할 수 없습니다.
        </p>
      </div>
    )
  }

  const lockConflict =
    lockMutation.error instanceof ApiError && lockMutation.error.status === 409
  const lockErrorMsg =
    lockMutation.error === undefined
      ? null
      : lockConflict
        ? "이미 잠긴 기준선이 있습니다. 기준선은 재잠금할 수 없습니다."
        : errorMessage(lockMutation.error, "기준선 잠금에 실패했습니다.")

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      {header}

      <section className="flex flex-col gap-3 rounded-xl border border-mrv-border bg-mrv-surface p-5">
        <h2 className="text-base font-semibold text-mrv-fg">기준선 기간 선택</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-mrv-fg">
            시작일
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={`${INPUT_CLASS} py-2`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-mrv-fg">
            종료일
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={`${INPUT_CLASS} py-2`}
            />
          </label>
          <button
            type="button"
            onClick={handlePreview}
            className="rounded-md border border-mrv-primary px-4 py-2 text-sm font-medium text-mrv-primary hover:bg-mrv-bg"
          >
            미리보기
          </button>
        </div>
        {periodError && (
          <p role="alert" className="text-sm text-mrv-red">
            {periodError}
          </p>
        )}
      </section>

      {previewPeriod && (
        <section className="flex flex-col gap-3" aria-label="기준선 미리보기">
          <h2 className="text-base font-semibold text-mrv-fg">미리보기 (잠금 전 확인)</h2>
          {previewQuery.isLoading && (
            <div
              role="status"
              aria-label="미리보기 불러오는 중"
              className="h-24 animate-pulse rounded-xl border border-mrv-border bg-mrv-surface"
            />
          )}
          {previewQuery.isError && (
            <p role="alert" className="text-sm text-mrv-red">
              미리보기 KPI를 불러오지 못했습니다.
            </p>
          )}
          {previewQuery.data && (
            <MetricsGrid
              metrics={previewQuery.data.metrics}
              configVersion={previewQuery.data.kpi_config.version}
              period={{
                from: previewQuery.data.period.from,
                to: previewQuery.data.period.to,
              }}
            />
          )}
        </section>
      )}

      {lockErrorMsg && (
        <p role="alert" className="text-sm text-mrv-red">
          {lockErrorMsg}
        </p>
      )}

      {!isViewer && (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={!canLock || !previewPeriod || lockMutation.isPending}
          className="self-start rounded-md bg-mrv-red px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          기준선 잠금
        </button>
      )}
      {isViewer && (
        <p role="note" className="text-sm text-mrv-muted">
          읽기 전용 권한(viewer)입니다. 기준선 잠금은 owner/operator 만 가능합니다.
        </p>
      )}
      {!previewPeriod && !isViewer && (
        <p className="text-xs text-mrv-muted">
          먼저 기간을 미리보기하면 잠금이 활성화됩니다.
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="기준선을 잠그시겠습니까?"
        tone="danger"
        confirmLabel="잠금"
        pendingLabel="잠그는 중…"
        pending={lockMutation.isPending}
        onConfirm={handleConfirmLock}
        onCancel={() => setConfirmOpen(false)}
        description={
          <>
            잠금 후에는 <strong className="text-mrv-red">수정·삭제가 불가능</strong>합니다
            (불변). 아래 기간의 KPI 스냅샷이 기준선(Before)으로 영구 고정됩니다.
          </>
        }
        detail={`기간: ${(previewPeriod?.from ?? from).slice(0, 10)} ~ ${(previewPeriod?.to ?? to).slice(0, 10)}`}
      />
    </div>
  )
}
