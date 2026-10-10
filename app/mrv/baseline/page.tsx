"use client"

/**
 * 기준선 확정 · 잠금.
 * 원본: mrv-platform/apps/web/src/features/baseline/BaselineLockPage.tsx
 *
 * ★ 이 화면의 동작은 되돌릴 수 없다. 잠긴 기준선은 API 에도 수정 경로가 없고 DB 트리거가
 * UPDATE/DELETE 자체를 거부한다. 그래서 순서를 강제한다: 기간 선택 → 미리보기 → 확인 →
 * 잠금. 미리보기를 거치지 않으면 잠금 버튼이 열리지 않는다.
 *
 * 미리보기는 KPI 값만 보여 주었는데, **값이 그럴듯해 보여도 근거가 몇 건뿐일 수 있다.**
 * 그래서 입력 충분성 점검(`GET .../baseline/readiness`)을 나란히 띄우고, 미달이면 잠금
 * 버튼을 막는다. 그래도 잠가야 하는 경우(시범 사이트 등)에는 **사유를 적어야** 열린다 —
 * 그 사유는 감사 로그에 남아 나중에 읽힌다.
 *
 * 판정은 전부 서버가 한다. 이 화면은 받은 결과로 버튼만 가른다 — 화면이 따로 판정하면
 * "미리보기는 통과라는데 잠금은 거부한다" 가 생긴다.
 */

import { useState } from "react"
import { ApiError, apiFetch, errorMessage, useApiMutation, useApiQuery } from "@/lib/mrv/client"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { useMrvSite } from "@/lib/mrv/ui/site"
import { formatIsoLocal } from "@/lib/mrv/ui/datetime"
import { METRIC_META, METRIC_ORDER } from "@/lib/mrv/ui/metric-meta"
import { KpiCard } from "@/components/mrv/kpi-card"
import { ConfirmDialog } from "@/components/mrv/confirm-dialog"
import { BaselineReadinessReport } from "@/components/mrv/baseline-readiness-report"
import { INPUT_CLASS, PageHeader } from "@/components/mrv/ui"
import type {
  BaselineReadinessResponse,
  BaselineResponse,
  KpiMetrics,
  KpiResponse,
} from "@/lib/mrv/api-types"

const WRITER_ROLES = new Set(["owner", "operator"])

/** 강행 사유 길이 상한. 잠금 라우트의 MAX_ACK_LENGTH 와 같은 값이어야 한다. */
const MAX_OVERRIDE_REASON_LENGTH = 1000

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
  /** 충분성 미달을 알고도 잠글 때의 사유. 비어 있으면 잠금 버튼이 열리지 않는다. */
  const [overrideReason, setOverrideReason] = useState("")

  /**
   * 미리보기가 어느 사이트의 것인지. 전역 사이트 선택기로 사이트를 바꾸면 미리보기와
   * 강행 사유를 함께 버린다.
   *
   * 없으면: 사이트 A 에서 적어 둔 미달 사유가 그대로 남은 채 B 의 판정만 다시 돌고,
   * **B 의 감사 로그에 A 를 설명하는 사유가 영구히 박힌다.** 되돌릴 수 없는 기록이다.
   * (렌더 중 상태 보정은 React 가 권하는 형태다 — effect 로 미루면 한 프레임 동안
   * 남의 사유가 붙은 화면이 그려진다.)
   */
  const [previewSiteId, setPreviewSiteId] = useState(selectedSiteId)
  if (previewSiteId !== selectedSiteId) {
    setPreviewSiteId(selectedSiteId)
    setPreviewPeriod(null)
    setOverrideReason("")
    setPeriodError(null)
    setConfirmOpen(false)
  }

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

  // 충분성 점검. 잠금 라우트와 같은 판정 함수를 쓰므로 여기서 ok 면 잠금도 통과한다.
  const readinessQuery = useApiQuery<BaselineReadinessResponse>(
    (signal) =>
      apiFetch<BaselineReadinessResponse>(
        `/sites/${encodeURIComponent(selectedSiteId as string)}/baseline/readiness`,
        { query: { from: previewPeriod!.from, to: previewPeriod!.to }, signal },
      ),
    [selectedSiteId, previewPeriod?.from, previewPeriod?.to],
    { enabled: Boolean(selectedSiteId && previewPeriod) },
  )

  const lockMutation = useApiMutation(
    async (payload: {
      period: { from: string; to: string }
      acknowledge_insufficient?: string
    }) =>
      apiFetch<BaselineResponse>(
        `/sites/${encodeURIComponent(selectedSiteId as string)}/baseline/lock`,
        { method: "POST", json: payload },
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
    // 기간을 다시 고르면 직전 기간에 대해 적어 둔 강행 사유는 무효다.
    setOverrideReason("")
    setPreviewPeriod({ from: fromIso, to: toIso })
  }

  async function handleConfirmLock() {
    if (!previewPeriod) return
    try {
      await lockMutation.mutate({
        period: previewPeriod,
        // 충분성을 통과했으면 사유를 보내지 않는다 — 보내면 감사 로그에
        // "미달을 강행했다"는 기록이 거짓으로 남는다.
        ...(readiness && !readiness.ok ? { acknowledge_insufficient: overrideReason.trim() } : {}),
      })
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

  /**
   * 판정 결과. **로딩 중에는 들고 있는 값을 쓰지 않는다.** useApiQuery 는 deps 가 바뀌어도
   * 새 요청이 끝날 때까지 직전 결과를 그대로 들고 있다(lib/mrv/client.ts). 그래서 기간이나
   * 사이트를 바꾼 직후에는 `readinessQuery.data` 가 **직전 대상의 판정**이다. 그걸 쓰면
   * 잠금 버튼이 남의 판정으로 열리고, 화면에도 로딩 스켈레톤과 옛 판정이 나란히 뜬다.
   */
  const readiness = readinessQuery.isLoading ? undefined : readinessQuery.data
  /** 사유를 적어도 넘길 수 없는 상태(지표가 하나도 산출되지 않음). */
  const readinessFatal = readiness?.fatal === true
  /** 미달인데 사유를 아직 안 적었다. */
  const needsReason = readiness !== undefined && !readiness.ok && !readinessFatal
  /**
   * 잠금 버튼을 열어도 되는가.
   * 점검 결과가 아직 없으면 열지 않는다 — 판정을 못 본 채로 되돌릴 수 없는 일을 하지 않는다.
   */
  const lockAllowed =
    canLock &&
    Boolean(previewPeriod) &&
    readiness !== undefined &&
    !readinessFatal &&
    (readiness.ok || overrideReason.trim().length > 0) &&
    !lockMutation.isPending

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

          {/* 값만 보면 근거가 몇 건인지 알 수 없다. 그래서 KPI 바로 아래에 붙인다. */}
          {readinessQuery.isLoading && (
            <div
              role="status"
              aria-label="입력 충분성 점검 중"
              className="h-24 animate-pulse rounded-xl border border-mrv-border bg-mrv-surface"
            />
          )}
          {readinessQuery.isError && (
            <p role="alert" className="text-sm text-mrv-red">
              입력 충분성을 점검하지 못했습니다. 점검 결과 없이는 잠글 수 없습니다.
            </p>
          )}
          {readiness && <BaselineReadinessReport readiness={readiness} />}

          {readinessFatal && (
            <p
              role="alert"
              className="rounded-md border border-mrv-red bg-mrv-red-bg p-3 text-sm text-mrv-fg"
            >
              이 기간은 사유를 적어도 잠글 수 없습니다. 기간을 다시 고르거나 입력을 먼저
              채워 주세요.
            </p>
          )}

          {needsReason && !isViewer && (
            <div className="flex flex-col gap-2 rounded-md border border-mrv-amber bg-mrv-amber-bg p-3">
              <label htmlFor="baseline-override-reason" className="text-sm font-medium text-mrv-fg">
                그래도 잠그려면 사유를 적어 주세요 <span className="text-mrv-red">*</span>
              </label>
              <textarea
                id="baseline-override-reason"
                rows={2}
                maxLength={MAX_OVERRIDE_REASON_LENGTH}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="예: 시범 운영 구간이라 계측 기간이 짧지만 이 값을 원점으로 삼기로 함"
                className={`${INPUT_CLASS} py-2`}
              />
              <p className="text-xs text-mrv-muted">
                이 사유는 감사 로그에 미달 항목과 함께 남습니다. 나중에 &ldquo;이 기준선은
                무엇을 무시하고 잠갔나&rdquo;를 되짚는 근거가 됩니다.
              </p>
            </div>
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
          disabled={!lockAllowed}
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
          먼저 기간을 미리보기하면 입력 충분성 점검이 돌고, 통과해야 잠금이 활성화됩니다.
        </p>
      )}
      {previewPeriod && !isViewer && !lockAllowed && readiness && !readinessFatal && (
        <p className="text-xs text-mrv-muted">
          {readiness.ok
            ? "잠금 준비가 됐습니다."
            : "미달 항목이 있어 잠금이 막혀 있습니다. 기간을 다시 고르거나 위에 사유를 적어 주세요."}
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
            {needsReason && (
              <>
                {" "}
                이 기간은{" "}
                <strong className="text-mrv-red">입력 충분성 점검에 미달</strong>했고,
                적어 주신 사유와 함께 강행 기록이 감사 로그에 남습니다.
              </>
            )}
          </>
        }
        detail={
          /* 줄바꿈 문자는 이 div 에서 공백으로 눌린다. 되돌릴 수 없는 동작의 마지막
             확인 화면이라 기간과 사유가 한 줄로 이어 붙으면 안 된다. */
          <>
            <p>
              기간: {(previewPeriod?.from ?? from).slice(0, 10)} ~{" "}
              {(previewPeriod?.to ?? to).slice(0, 10)}
            </p>
            {needsReason && <p className="mt-1">강행 사유: {overrideReason.trim()}</p>}
          </>
        }
      />
    </div>
  )
}
