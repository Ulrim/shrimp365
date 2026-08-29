"use client"

/**
 * 전·후(A/B) 비교.
 * 원본: mrv-platform/apps/web/src/features/comparison/ComparisonPage.tsx
 *
 * 잠긴 기준선을 원점으로 두고 지금 기간의 KPI 와 견준다. delta 와 개선율은 서버가 계산한
 * 값을 그대로 쓴다 — 화면에서 다시 계산하면 지표 방향(낮을수록 좋음/높을수록 좋음)을
 * 어긋나게 적용할 위험이 생긴다.
 *
 * PRO 이상 + viewer 제외. 기준선이 없으면 비교 자체가 성립하지 않으므로 그 사실을 알린다.
 */

import { useState } from "react"
import { ApiError, apiFetch, useApiQuery } from "@/lib/mrv/client"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { useMrvSite } from "@/lib/mrv/ui/site"
import { toComparisonViewModel } from "@/lib/mrv/ui/comparison-view-model"
import { isoDay, recentPeriod } from "@/lib/mrv/ui/period"
import {
  CenteredMessage,
  INPUT_CLASS,
  LoadError,
  PageHeader,
  formatNumber,
} from "@/components/mrv/ui"
import type { ComparisonResponse } from "@/lib/mrv/api-types"

function dayToIsoStart(day: string): string {
  return `${day}T00:00:00Z`
}
function dayToIsoEnd(day: string): string {
  return `${day}T23:59:59Z`
}

/** 개선율은 방향이 보정된 값이다 — 양수면 언제나 '좋아졌다'는 뜻이다. */
function improvementTone(pct: number | null): string {
  if (pct === null) return "text-mrv-muted"
  if (pct > 0) return "text-mrv-green"
  if (pct < 0) return "text-mrv-red"
  return "text-mrv-muted"
}

export default function ComparisonPage() {
  const { selectedSiteId, selectedSite } = useMrvSite()
  const { isPro, role, isLoading: sessionLoading } = useMrvSession()

  const initial = recentPeriod(30)
  const [fromDay, setFromDay] = useState(isoDay(initial.from))
  const [toDay, setToDay] = useState(isoDay(initial.to))
  const [applied, setApplied] = useState<{ from: string; to: string }>({
    from: initial.from,
    to: initial.to,
  })

  const query = useApiQuery<ComparisonResponse>(
    (signal) =>
      apiFetch<ComparisonResponse>(
        `/sites/${encodeURIComponent(selectedSiteId as string)}/comparison`,
        { query: { compare_from: applied.from, compare_to: applied.to }, signal },
      ),
    [selectedSiteId, applied.from, applied.to],
    { enabled: Boolean(selectedSiteId) && isPro && role !== "viewer" },
  )

  const header = (
    <PageHeader
      title="전 · 후 비교"
      description={`${selectedSite?.name ?? "사이트"} · 잠긴 기준선(Before) 대비 현재 기간(After)`}
    />
  )

  if (sessionLoading) return null

  if (!isPro) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
        {header}
        <CenteredMessage>
          전·후 비교는 PRO 이상 요금제에서 이용할 수 있습니다.
        </CenteredMessage>
      </div>
    )
  }

  if (role === "viewer") {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
        {header}
        <CenteredMessage>
          읽기 전용 권한(viewer)으로는 전·후 비교를 볼 수 없습니다.
        </CenteredMessage>
      </div>
    )
  }

  const noBaseline = query.error instanceof ApiError && query.error.status === 404
  const isUnauthorized = query.error instanceof ApiError && query.error.isUnauthorized
  const vm = query.data ? toComparisonViewModel(query.data) : null

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      {header}

      <section className="flex flex-wrap items-end gap-3 rounded-xl border border-mrv-border bg-mrv-surface p-4">
        <label className="flex flex-col gap-1 text-sm text-mrv-fg">
          비교 시작일
          <input
            type="date"
            value={fromDay}
            onChange={(e) => setFromDay(e.target.value)}
            className={`${INPUT_CLASS} py-2`}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-mrv-fg">
          비교 종료일
          <input
            type="date"
            value={toDay}
            onChange={(e) => setToDay(e.target.value)}
            className={`${INPUT_CLASS} py-2`}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            setApplied({ from: dayToIsoStart(fromDay), to: dayToIsoEnd(toDay) })
          }
          className="rounded-md border border-mrv-primary px-4 py-2 text-sm font-medium text-mrv-primary hover:bg-mrv-bg"
        >
          비교하기
        </button>
      </section>

      {query.isLoading && (
        <div
          role="status"
          aria-label="비교 결과 불러오는 중"
          className="h-48 animate-pulse rounded-xl border border-mrv-border bg-mrv-surface"
        />
      )}

      {noBaseline && (
        <CenteredMessage>
          잠긴 기준선이 없어 비교할 수 없습니다. 먼저 기준선을 잠가 주세요.
        </CenteredMessage>
      )}

      {query.isError && !noBaseline && !query.isLoading && (
        <LoadError
          message="비교 결과를 불러오지 못했습니다."
          isUnauthorized={isUnauthorized}
          onRetry={query.refetch}
        />
      )}

      {vm && (
        <section className="flex flex-col gap-3" aria-label="비교 결과">
          <p className="text-sm text-mrv-muted">
            기준선 {isoDay(vm.baselinePeriod.from)} ~ {isoDay(vm.baselinePeriod.to)}
            {" · "}현재 {isoDay(vm.currentPeriod.from)} ~ {isoDay(vm.currentPeriod.to)}
            {" · "}산식 버전 {vm.baselineConfigVersion} → {vm.currentConfigVersion}
          </p>

          <div className="overflow-x-auto rounded-xl border border-mrv-border bg-mrv-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-mrv-border bg-mrv-bg text-mrv-muted">
                  <th className="px-4 py-2 text-left font-medium">지표</th>
                  <th className="px-4 py-2 text-right font-medium">기준선(Before)</th>
                  <th className="px-4 py-2 text-right font-medium">현재(After)</th>
                  <th className="px-4 py-2 text-right font-medium">변화량</th>
                  <th className="px-4 py-2 text-right font-medium">개선율</th>
                </tr>
              </thead>
              <tbody>
                {vm.rows.map((row) => (
                  <tr key={row.key} className="border-b border-mrv-border last:border-0">
                    <td className="px-4 py-2 text-mrv-fg">
                      {row.label}
                      <span className="ml-1 text-xs text-mrv-muted">
                        ({row.direction === "lower_is_better" ? "낮을수록 좋음" : "높을수록 좋음"})
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-mrv-fg">
                      {formatNumber(row.baselineValue)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-mrv-fg">
                      {formatNumber(row.currentValue)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-mrv-muted">
                      {formatNumber(row.deltaValue)}
                    </td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums font-medium ${improvementTone(row.improvementPct)}`}
                    >
                      {row.improvementPct === null
                        ? "산출 불가"
                        : `${row.improvementPct > 0 ? "+" : ""}${row.improvementPct.toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-mrv-muted">
            개선율은 지표 방향을 보정한 값입니다 — 양수면 기준선보다 나아졌다는 뜻입니다.
            근거 추적: 기준선 {query.data?.provenance.baseline_id}
          </p>
        </section>
      )}
    </div>
  )
}
