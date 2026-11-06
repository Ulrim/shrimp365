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
 *
 * ★ 이 표의 OEI 열은 **사업장끼리의 순위로 읽힌다**(최고/최저 배지가 붙는다). 그런데 OEI 는
 *   산식이 사업계획서에 없는 제안값이고 분자가 사업장마다 다른 DO 목표대역의 유지율이다 —
 *   그 사실은 `lib/mrv/metric-provenance.ts` 에 있고 이 화면은 거기서 가져다 적는다.
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
  KPI_THRESHOLD_ASSUMPTION_NOTE,
  OEI_CROSS_SITE_RANKING_NOTE,
  PROVISIONAL_METRIC_MARK,
  PROVISIONAL_METRIC_KEYS,
  isProvisionalMetric,
  provisionalMetricShortNote,
} from "@/lib/mrv/metric-provenance"
import {
  UNAVAILABILITY_EVIDENCE_MISSING_TEXT,
  UNAVAILABILITY_REASON_KIND_PREFIX,
  unavailabilityVsProvisionalNote,
} from "@/lib/mrv/metric-unavailability"
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

  /**
   * 빈 칸이 있는 사업장과 그 지표. 표와 **같은 정렬**로 돌려 아래 사유 목록의 순서가
   * 표의 행 순서와 어긋나지 않게 한다.
   */
  const naSites = sorted
    .map((row) => ({
      row,
      keys: BENCHMARK_METRIC_META.map((m) => m.key).filter(
        (key) => row.metrics[key] === null,
      ),
    }))
    .filter((entry) => entry.keys.length > 0)

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
                      {/* 열 제목에 글자로 적는다. 아래 설명 문단만 두면 표를 가로로
                          스크롤해 OEI 열만 보고 있는 사람에게는 아무 표시도 없다. */}
                      {isProvisionalMetric(meta.key) && (
                        <span className="mt-0.5 block rounded border border-mrv-amber bg-mrv-amber-bg px-1 py-0.5 text-[10px] font-medium text-mrv-fg">
                          {PROVISIONAL_METRIC_MARK}
                        </span>
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
                        {/* 빈 칸에는 "사유는 아래에 있다" 를 글자로 적는다. 표 아래
                            문단만 두면 가로로 스크롤해 그 열만 보고 있는 사람에게는
                            아무 표시도 없다. */}
                        {row.metrics[meta.key] === null && (
                          <span className="block text-[11px] text-mrv-fg">사유 아래</span>
                        )}
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

      {/* 왜 산출되지 않았는가 — **사업장별로** 적는다. 같은 '산출 불가' 칸이 사업장마다
          다른 이유다(한 곳은 DO 목표대역이 없고, 다른 곳은 생산량 기록이 없다). 한 문단으로
          뭉개면 어느 사업장 이야기인지 알 수 없다.

          사유는 서버가 내려 준 것을 그대로 쓴다 — 이 화면이 지어내면 개요 화면의 KPI
          카드와 다른 말을 하게 된다. 12px 본문이라 상자 안은 전부 text-mrv-fg. */}
      {naSites.length > 0 && (
        <section
          aria-label="산출 불가 사유"
          className="flex flex-col gap-4 rounded-xl border border-mrv-border bg-mrv-surface p-4 text-xs leading-relaxed text-mrv-fg"
        >
          <h3 className="text-sm font-semibold text-mrv-fg">산출 불가 사유 (사업장별)</h3>
          {naSites.map(({ row, keys }) => (
            <div key={row.site_id} className="flex flex-col gap-2">
              <p className="font-semibold">
                {row.site_name} · 산식 {row.config_version}
              </p>
              {keys.map((key) => {
                const reasons = row.unavailability?.metrics[key]?.reasons
                const layerNote = unavailabilityVsProvisionalNote(key)
                return (
                  <div key={key} className="flex flex-col gap-1">
                    <p className="font-medium">
                      {BENCHMARK_METRIC_META.find((m) => m.key === key)?.label ?? key}
                    </p>
                    {reasons === undefined ? (
                      <p>{UNAVAILABILITY_EVIDENCE_MISSING_TEXT}</p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {reasons.map((reason) => (
                          <li key={reason.id}>
                            <span>
                              {UNAVAILABILITY_REASON_KIND_PREFIX[reason.kind]}
                              {reason.text}
                            </span>
                            {reason.action !== null && (
                              <span className="mt-0.5 block">할 일 — {reason.action}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {layerNote !== null && <p>{layerNote}</p>}
                  </div>
                )
              })}
            </div>
          ))}
        </section>
      )}

      {/* 잠정 지표가 이 표에 섞여 있다는 사실. 표가 비어 있어도 적는다 — 열은 그대로
          떠 있고, 사업장을 추가하면 곧 숫자가 들어온다.
          12px 본문이라 AA 기준이 4.5:1 이므로 틴트 배경에는 text-mrv-fg 를 쓴다. */}
      {PROVISIONAL_METRIC_KEYS.length > 0 && (
        <div
          role="note"
          className="flex flex-col gap-2 rounded-xl border border-mrv-amber bg-mrv-amber-bg p-4 text-xs leading-relaxed text-mrv-fg"
        >
          {PROVISIONAL_METRIC_KEYS.map((key) => (
            <p key={key}>{provisionalMetricShortNote(key)}</p>
          ))}
          {/* 사업장 간 비교 자체에 대한 사실이므로 OEI 열이 있을 때만 적는다. */}
          {isProvisionalMetric("oei") && <p>{OEI_CROSS_SITE_RANKING_NOTE}</p>}
          <p>{KPI_THRESHOLD_ASSUMPTION_NOTE}</p>
        </div>
      )}
    </div>
  )
}
