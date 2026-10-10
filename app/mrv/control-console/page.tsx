"use client"

/**
 * 승인형 제어 콘솔 (ENTERPRISE).
 * 원본: mrv-platform/apps/web/src/features/control-console/{ControlConsolePage,ControlActionConfirmDialog}.tsx
 *
 * ★ 이 화면은 설비를 직접 제어하지 않는다. "추천값을 사람이 승인하고, 실제 설비에 반영한
 * 뒤, 그 사실과 결과를 기록한다"는 흐름을 다룬다. 그래서 '적용' 버튼의 뜻은 "지금 적용해
 * 달라"가 아니라 "이미 적용했고 그 결과를 남긴다"이다 — 화면에도 그렇게 적는다.
 *
 * 상태는 pending → approved → applied 로만 간다. 승인 없이 적용하려 하면 서버가 409 로
 * 막고, DB CHECK 제약이 그 아래를 한 번 더 막는다.
 */

import { useState } from "react"
import { ApiError, apiFetch, errorMessage, useApiMutation, useApiQuery } from "@/lib/mrv/client"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { useMrvSite } from "@/lib/mrv/ui/site"
import { formatIsoLocal } from "@/lib/mrv/ui/datetime"
import {
  CONTROL_ACTION_STATUS_BADGE_CLASS,
  CONTROL_ACTION_STATUS_FILTERS,
  CONTROL_ACTION_STATUS_LABEL,
} from "@/lib/mrv/ui/control-console-meta"
import { ConfirmDialog } from "@/components/mrv/confirm-dialog"
import {
  Badge,
  CenteredMessage,
  INPUT_CLASS,
  LoadError,
  PageHeader,
  SECONDARY_BUTTON,
} from "@/components/mrv/ui"
import type {
  ControlAction,
  ControlActionListResponse,
  ControlActionStatusFilter,
} from "@/lib/mrv/api-types"

const WRITER_ROLES = new Set(["owner", "operator"])

type PendingOp = { action: ControlAction; op: "approve" | "reject" | "apply" }

const OP_TEXT: Record<
  PendingOp["op"],
  { title: string; description: string; confirmLabel: string; tone: "primary" | "danger" }
> = {
  approve: {
    title: "이 제어 액션을 승인하시겠습니까?",
    description:
      "승인하면 운영자가 실제 설비에 반영할 수 있는 상태가 됩니다. 승인자와 승인 시각이 기록됩니다.",
    confirmLabel: "승인",
    tone: "primary",
  },
  reject: {
    title: "이 제어 액션을 거부하시겠습니까?",
    description: "거부 사유는 감사 로그에 남습니다. 거부된 액션은 다시 승인할 수 없습니다.",
    confirmLabel: "거부",
    tone: "danger",
  },
  apply: {
    title: "적용 사실을 기록하시겠습니까?",
    description:
      "이 버튼은 설비를 제어하지 않습니다. 이미 현장에서 반영한 사실과 결과를 기록하는 것입니다.",
    confirmLabel: "적용 기록",
    tone: "primary",
  },
}

export default function ControlConsolePage() {
  const { selectedSiteId, selectedSite } = useMrvSite()
  const { isEnterprise, role, isLoading: sessionLoading } = useMrvSession()
  const canWrite = role !== null && WRITER_ROLES.has(role)

  const [statusFilter, setStatusFilter] = useState<ControlActionStatusFilter>("pending")
  const [pendingOp, setPendingOp] = useState<PendingOp | null>(null)
  const [note, setNote] = useState("")

  const query = useApiQuery<ControlActionListResponse>(
    (signal) =>
      apiFetch<ControlActionListResponse>("/control-actions", {
        query: { site_id: selectedSiteId ?? undefined, status: statusFilter },
        signal,
      }),
    [selectedSiteId, statusFilter],
    { enabled: Boolean(selectedSiteId) && isEnterprise },
  )

  const mutation = useApiMutation(async ({ action, op }: PendingOp) =>
    apiFetch(`/control-actions/${encodeURIComponent(action.id)}/${op}`, {
      method: "POST",
      json: op === "reject" ? { note: note.trim() || null } : {},
    }),
  )

  const header = (
    <PageHeader
      title="제어 콘솔 (승인형)"
      description={`${selectedSite?.name ?? "사이트"} · 추천값 승인 → 현장 반영 → 결과 기록`}
    />
  )

  if (sessionLoading) return null

  if (!isEnterprise) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
        {header}
        <CenteredMessage>제어 콘솔은 ENTERPRISE 요금제에서 이용할 수 있습니다.</CenteredMessage>
      </div>
    )
  }

  async function handleConfirm() {
    if (!pendingOp) return
    try {
      await mutation.mutate(pendingOp)
      query.refetch()
    } catch {
      /* 아래에 오류를 표시한다. */
    } finally {
      setPendingOp(null)
      setNote("")
    }
  }

  const isUnauthorized = query.error instanceof ApiError && query.error.isUnauthorized
  const items = query.data?.items ?? []

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      {header}

      <div
        role="note"
        className="rounded-xl border border-mrv-border bg-mrv-na-bg p-4 text-sm text-mrv-muted"
      >
        이 화면은 설비를 직접 제어하지 않습니다. 승인된 값을 운영자가 현장에서 반영한 뒤,
        그 사실과 결과를 여기에 기록합니다.
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-mrv-fg">
          제어 액션 {query.data ? `(${query.data.total}건)` : ""}
        </h2>
        <label className="flex items-center gap-2 text-sm text-mrv-muted">
          상태
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as ControlActionStatusFilter)
            }
            className={INPUT_CLASS}
          >
            {CONTROL_ACTION_STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {query.isLoading && (
        <div
          role="status"
          aria-label="제어 액션 불러오는 중"
          className="h-40 animate-pulse rounded-xl border border-mrv-border bg-mrv-surface"
        />
      )}

      {query.isError && !query.isLoading && (
        <LoadError
          message="제어 액션을 불러오지 못했습니다."
          isUnauthorized={isUnauthorized}
          onRetry={query.refetch}
        />
      )}

      {!query.isLoading && !query.isError && items.length === 0 && (
        <CenteredMessage>표시할 제어 액션이 없습니다.</CenteredMessage>
      )}

      {mutation.error !== undefined && (
        <p role="alert" className="text-sm text-mrv-red">
          {errorMessage(mutation.error, "상태를 바꾸지 못했습니다.")}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {items.map((action) => (
          <li
            key={action.id}
            className="flex flex-col gap-2 rounded-xl border border-mrv-border bg-mrv-surface p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={CONTROL_ACTION_STATUS_BADGE_CLASS[action.status]}>
                {CONTROL_ACTION_STATUS_LABEL[action.status]}
              </Badge>
              <span className="text-sm font-medium text-mrv-fg">수조 {action.tank_id}</span>
              <span className="ml-auto text-xs text-mrv-muted">
                제안 {formatIsoLocal(action.created_at)}
              </span>
            </div>

            <pre className="overflow-auto rounded-md bg-mrv-bg p-3 text-[11px] leading-relaxed text-mrv-fg">
              {JSON.stringify(action.recommended_json, null, 2)}
            </pre>

            {(action.approved_by || action.applied_at) && (
              <p className="text-xs text-mrv-muted">
                {action.approved_by &&
                  `승인 ${action.approved_by} · ${formatIsoLocal(action.approved_at)}`}
                {action.applied_at && ` · 적용 ${formatIsoLocal(action.applied_at)}`}
              </p>
            )}

            {canWrite && (
              <div className="flex flex-wrap gap-2">
                {action.status === "pending" && (
                  <>
                    <button
                      type="button"
                      onClick={() => setPendingOp({ action, op: "approve" })}
                      className={SECONDARY_BUTTON}
                    >
                      승인
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingOp({ action, op: "reject" })}
                      className={SECONDARY_BUTTON}
                    >
                      거부
                    </button>
                  </>
                )}
                {action.status === "approved" && (
                  <button
                    type="button"
                    onClick={() => setPendingOp({ action, op: "apply" })}
                    className={SECONDARY_BUTTON}
                  >
                    적용 사실 기록
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {pendingOp && (
        <ConfirmDialog
          open
          title={OP_TEXT[pendingOp.op].title}
          description={
            <div className="flex flex-col gap-2">
              <p>{OP_TEXT[pendingOp.op].description}</p>
              {pendingOp.op === "reject" && (
                <label className="flex flex-col gap-1 text-xs text-mrv-fg">
                  거부 사유
                  <textarea
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </label>
              )}
            </div>
          }
          detail={`수조 ${pendingOp.action.tank_id} · 액션 ${pendingOp.action.id}`}
          confirmLabel={OP_TEXT[pendingOp.op].confirmLabel}
          tone={OP_TEXT[pendingOp.op].tone}
          pending={mutation.isPending}
          onConfirm={handleConfirm}
          onCancel={() => {
            setPendingOp(null)
            setNote("")
          }}
        />
      )}
    </div>
  )
}
