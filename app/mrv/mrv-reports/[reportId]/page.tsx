"use client"

/**
 * MRV 리포트 상세.
 * 원본: mrv-platform/apps/web/src/features/mrv/MrvReportViewPage.tsx
 *       + SnapshotDrilldownDialog.tsx
 *
 * 이 화면이 곧 증빙이다. 그래서 값만이 아니라 산식 전문·측정경계·가정·근거 참조를 모두
 * 드러내고, 숫자에서 근거 스냅샷으로 내려갈 수 있게 한다 — 리포트의 모든 수치는 원천
 * 계측값까지 역추적 가능해야 한다는 요구가 이 배치의 이유다.
 */

import { use, useState } from "react"
import { ApiError, apiFetch, useApiQuery } from "@/lib/mrv/client"
import { formatIsoLocal } from "@/lib/mrv/ui/datetime"
import { isoDay } from "@/lib/mrv/ui/period"
import { MRV_METRIC_ROWS, formatMrvNumber } from "@/lib/mrv/ui/mrv-meta"
import {
  CenteredMessage,
  LoadError,
  PageHeader,
  SECONDARY_BUTTON,
  formatNumber,
} from "@/components/mrv/ui"
import type { KpiSnapshotDetail, MrvReportResponse } from "@/lib/mrv/api-types"

/** 근거 스냅샷 드릴다운. 저장된 inputs/provenance 를 있는 그대로 펼쳐 보여 준다. */
function SnapshotDrilldown({
  snapshotId,
  onClose,
}: {
  snapshotId: string
  onClose: () => void
}) {
  const query = useApiQuery<KpiSnapshotDetail>(
    (signal) =>
      apiFetch<KpiSnapshotDetail>(
        `/kpi-snapshots/${encodeURIComponent(snapshotId)}`,
        { signal },
      ),
    [snapshotId],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="KPI 스냅샷 근거"
        className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-3 overflow-auto rounded-xl border border-mrv-border bg-mrv-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-bold text-mrv-fg">KPI 스냅샷 근거</h2>
          <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
            닫기
          </button>
        </div>
        <p className="break-all text-xs text-mrv-muted">{snapshotId}</p>

        {query.isLoading && (
          <div role="status" className="h-24 animate-pulse rounded-md bg-mrv-bg" />
        )}
        {query.isError && (
          <p role="alert" className="text-sm text-mrv-red">
            스냅샷을 불러오지 못했습니다.
          </p>
        )}
        {query.data && (
          <>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-mrv-muted">기간</dt>
                <dd className="text-mrv-fg">
                  {isoDay(query.data.period.from)} ~ {isoDay(query.data.period.to)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mrv-muted">산식 버전</dt>
                <dd className="text-mrv-fg">{query.data.config_version}</dd>
              </div>
            </dl>
            <section>
              <h3 className="mb-1 text-sm font-semibold text-mrv-fg">산출 근거(inputs)</h3>
              <pre className="overflow-auto rounded-md bg-mrv-bg p-3 text-[11px] leading-relaxed text-mrv-fg">
                {JSON.stringify(query.data.inputs_json, null, 2)}
              </pre>
            </section>
            <section>
              <h3 className="mb-1 text-sm font-semibold text-mrv-fg">
                근거 참조(provenance)
              </h3>
              <pre className="overflow-auto rounded-md bg-mrv-bg p-3 text-[11px] leading-relaxed text-mrv-fg">
                {JSON.stringify(query.data.provenance_json, null, 2)}
              </pre>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

export default function MrvReportViewPage({
  params,
}: {
  params: Promise<{ reportId: string }>
}) {
  const { reportId } = use(params)
  const [drilldownId, setDrilldownId] = useState<string | null>(null)

  const query = useApiQuery<MrvReportResponse>(
    (signal) =>
      apiFetch<MrvReportResponse>(`/mrv-reports/${encodeURIComponent(reportId)}`, {
        signal,
      }),
    [reportId],
  )

  const isUnauthorized = query.error instanceof ApiError && query.error.isUnauthorized
  const report = query.data

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <PageHeader
        title="MRV 리포트"
        description={report ? `리포트 ID ${report.id}` : undefined}
        actions={
          report && (
            <a
              href={`/api/mrv/mrv-reports/${encodeURIComponent(report.id)}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className={SECONDARY_BUTTON}
            >
              인쇄용 문서 열기
            </a>
          )
        }
      />

      {query.isLoading && (
        <div
          role="status"
          aria-label="리포트 불러오는 중"
          className="h-64 animate-pulse rounded-xl border border-mrv-border bg-mrv-surface"
        />
      )}

      {query.isError && !query.isLoading && (
        <LoadError
          message="리포트를 불러오지 못했습니다."
          isUnauthorized={isUnauthorized}
          onRetry={query.refetch}
        />
      )}

      {!query.isLoading && !query.isError && !report && (
        <CenteredMessage>리포트를 찾을 수 없습니다.</CenteredMessage>
      )}

      {report && (
        <>
          <section
            className="rounded-xl border border-mrv-green bg-mrv-green-bg p-5"
            aria-label="감축량"
          >
            <p className="text-sm text-mrv-fg">감축량 (Scope2 Reduction)</p>
            <p className="text-3xl font-bold text-mrv-green">
              {report.reduction_tco2e === null
                ? "산출 불가"
                : `${formatNumber(report.reduction_tco2e, 4)} tCO2e`}
            </p>
            <p className="mt-1 text-xs text-mrv-muted">
              적용 배출계수 {report.emission_factor.version} ·{" "}
              {report.emission_factor.source} · {report.emission_factor.year}년
            </p>
          </section>

          <section aria-label="Before / After 비교표" className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-mrv-fg">
              1. Before / After 비교
            </h2>
            <div className="overflow-x-auto rounded-xl border border-mrv-border bg-mrv-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-mrv-border bg-mrv-bg text-mrv-muted">
                    <th className="px-4 py-2 text-left font-medium">지표</th>
                    <th className="px-4 py-2 text-right font-medium">Before(기준선)</th>
                    <th className="px-4 py-2 text-right font-medium">After(현재)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-mrv-border">
                    <td className="px-4 py-2 text-mrv-fg">기간</td>
                    <td className="px-4 py-2 text-right text-mrv-fg">
                      {isoDay(report.before.period.from)} ~ {isoDay(report.before.period.to)}
                    </td>
                    <td className="px-4 py-2 text-right text-mrv-fg">
                      {isoDay(report.after.period.from)} ~ {isoDay(report.after.period.to)}
                    </td>
                  </tr>
                  <tr className="border-b border-mrv-border">
                    <td className="px-4 py-2 text-mrv-fg">산식 버전</td>
                    <td className="px-4 py-2 text-right text-mrv-fg">
                      {report.before.config_version}
                    </td>
                    <td className="px-4 py-2 text-right text-mrv-fg">
                      {report.after.config_version}
                    </td>
                  </tr>
                  {MRV_METRIC_ROWS.map((row) => (
                    <tr key={row.key} className="border-b border-mrv-border last:border-0">
                      <td className="px-4 py-2 text-mrv-fg">
                        {row.label}
                        <span className="ml-1 text-xs text-mrv-muted">({row.unit})</span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-mrv-fg">
                        {formatMrvNumber(row.getValue(report.before), 4)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-mrv-fg">
                        {formatMrvNumber(row.getValue(report.after), 4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-label="측정경계와 가정" className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-mrv-fg">
              2. 측정경계(Boundary) · 가정(Assumptions)
            </h2>
            <dl className="grid grid-cols-1 gap-3 rounded-xl border border-mrv-border bg-mrv-surface p-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-mrv-muted">사이트</dt>
                <dd className="text-mrv-fg">
                  {report.boundary.site_name} ({report.boundary.site_id})
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mrv-muted">포함 계측기</dt>
                <dd className="break-all text-mrv-fg">
                  {report.boundary.included_meter_ids.join(", ") || "-"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mrv-muted">포함 품질 플래그</dt>
                <dd className="text-mrv-fg">
                  {report.boundary.included_quality_flags.join(", ") || "-"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mrv-muted">생산량 근거(Before / After)</dt>
                <dd className="break-all text-mrv-fg">
                  {(report.boundary.biomass_source_refs.before ?? []).join(", ") || "-"}
                  {" / "}
                  {(report.boundary.biomass_source_refs.after ?? []).join(", ") || "-"}
                </dd>
              </div>
            </dl>
            <ul className="list-disc pl-5 text-sm text-mrv-muted">
              {report.boundary.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </section>

          <section aria-label="산식 전문" className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-mrv-fg">3. 산식 전문 (재현 가능)</h2>
            <pre className="whitespace-pre-line rounded-xl border border-mrv-border bg-mrv-surface p-4 text-sm leading-relaxed text-mrv-fg">
              {report.formula_text}
            </pre>
          </section>

          <section aria-label="근거 참조" className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-mrv-fg">
              4. 적용 로직 · 버전 · 근거 참조
            </h2>
            <div className="flex flex-col gap-2 rounded-xl border border-mrv-border bg-mrv-surface p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-mrv-muted">기준선 ID</span>
                <span className="break-all text-mrv-fg">{report.baseline_id}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-mrv-muted">Before 스냅샷</span>
                {report.before.kpi_snapshot_id ? (
                  <button
                    type="button"
                    onClick={() => setDrilldownId(report.before.kpi_snapshot_id!)}
                    className="break-all text-mrv-primary hover:underline"
                  >
                    {report.before.kpi_snapshot_id}
                  </button>
                ) : (
                  <span className="text-mrv-muted">-</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-mrv-muted">After 스냅샷</span>
                {report.after.kpi_snapshot_id ? (
                  <button
                    type="button"
                    onClick={() => setDrilldownId(report.after.kpi_snapshot_id!)}
                    className="break-all text-mrv-primary hover:underline"
                  >
                    {report.after.kpi_snapshot_id}
                  </button>
                ) : (
                  <span className="text-mrv-muted">-</span>
                )}
              </div>
              <p className="text-xs text-mrv-muted">
                생성 {report.generated_by} · {formatIsoLocal(report.generated_at)}
              </p>
            </div>
          </section>
        </>
      )}

      {drilldownId && (
        <SnapshotDrilldown
          snapshotId={drilldownId}
          onClose={() => setDrilldownId(null)}
        />
      )}
    </div>
  )
}
