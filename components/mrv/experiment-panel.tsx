"use client"

/**
 * 비교실험(A/B) 패널 — 전·후 비교 화면 안에 둔다. (PRO, 사양서 화면 9번)
 *
 * 기준선 비교와 **같은 표**로 결과를 그린다(`toComparisonViewModel` 공용). 두 비교가 다른
 * 표로 보이면 "기준선 비교는 믿고 실험은 안 믿는" 인상을 준다. `baseline` 자리에 대조군,
 * `current` 자리에 처리군이 들어간다.
 *
 * 결과는 저장되지 않고 조회 때마다 두 구간을 라이브로 산출한다 — 실험 결과는 발행물이
 * 아니라 조회다. 발행이 필요하면 MRV 리포트로 낸다.
 */

import { useId, useState } from "react"
import { ApiError, apiFetch, errorMessage, useApiMutation, useApiQuery } from "@/lib/mrv/client"
import { isoDay } from "@/lib/mrv/ui/period"
import { toComparisonViewModel } from "@/lib/mrv/ui/comparison-view-model"
import { formatNumber, INPUT_CLASS, LoadError, PRIMARY_BUTTON } from "@/components/mrv/ui"
import { checkExperiment } from "@/lib/mrv/experiments"
import type { Experiment, ExperimentListResponse, ExperimentResultResponse } from "@/lib/mrv/api-types"

const STATUS_LABEL: Record<Experiment["status"], string> = {
  running: "진행 중",
  concluded: "결론 냄",
  abandoned: "접음",
}

export function ExperimentPanel({ siteId, canWrite }: { siteId: string | null; canWrite: boolean }) {
  const nameId = useId()
  const hypId = useId()
  const cfId = useId()
  const ctId = useId()
  const tfId = useId()
  const ttId = useId()
  const concId = useId()

  const [name, setName] = useState("")
  const [hypothesis, setHypothesis] = useState("")
  const [cf, setCf] = useState("")
  const [ct, setCt] = useState("")
  const [tf, setTf] = useState("")
  const [tt, setTt] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [conclusion, setConclusion] = useState("")

  const list = useApiQuery<ExperimentListResponse>(
    (signal) => apiFetch<ExperimentListResponse>(`/sites/${encodeURIComponent(siteId as string)}/experiments`, { signal }),
    [siteId],
    { enabled: Boolean(siteId) },
  )
  const detail = useApiQuery<ExperimentResultResponse>(
    (signal) =>
      apiFetch<ExperimentResultResponse>(
        `/sites/${encodeURIComponent(siteId as string)}/experiments/${encodeURIComponent(openId as string)}`,
        { signal },
      ),
    [siteId, openId],
    { enabled: Boolean(siteId) && openId !== null },
  )
  const create = useApiMutation(async (body: unknown) =>
    apiFetch(`/sites/${encodeURIComponent(siteId as string)}/experiments`, { method: "POST", json: body }),
  )
  const finish = useApiMutation(async (arg: unknown) => {
    const { id, body } = arg as { id: string; body: unknown }
    return apiFetch(`/sites/${encodeURIComponent(siteId as string)}/experiments/${encodeURIComponent(id)}`, { method: "PATCH", json: body })
  })
  const disabled = !canWrite || !siteId || create.isPending

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (disabled) return
    const toIso = (d: string) => (d ? `${d}T00:00:00.000Z` : "")
    const checked = checkExperiment({
      name, hypothesis, control_from: toIso(cf), control_to: toIso(ct), treatment_from: toIso(tf), treatment_to: toIso(tt),
    })
    if (!checked.ok) return setFieldError(checked.detail)
    setFieldError(null)
    try {
      await create.mutate({
        name: checked.value.name, hypothesis: checked.value.hypothesis,
        control_from: checked.value.control_from.toISOString(), control_to: checked.value.control_to.toISOString(),
        treatment_from: checked.value.treatment_from.toISOString(), treatment_to: checked.value.treatment_to.toISOString(),
      })
      setName(""); setHypothesis("")
      list.refetch()
    } catch { /* create.error 로 표시 */ }
  }

  async function handleFinish(id: string, status: "concluded" | "abandoned") {
    if (finish.isPending) return
    try {
      await finish.mutate({ id, body: { status, conclusion: conclusion.trim() || null } })
      setConclusion("")
      list.refetch()
      detail.refetch()
    } catch { /* finish.error 로 표시 */ }
  }

  const items = list.data?.items ?? []
  const vm = detail.data ? toComparisonViewModel(detail.data.result) : null

  return (
    <section aria-label="비교실험(A/B)" className="flex flex-col gap-4 rounded-xl border border-mrv-border bg-mrv-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-mrv-fg">비교실험 (A/B)</h2>
        <p className="text-xs leading-relaxed text-mrv-muted">
          &ldquo;무엇을 바꿔 보았는가&rdquo; 를 기록으로 남깁니다. 대조군(바꾸기 전)과 처리군(바꾼 뒤) 두 구간을 정하면
          두 구간의 KPI 를 지금 산출해 기준선 비교와 같은 표로 견줍니다. 결과는 저장하지 않고 조회 때마다
          다시 산출합니다 — 발행이 필요하면 MRV 리포트로 내십시오.
        </p>
      </div>

      {list.isLoading && <div role="status" className="h-16 animate-pulse rounded-md border border-mrv-border" aria-label="실험 목록 불러오는 중" />}
      {list.isError && !list.isLoading && (
        <LoadError message="실험 목록을 불러오지 못했습니다. 표가 아직 없다면 mrv_remaining_scope.sql 을 실행하십시오." isUnauthorized={list.error instanceof ApiError && list.error.isUnauthorized} onRetry={list.refetch} />
      )}
      {list.data && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">실험 목록</caption>
            <thead>
              <tr className="border-b border-mrv-border text-xs text-mrv-muted">
                <th scope="col" className="py-2 pr-3 font-medium">이름</th>
                <th scope="col" className="py-2 pr-3 font-medium">대조군</th>
                <th scope="col" className="py-2 pr-3 font-medium">처리군</th>
                <th scope="col" className="py-2 pr-3 font-medium">상태</th>
                <th scope="col" className="py-2 font-medium">결과</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={5} className="py-4 text-mrv-muted">구성한 실험이 없습니다.</td></tr>}
              {items.map((x) => (
                <tr key={x.id} className="border-b border-mrv-border last:border-0">
                  <td className="py-2 pr-3 text-mrv-fg">{x.name}{x.hypothesis && <span className="block text-xs text-mrv-muted">{x.hypothesis}</span>}</td>
                  <td className="py-2 pr-3 text-mrv-muted">{isoDay(x.control_from)} ~ {isoDay(x.control_to)}</td>
                  <td className="py-2 pr-3 text-mrv-muted">{isoDay(x.treatment_from)} ~ {isoDay(x.treatment_to)}</td>
                  <td className="py-2 pr-3 text-mrv-muted">{STATUS_LABEL[x.status]}{x.conclusion && <span className="block text-xs">{x.conclusion}</span>}</td>
                  <td className="py-2">
                    <button type="button" onClick={() => setOpenId(openId === x.id ? null : x.id)} className="rounded-md border border-mrv-border bg-mrv-surface px-2 py-1 text-xs font-medium text-mrv-fg hover:bg-mrv-bg">
                      {openId === x.id ? "닫기" : "결과 보기"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId !== null && (
        <div className="flex flex-col gap-3 rounded-md border border-mrv-border bg-mrv-bg p-3" aria-label="실험 결과">
          {detail.isLoading && <div role="status" className="h-24 animate-pulse rounded-md border border-mrv-border" aria-label="실험 결과 산출 중" />}
          {detail.isError && !detail.isLoading && <LoadError message="실험 결과를 산출하지 못했습니다." isUnauthorized={detail.error instanceof ApiError && detail.error.isUnauthorized} onRetry={detail.refetch} />}
          {vm && detail.data && (
            <>
              <p className="text-sm text-mrv-muted">
                대조군 {isoDay(vm.baselinePeriod.from)} ~ {isoDay(vm.baselinePeriod.to)} · 처리군 {isoDay(vm.currentPeriod.from)} ~ {isoDay(vm.currentPeriod.to)} · 지금 산출한 값
              </p>
              <div className="overflow-x-auto rounded-md border border-mrv-border bg-mrv-surface">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-mrv-border text-mrv-muted">
                      <th className="px-3 py-2 text-left font-medium">지표</th>
                      <th className="px-3 py-2 text-right font-medium">대조군</th>
                      <th className="px-3 py-2 text-right font-medium">처리군</th>
                      <th className="px-3 py-2 text-right font-medium">변화량</th>
                      <th className="px-3 py-2 text-right font-medium">개선율</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.rows.map((row) => (
                      <tr key={row.key} className="border-b border-mrv-border last:border-0">
                        <td className="px-3 py-2 text-mrv-fg">{row.label}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-mrv-fg">{formatNumber(row.baselineValue)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-mrv-fg">{formatNumber(row.currentValue)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-mrv-fg">{formatNumber(row.deltaValue)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-mrv-fg">{row.improvementPct === null ? "산출 불가" : `${formatNumber(row.improvementPct, 1)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {detail.data.status === "running" && canWrite && (
                <div className="flex flex-col gap-2">
                  <label htmlFor={concId} className="text-sm font-medium text-mrv-fg">결론</label>
                  <textarea id={concId} rows={2} value={conclusion} onChange={(e) => setConclusion(e.target.value)} placeholder="무엇을 확인했는지 — 결론 없는 '결론' 은 기록이 아닙니다." className={INPUT_CLASS} />
                  {finish.error !== undefined && <p role="alert" className="text-xs text-mrv-red">{errorMessage(finish.error, "실험을 끝내지 못했습니다.")}</p>}
                  <div className="flex gap-2">
                    <button type="button" disabled={finish.isPending} onClick={() => handleFinish(detail.data!.id, "concluded")} className={PRIMARY_BUTTON}>결론 내고 끝내기</button>
                    <button type="button" disabled={finish.isPending} onClick={() => handleFinish(detail.data!.id, "abandoned")} className="rounded-md border border-mrv-border bg-mrv-surface px-3 py-1.5 text-sm font-medium text-mrv-fg hover:bg-mrv-bg">결론 없이 접기</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <form onSubmit={handleCreate} aria-label="실험 구성 폼" className="flex flex-col gap-3 border-t border-mrv-border pt-4">
        <h3 className="text-sm font-semibold text-mrv-fg">실험 구성</h3>
        {!canWrite && <p role="note" className="rounded-md bg-mrv-na-bg px-3 py-2 text-xs text-mrv-na">읽기 전용 권한(viewer)입니다. 실험 구성은 owner/operator 만 가능합니다.</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor={nameId} className="text-sm font-medium text-mrv-fg">이름 <span className="text-mrv-red">*</span></label>
            <input id={nameId} value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} placeholder="예: 폭기기 인버터 교체" className={INPUT_CLASS} />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label htmlFor={hypId} className="text-sm font-medium text-mrv-fg">가설 (무엇을 바꿨고 무엇을 기대하는가)</label>
            <textarea id={hypId} rows={2} value={hypothesis} disabled={disabled} onChange={(e) => setHypothesis(e.target.value)} className={INPUT_CLASS} />
          </div>
          <div className="flex flex-col gap-1"><label htmlFor={cfId} className="text-sm font-medium text-mrv-fg">대조군 시작 <span className="text-mrv-red">*</span></label><input id={cfId} type="date" value={cf} disabled={disabled} onChange={(e) => setCf(e.target.value)} className={INPUT_CLASS} /></div>
          <div className="flex flex-col gap-1"><label htmlFor={ctId} className="text-sm font-medium text-mrv-fg">대조군 끝 <span className="text-mrv-red">*</span></label><input id={ctId} type="date" value={ct} disabled={disabled} onChange={(e) => setCt(e.target.value)} className={INPUT_CLASS} /></div>
          <div className="flex flex-col gap-1"><label htmlFor={tfId} className="text-sm font-medium text-mrv-fg">처리군 시작 <span className="text-mrv-red">*</span></label><input id={tfId} type="date" value={tf} disabled={disabled} onChange={(e) => setTf(e.target.value)} className={INPUT_CLASS} /></div>
          <div className="flex flex-col gap-1"><label htmlFor={ttId} className="text-sm font-medium text-mrv-fg">처리군 끝 <span className="text-mrv-red">*</span></label><input id={ttId} type="date" value={tt} disabled={disabled} onChange={(e) => setTt(e.target.value)} className={INPUT_CLASS} /></div>
        </div>
        <p className="text-xs text-mrv-muted">두 구간은 겹칠 수 없고 각각 하루 이상이어야 합니다. 구간은 나중에 고칠 수 없습니다 — 잘못 만들었으면 접고 새로 만드십시오.</p>
        {fieldError !== null && <p role="alert" className="text-xs text-mrv-red">{fieldError}</p>}
        {create.error !== undefined && <p role="alert" className="text-xs text-mrv-red">{errorMessage(create.error, "실험을 만들지 못했습니다.")}</p>}
        <button type="submit" disabled={disabled} className={PRIMARY_BUTTON}>{create.isPending ? "만드는 중…" : "실험 만들기"}</button>
      </form>
    </section>
  )
}
