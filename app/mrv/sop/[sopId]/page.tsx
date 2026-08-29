"use client"

/**
 * SOP 상세 + 점검 체크리스트 실행.
 * 원본: mrv-platform/apps/web/src/features/sop/SopDetailPage.tsx
 *
 * 점검 기록은 append-only 다 — 재점검은 수정이 아니라 새 기록이며, 그래야 "언제 무엇을
 * 점검했는가"가 시간순으로 남아 증빙이 된다.
 */

import Link from "next/link"
import { use, useState } from "react"
import { ApiError, apiFetch, errorMessage, useApiMutation, useApiQuery } from "@/lib/mrv/client"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { useMrvSite } from "@/lib/mrv/ui/site"
import { formatIsoLocal } from "@/lib/mrv/ui/datetime"
import { SOP_CATEGORY_LABEL } from "@/lib/mrv/ui/sop-meta"
import { MarkdownLite } from "@/components/mrv/markdown-lite"
import {
  CenteredMessage,
  INPUT_CLASS,
  LoadError,
  PRIMARY_BUTTON,
  PageHeader,
} from "@/components/mrv/ui"
import type {
  ChecklistRunListResponse,
  SopCategory,
  SopDetail,
} from "@/lib/mrv/api-types"

const WRITER_ROLES = new Set(["owner", "operator"])

export default function SopDetailPage({
  params,
}: {
  params: Promise<{ sopId: string }>
}) {
  const { sopId } = use(params)
  const { selectedSiteId } = useMrvSite()
  const { isPro, role, isLoading: sessionLoading } = useMrvSession()
  const canWrite = role !== null && WRITER_ROLES.has(role)

  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const detail = useApiQuery<SopDetail>(
    (signal) =>
      apiFetch<SopDetail>(`/sop/${encodeURIComponent(sopId)}`, { signal }),
    [sopId],
    { enabled: isPro },
  )

  const runs = useApiQuery<ChecklistRunListResponse>(
    (signal) =>
      apiFetch<ChecklistRunListResponse>(
        `/sites/${encodeURIComponent(selectedSiteId as string)}/sop/checklist-runs`,
        { query: { sop_id: sopId }, signal },
      ),
    [selectedSiteId, sopId],
    { enabled: isPro && Boolean(selectedSiteId) },
  )

  const mutation = useApiMutation(async (body: unknown) =>
    apiFetch(
      `/sites/${encodeURIComponent(selectedSiteId as string)}/sop/${encodeURIComponent(sopId)}/checklist-runs`,
      { method: "POST", json: body },
    ),
  )

  if (sessionLoading) return null

  if (!isPro) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
        <PageHeader title="SOP" />
        <CenteredMessage>SOP 는 PRO 이상 요금제에서 이용할 수 있습니다.</CenteredMessage>
      </div>
    )
  }

  const isUnauthorized = detail.error instanceof ApiError && detail.error.isUnauthorized
  const notFound = detail.error instanceof ApiError && detail.error.status === 404

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!detail.data || !canWrite) return
    try {
      await mutation.mutate({
        items: detail.data.checklist_items.map((item) => ({
          item_id: item.id,
          checked: checked[item.id] ?? false,
          note: notes[item.id]?.trim() || null,
        })),
      })
      setSavedAt(new Date().toLocaleTimeString("ko-KR"))
      setChecked({})
      setNotes({})
      runs.refetch()
    } catch {
      /* 아래에 오류를 표시한다. */
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <Link href="/mrv/sop" className="text-sm text-mrv-primary hover:underline">
        ← SOP 목록
      </Link>

      {detail.isLoading && (
        <div
          role="status"
          aria-label="SOP 불러오는 중"
          className="h-64 animate-pulse rounded-xl border border-mrv-border bg-mrv-surface"
        />
      )}

      {notFound && <CenteredMessage>SOP 를 찾을 수 없습니다.</CenteredMessage>}

      {detail.isError && !notFound && !detail.isLoading && (
        <LoadError
          message="SOP 를 불러오지 못했습니다."
          isUnauthorized={isUnauthorized}
          onRetry={detail.refetch}
        />
      )}

      {detail.data && (
        <>
          <PageHeader
            title={detail.data.title}
            description={SOP_CATEGORY_LABEL[detail.data.category as SopCategory]}
          />

          <article className="rounded-xl border border-mrv-border bg-mrv-surface p-5">
            <MarkdownLite markdown={detail.data.body_markdown} />
          </article>

          <form
            onSubmit={handleSubmit}
            aria-label="점검 체크리스트"
            className="flex flex-col gap-3 rounded-xl border border-mrv-border bg-mrv-surface p-5"
          >
            <h2 className="text-base font-semibold text-mrv-fg">점검 체크리스트</h2>

            {!canWrite && (
              <p role="note" className="rounded-md bg-mrv-na-bg px-3 py-2 text-xs text-mrv-muted">
                읽기 전용 권한(viewer)입니다. 점검 기록은 owner/operator 만 남길 수 있습니다.
              </p>
            )}

            <ul className="flex flex-col gap-3">
              {detail.data.checklist_items.map((item) => (
                <li key={item.id} className="flex flex-col gap-1">
                  <label className="flex items-start gap-2 text-sm text-mrv-fg">
                    <input
                      type="checkbox"
                      checked={checked[item.id] ?? false}
                      disabled={!canWrite || mutation.isPending}
                      onChange={(e) =>
                        setChecked((prev) => ({ ...prev, [item.id]: e.target.checked }))
                      }
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-mrv-border"
                    />
                    {item.label}
                  </label>
                  <input
                    type="text"
                    placeholder="메모(선택)"
                    value={notes[item.id] ?? ""}
                    disabled={!canWrite || mutation.isPending}
                    onChange={(e) =>
                      setNotes((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                    className={`${INPUT_CLASS} ml-6`}
                  />
                </li>
              ))}
            </ul>

            {mutation.error !== undefined && (
              <p role="alert" className="text-sm text-mrv-red">
                {errorMessage(mutation.error, "점검 기록 저장에 실패했습니다.")}
              </p>
            )}
            {savedAt && mutation.error === undefined && (
              <p role="status" className="text-sm text-mrv-green">
                {savedAt} 점검 기록을 저장했습니다.
              </p>
            )}

            {canWrite && (
              <button
                type="submit"
                disabled={mutation.isPending}
                className={`${PRIMARY_BUTTON} self-start`}
              >
                {mutation.isPending ? "저장 중…" : "점검 기록 저장"}
              </button>
            )}
          </form>

          <section aria-label="점검 이력" className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-mrv-fg">점검 이력</h2>
            {runs.isLoading && (
              <div role="status" className="h-20 animate-pulse rounded-xl bg-mrv-surface" />
            )}
            {!runs.isLoading && (runs.data?.items.length ?? 0) === 0 && (
              <p className="text-sm text-mrv-muted">아직 점검 기록이 없습니다.</p>
            )}
            <ul className="flex flex-col gap-2">
              {(runs.data?.items ?? []).map((run) => {
                const total = run.items.length
                const done = run.items.filter((i) => i.checked).length
                return (
                  <li
                    key={run.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-mrv-border bg-mrv-surface px-4 py-2 text-sm"
                  >
                    <span className="text-mrv-fg">
                      {done}/{total} 항목 점검
                    </span>
                    <span className="text-xs text-mrv-muted">
                      {run.performed_by} · {formatIsoLocal(run.performed_at)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
