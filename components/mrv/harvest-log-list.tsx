"use client"

/**
 * 생산량 기록 목록 + **정정(무효 처리)**.
 *
 * 입력 창구만 있고 되돌릴 길이 없으면 오타 하나가 EI 의 분모를 영구히 흔든다. 그렇다고
 * 지우면 이미 발행된 리포트의 근거가 사라지므로, 무효 표시로 다룬다(사정은
 * `lib/mrv/harvest-void.ts`).
 *
 * **무효 처리된 줄을 감추지 않는다.** 감추면 되돌릴 대상을 찾을 수 없고, 무엇보다 "이
 * 기간에 무엇이 빠져 있는가" 가 화면에서 사라진다. 줄을 흐리게 두고 사유를 함께 적는다.
 */

import { useId, useState } from "react"
import { ApiError, apiFetch, errorMessage, useApiMutation, useApiQuery } from "@/lib/mrv/client"
import { formatIsoLocal } from "@/lib/mrv/ui/datetime"
import { INPUT_CLASS, LoadError, formatNumber } from "@/components/mrv/ui"
import { PRODUCTION_BASIS_LABELS, type ProductionBasis } from "@/lib/mrv/production-basis"

type HarvestLogRow = {
  id: string
  batch_id: string
  ts: string
  biomass_kg: number
  production_basis: ProductionBasis | null
  production_basis_note: string | null
  survival_adjusted: boolean | null
  voided_at?: string | null
  voided_by?: string | null
  void_reason?: string | null
}

type ListResponse = { items: HarvestLogRow[]; total: number }

export function HarvestLogList({
  siteId,
  canWrite,
  refreshToken,
}: {
  siteId: string | null
  canWrite: boolean
  /** 생산량을 새로 저장하면 올라간다 — 목록이 그때 다시 읽는다. */
  refreshToken: number
}) {
  const reasonId = useId()
  const [target, setTarget] = useState<HarvestLogRow | null>(null)
  const [reason, setReason] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [doneAt, setDoneAt] = useState<string | null>(null)

  const list = useApiQuery<ListResponse>(
    (signal) =>
      apiFetch<ListResponse>(`/sites/${encodeURIComponent(siteId as string)}/harvests`, {
        signal,
      }),
    [siteId, refreshToken],
    { enabled: Boolean(siteId) },
  )

  const voidMutation = useApiMutation(async (arg: unknown) => {
    const { id, body } = arg as { id: string; body: unknown }
    return apiFetch(
      `/sites/${encodeURIComponent(siteId as string)}/harvests/${encodeURIComponent(id)}/void`,
      { method: "POST", json: body },
    )
  })
  const unvoidMutation = useApiMutation(async (id: unknown) =>
    apiFetch(
      `/sites/${encodeURIComponent(siteId as string)}/harvests/${encodeURIComponent(
        String(id),
      )}/void`,
      { method: "DELETE" },
    ),
  )

  const rows = list.data?.items ?? []
  const live = rows.filter((r) => !r.voided_at)
  const busy = voidMutation.isPending || unvoidMutation.isPending

  async function doVoid(e: React.FormEvent) {
    e.preventDefault()
    if (!target || busy) return
    if (reason.trim() === "") {
      return setFieldError(
        "무효 처리 사유를 적으세요 — 사유 없이 빠진 생산량은 분모를 임의로 줄인 것과 구분되지 않습니다.",
      )
    }
    setFieldError(null)
    try {
      await voidMutation.mutate({ id: target.id, body: { reason: reason.trim() } })
      setTarget(null)
      setReason("")
      setDoneAt(new Date().toLocaleTimeString("ko-KR"))
      list.refetch()
    } catch {
      /* 오류는 voidMutation.error 로 표시된다. */
    }
  }

  async function doUnvoid(id: string) {
    if (busy) return
    try {
      await unvoidMutation.mutate(id)
      setDoneAt(new Date().toLocaleTimeString("ko-KR"))
      list.refetch()
    } catch {
      /* 오류는 unvoidMutation.error 로 표시된다. */
    }
  }

  return (
    <section
      aria-label="생산량 기록 목록"
      className="flex flex-col gap-4 rounded-xl border border-mrv-border bg-mrv-surface p-5 shadow-sm"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-mrv-fg">생산량 기록 · 정정</h2>
        <p className="text-xs leading-relaxed text-mrv-muted">
          잘못 넣은 기록은 <b>지우지 않고 무효로 표시합니다.</b> 지우면 이미 발행된 리포트가
          참조한 근거가 사라집니다. 무효 처리된 기록은 EI · 폭기 EI · FCR · OEI 의 분모에서
          빠지고, 누가 언제 왜 뺐는지가 감사 로그에 남습니다. 되돌릴 수 있습니다.
        </p>
      </div>

      {list.isLoading && (
        <div
          role="status"
          className="h-20 animate-pulse rounded-md border border-mrv-border"
          aria-label="생산량 기록 불러오는 중"
        />
      )}

      {list.isError && !list.isLoading && (
        <LoadError
          message="생산량 기록을 불러오지 못했습니다."
          isUnauthorized={list.error instanceof ApiError && list.error.isUnauthorized}
          onRetry={list.refetch}
        />
      )}

      {list.data && (
        <>
          <p className="text-xs text-mrv-muted">
            전체 {rows.length}건 · 산입 {live.length}건
            {rows.length !== live.length && ` · 무효 ${rows.length - live.length}건`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">생산량 기록</caption>
              <thead>
                <tr className="border-b border-mrv-border text-xs text-mrv-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">기록 시각</th>
                  <th scope="col" className="py-2 pr-3 font-medium">생체량(kg)</th>
                  <th scope="col" className="py-2 pr-3 font-medium">산정 근거</th>
                  <th scope="col" className="py-2 pr-3 font-medium">상태</th>
                  <th scope="col" className="py-2 font-medium">정정</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-mrv-muted">
                      생산량 기록이 없습니다.
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const voided = Boolean(r.voided_at)
                  return (
                    <tr
                      key={r.id}
                      className={`border-b border-mrv-border last:border-0 ${
                        voided ? "opacity-70" : ""
                      }`}
                    >
                      <td className="py-2 pr-3 text-mrv-fg">{formatIsoLocal(r.ts)}</td>
                      <td className="py-2 pr-3 tabular-nums text-mrv-fg">
                        <span className={voided ? "line-through" : ""}>
                          {formatNumber(r.biomass_kg, 1)}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-mrv-muted">
                        {r.production_basis
                          ? PRODUCTION_BASIS_LABELS[r.production_basis]
                          : "미기재"}
                      </td>
                      <td className="py-2 pr-3">
                        {voided ? (
                          <span className="rounded-full bg-mrv-na-bg px-2 py-0.5 text-[11px] font-medium text-mrv-na">
                            무효 · 산입 제외
                          </span>
                        ) : (
                          <span className="rounded-full bg-mrv-green-bg px-2 py-0.5 text-[11px] font-medium text-mrv-green">
                            산입
                          </span>
                        )}
                        {voided && r.void_reason && (
                          <span className="ml-2 text-xs text-mrv-muted">{r.void_reason}</span>
                        )}
                      </td>
                      <td className="py-2">
                        {!canWrite ? (
                          <span className="text-xs text-mrv-muted">—</span>
                        ) : voided ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => doUnvoid(r.id)}
                            className="rounded-md border border-mrv-border bg-mrv-surface px-2 py-1 text-xs font-medium text-mrv-fg hover:bg-mrv-bg disabled:opacity-60"
                          >
                            되돌리기
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setTarget(r)
                              setReason("")
                              setFieldError(null)
                            }}
                            className="rounded-md border border-mrv-border bg-mrv-surface px-2 py-1 text-xs font-medium text-mrv-fg hover:bg-mrv-bg disabled:opacity-60"
                          >
                            무효 처리
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {target !== null && (
        <form
          onSubmit={doVoid}
          aria-label="생산량 무효 처리 폼"
          className="flex flex-col gap-3 rounded-md border border-mrv-amber bg-mrv-amber-bg p-3"
        >
          <p className="text-sm leading-relaxed text-mrv-fg">
            <b>{formatIsoLocal(target.ts)}</b> 의 {formatNumber(target.biomass_kg, 1)} kg 기록을
            무효 처리합니다. 이 기록은 분모에서 빠지고, 같은 기간의 EI · FCR · OEI 가
            달라집니다.
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor={reasonId} className="text-sm font-medium text-mrv-fg">
              무효 처리 사유 <span className="text-mrv-red">*</span>
            </label>
            <textarea
              id={reasonId}
              rows={2}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 10/20 출하 전표를 두 번 입력했습니다. 뒤의 것을 뺍니다."
              className={INPUT_CLASS}
            />
          </div>
          {fieldError !== null && (
            <p role="alert" className="text-xs text-mrv-red">
              {fieldError}
            </p>
          )}
          {voidMutation.error !== undefined && (
            <p role="alert" className="text-xs text-mrv-red">
              {errorMessage(voidMutation.error, "무효 처리에 실패했습니다.")}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-mrv-red px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {voidMutation.isPending ? "처리 중…" : "무효 처리"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setTarget(null)}
              className="rounded-md border border-mrv-border bg-mrv-surface px-3 py-1.5 text-sm font-medium text-mrv-fg hover:bg-mrv-bg"
            >
              취소
            </button>
          </div>
        </form>
      )}

      {unvoidMutation.error !== undefined && (
        <p role="alert" className="text-xs text-mrv-red">
          {errorMessage(unvoidMutation.error, "되돌리기에 실패했습니다.")}
        </p>
      )}
      {doneAt !== null &&
        voidMutation.error === undefined &&
        unvoidMutation.error === undefined && (
          <p role="status" className="text-xs text-mrv-green">
            {doneAt} 처리했습니다. 다음 KPI 조회부터 반영됩니다.
          </p>
        )}
    </section>
  )
}
