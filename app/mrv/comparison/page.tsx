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
  OEI_HOW_TO_READ,
  OEI_SCALE_FACTOR_NOTE,
  PROVISIONAL_METRIC_KEYS,
  PROVISIONAL_METRIC_MARK,
  isProvisionalMetric,
  provisionalMetricShortNote,
} from "@/lib/mrv/metric-provenance"
import {
  UNAVAILABILITY_EVIDENCE_MISSING_TEXT,
  UNAVAILABILITY_LOOKUP_LOCKED_BASELINE,
  UNAVAILABILITY_REASON_KIND_PREFIX,
  comparisonImprovementUnavailabilityText,
  unavailabilityVsProvisionalNote,
} from "@/lib/mrv/metric-unavailability"
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
  /**
   * 빈 칸을 모아 둔다. 세 가지가 서로 다른 사유를 갖는다 — 기준선 값, 현재 값, 그리고
   * 개선율(두 값이 다 있어도 기준선이 0 이하면 개선율만 빈다 · lib/mrv/kpi/comparison.ts).
   * 종전에는 셋을 같은 "산출 불가" 한 낱말로 적고 끝냈다.
   */
  const naRows = {
    baseline: vm?.rows.filter((r) => r.baselineValue === null) ?? [],
    current: vm?.rows.filter((r) => r.currentValue === null) ?? [],
    improvement: vm?.rows.filter((r) => r.improvementPct === null) ?? [],
  }

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
                      {/* 이 표의 OEI 행은 개선율까지 적는다 — 그 숫자가 무엇의 변화인지
                          행 자리에서 글자로 밝힌다(설명은 표 아래 문단). */}
                      {isProvisionalMetric(row.key) && (
                        <span className="ml-1 rounded border border-mrv-amber bg-mrv-amber-bg px-1 py-0.5 text-[11px] font-medium text-mrv-fg">
                          {PROVISIONAL_METRIC_MARK}
                        </span>
                      )}
                    </td>
                    {/* 빈 칸에는 "사유는 아래에 있다" 를 **글자로** 적는다. 표 아래
                        문단만 두면 가로로 스크롤해 그 칸만 보고 있는 사람에게는 아무
                        표시도 없다(잠정 지표 배지를 열 제목에 적는 것과 같은 이유). */}
                    <td className="px-4 py-2 text-right tabular-nums text-mrv-fg">
                      {formatNumber(row.baselineValue)}
                      {row.baselineValue === null && (
                        <span className="block text-[11px] font-normal">사유 아래</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-mrv-fg">
                      {formatNumber(row.currentValue)}
                      {row.currentValue === null && (
                        <span className="block text-[11px] font-normal">사유 아래</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-mrv-fg">
                      {formatNumber(row.deltaValue)}
                    </td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums font-medium ${improvementTone(row.improvementPct)}`}
                    >
                      {row.improvementPct === null
                        ? "산출 불가"
                        : `${row.improvementPct > 0 ? "+" : ""}${row.improvementPct.toFixed(1)}%`}
                      {row.improvementPct === null && (
                        <span className="block text-[11px] font-normal text-mrv-fg">
                          사유 아래
                        </span>
                      )}
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

          {/* 왜 산출되지 않았는가. 표 안에서는 자리가 없으므로 바로 아래에 지표별로
              적는다 — 사유는 지표마다 다르고 여러 개가 겹칠 수 있다.

              현재(After)의 사유는 **서버가 내려 준 것**을 그대로 쓴다. 기준선(Before)은
              잠긴 스냅샷의 스칼라값이라 근거 수치가 이 응답에 없으므로, 추측하지 않고
              어디에 적혀 있는지를 적는다.

              12px 본문이라 AA 기준이 4.5:1 이다 — 이 상자 안은 전부 text-mrv-fg. */}
          {(naRows.current.length > 0 ||
            naRows.baseline.length > 0 ||
            naRows.improvement.length > 0) && (
            <section
              aria-label="산출 불가 사유"
              className="flex flex-col gap-3 rounded-xl border border-mrv-border bg-mrv-surface p-4 text-xs leading-relaxed text-mrv-fg"
            >
              <h3 className="text-sm font-semibold text-mrv-fg">산출 불가 사유</h3>

              {naRows.current.map((row) => (
                <div key={`cur-${row.key}`} className="flex flex-col gap-1">
                  <p className="font-semibold">현재(After) · {row.label}</p>
                  {row.currentUnavailability === undefined ? (
                    <p>{UNAVAILABILITY_EVIDENCE_MISSING_TEXT}</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {row.currentUnavailability.map((reason) => (
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
                  {/* 산식 미확정은 이 기간의 산출 불가와 다른 층이다. */}
                  {unavailabilityVsProvisionalNote(row.key) !== null && (
                    <p>{unavailabilityVsProvisionalNote(row.key)}</p>
                  )}
                </div>
              ))}

              {naRows.baseline.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="font-semibold">
                    기준선(Before) · {naRows.baseline.map((r) => r.label).join(" · ")}
                  </p>
                  <p>{UNAVAILABILITY_LOOKUP_LOCKED_BASELINE}</p>
                </div>
              )}

              {naRows.improvement.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="font-semibold">개선율</p>
                  <ul className="flex flex-col gap-1.5">
                    {naRows.improvement.map((row) => (
                      <li key={`imp-${row.key}`}>
                        {row.label} — {comparisonImprovementUnavailabilityText(row)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* 잠정 지표의 개선율은 "무엇의 변화인가" 가 다르다. 이 화면은 두 기간의 산식
              version 을 위에 적어 두므로, 그 둘이 다를 때 OEI 의 변화가 스케일 보정까지
              섞은 값이라는 사실이 특히 중요하다. 문구는 한 곳에서 가져온다. */}
          {PROVISIONAL_METRIC_KEYS.length > 0 && (
            <div
              role="note"
              className="flex flex-col gap-2 rounded-xl border border-mrv-amber bg-mrv-amber-bg p-4 text-xs leading-relaxed text-mrv-fg"
            >
              {PROVISIONAL_METRIC_KEYS.map((key) => (
                <p key={key}>{provisionalMetricShortNote(key)}</p>
              ))}
              {isProvisionalMetric("oei") && (
                <>
                  <p>{OEI_HOW_TO_READ}</p>
                  <p>{OEI_SCALE_FACTOR_NOTE}</p>
                </>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
