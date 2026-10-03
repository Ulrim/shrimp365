"use client"

/**
 * 멀티사이트 KPI 벤치마크 (ENTERPRISE).
 * 원본: mrv-platform/apps/web/src/features/multisite/MultisiteBenchmarkPage.tsx
 *
 * 조직의 모든 사이트를 같은 기간·같은 산식으로 나란히 놓는다. 서버가 사이트마다 기존 KPI
 * 산출을 반복 호출할 뿐 벤치마크 전용 계산은 없다 — 그랬다면 이 표의 값과 각 사이트 개요
 * 화면의 값이 갈렸을 것이다.
 *
 * 최고/최저 표시는 지표 방향을 보정한 결과다(OEI 만 높을수록 좋다).
 */

import { useState } from "react"
import { ApiError, apiFetch, useApiQuery } from "@/lib/mrv/client"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { isoDay, recentPeriod } from "@/lib/mrv/ui/period"
import {
  BENCHMARK_METRIC_META,
  findBestWorst,
  formatBenchmarkNumber,
  sortBenchmarkRows,
  type BenchmarkSortDirection,
  type SiteBenchmarkMetricKey,
} from "@/lib/mrv/ui/multisite-meta"
import {
  Badge,
  CenteredMessage,
  INPUT_CLASS,
  LoadError,
  PageHeader,
} from "@/components/mrv/ui"
import type { SiteKpiBenchmark } from "@/lib/mrv/api-types"

export default function MultisiteBenchmarkPage() {
  const { isEnterprise, isLoading: sessionLoading } = useMrvSession()

  const initial = recentPeriod(30)
  const [fromDay, setFromDay] = useState(isoDay(initial.from))
  const [toDay, setToDay] = useState(isoDay(initial.to))
  const [applied, setApplied] = useState({ from: initial.from, to: initial.to })
  const [sortKey, setSortKey] = useState<SiteBenchmarkMetricKey>("ei_total")
  const [sortDir, setSortDir] = useState<BenchmarkSortDirection>("asc")

  const query = useApiQuery<SiteKpiBenchmark>(
    (signal) =>
      apiFetch<SiteKpiBenchmark>("/sites/kpi-benchmark", {
        query: { from: applied.from, to: applied.to },
        signal,
      }),
    [applied.from, applied.to],
    { enabled: isEnterprise },
  )

  const header = (
    <PageHeader
      title="멀티사이트 벤치마크"
      description="조직의 모든 사이트를 같은 기간·같은 산식으로 비교합니다"
    />
  )

  if (sessionLoading) return null

  if (!isEnterprise) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
        {header}
        <CenteredMessage>
          멀티사이트 벤치마크는 ENTERPRISE 요금제에서 이용할 수 있습니다.
        </CenteredMessage>
      </div>
    )
  }

  const isUnauthorized = query.error instanceof ApiError && query.error.isUnauthorized
  const rows = query.data?.sites ?? []
  const sorted = sortBenchmarkRows(rows, sortKey, sortDir)

  function toggleSort(key: SiteBenchmarkMetricKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      {header}

      <section className="flex flex-wrap items-end gap-3 rounded-xl border border-mrv-border bg-mrv-surface p-4">
        <label className="flex flex-col gap-1 text-sm text-mrv-fg">
          시작일
          <input
            type="date"
            value={fromDay}
            onChange={(e) => setFromDay(e.target.value)}
            className={`${INPUT_CLASS} py-2`}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-mrv-fg">
          종료일
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
            setApplied({ from: `${fromDay}T00:00:00Z`, to: `${toDay}T23:59:59Z` })
          }
          className="rounded-md border border-mrv-primary px-4 py-2 text-sm font-medium text-mrv-primary hover:bg-mrv-bg"
        >
          조회
        </button>
      </section>

      {query.isLoading && (
        <div
          role="status"
          aria-label="벤치마크 불러오는 중"
          className="h-48 animate-pulse rounded-xl border border-mrv-border bg-mrv-surface"
        />
      )}

      {query.isError && !query.isLoading && (
        <LoadError
          message="벤치마크를 불러오지 못했습니다."
          isUnauthorized={isUnauthorized}
          onRetry={query.refetch}
        />
      )}

      {!query.isLoading && !query.isError && rows.length === 0 && (
        <CenteredMessage>비교할 사이트가 없습니다.</CenteredMessage>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-mrv-border bg-mrv-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mrv-border bg-mrv-bg text-mrv-muted">
                <th className="px-4 py-2 text-left font-medium">사이트</th>
                {BENCHMARK_METRIC_META.map((meta) => (
                  <th key={meta.key} className="px-4 py-2 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort(meta.key)}
                      className="hover:text-mrv-fg"
                      aria-label={`${meta.label} 기준 정렬`}
                    >
                      {meta.label}
                      <span className="ml-1 text-[10px]">({meta.unit})</span>
                      {sortKey === meta.key && (
                        <span aria-hidden="true">{sortDir === "asc" ? " ▲" : " ▼"}</span>
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.site_id} className="border-b border-mrv-border last:border-0">
                  <td className="px-4 py-2 text-mrv-fg">
                    {row.site_name}
                    <div className="text-[11px] text-mrv-muted">
                      산식 {row.config_version}
                    </div>
                  </td>
                  {BENCHMARK_METRIC_META.map((meta) => {
                    const { bestSiteId, worstSiteId } = findBestWorst(
                      rows,
                      meta.key,
                      meta.betterWhen,
                    )
                    const isBest = row.site_id === bestSiteId
                    const isWorst = row.site_id === worstSiteId && bestSiteId !== worstSiteId
                    return (
                      <td key={meta.key} className="px-4 py-2 text-right tabular-nums">
                        <span className="text-mrv-fg">
                          {formatBenchmarkNumber(row.metrics[meta.key])}
                        </span>
                        {isBest && (
                          <Badge className="ml-1 bg-mrv-green-bg text-mrv-green">최고</Badge>
                        )}
                        {isWorst && (
                          <Badge className="ml-1 bg-mrv-red-bg text-mrv-red">최저</Badge>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {query.data && (
        <p className="text-xs text-mrv-muted">
          기간 {isoDay(query.data.period.from)} ~ {isoDay(query.data.period.to)} · 최고/최저는
          지표 방향(OEI 만 높을수록 좋음)을 보정해 표시합니다.
        </p>
      )}
    </div>
  )
}
