"use client"

/**
 * MRV 리포트 이력.
 * 원본: mrv-platform/apps/web/src/features/mrv/MrvReportListPage.tsx
 *
 * 리포트는 append-only 다 — 수정 경로가 없고, 다시 만들면 새 리포트가 발급된다.
 * 그래서 목록은 시간순 이력이며, 각 행이 그 시점의 증빙 하나에 대응한다.
 */

import Link from "next/link"
import { ApiError, apiFetch, useApiQuery } from "@/lib/mrv/client"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { useMrvSite } from "@/lib/mrv/ui/site"
import { formatIsoLocal } from "@/lib/mrv/ui/datetime"
import { isoDay } from "@/lib/mrv/ui/period"
import {
  CenteredMessage,
  LoadError,
  PRIMARY_BUTTON,
  PageHeader,
  formatNumber,
} from "@/components/mrv/ui"
import type { MrvReportListResponse } from "@/lib/mrv/api-types"

export default function MrvReportListPage() {
  const { selectedSiteId, selectedSite } = useMrvSite()
  const { isPro, isLoading: sessionLoading } = useMrvSession()

  const query = useApiQuery<MrvReportListResponse>(
    (signal) =>
      apiFetch<MrvReportListResponse>(
        `/sites/${encodeURIComponent(selectedSiteId as string)}/mrv-reports`,
        { signal },
      ),
    [selectedSiteId],
    { enabled: Boolean(selectedSiteId) && isPro },
  )

  const header = (
    <PageHeader
      title="MRV 리포트"
      description={`${selectedSite?.name ?? "사이트"} · Scope2 탄소저감 성과 증빙`}
      actions={
        isPro ? (
          <Link href="/mrv/mrv-reports/new" className={PRIMARY_BUTTON}>
            리포트 생성
          </Link>
        ) : undefined
      }
    />
  )

  if (sessionLoading) return null

  if (!isPro) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
        {header}
        <CenteredMessage>MRV 리포트는 PRO 이상 요금제에서 이용할 수 있습니다.</CenteredMessage>
      </div>
    )
  }

  const isUnauthorized = query.error instanceof ApiError && query.error.isUnauthorized
  const items = query.data?.items ?? []

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      {header}

      {query.isLoading && (
        <div
          role="status"
          aria-label="리포트 목록 불러오는 중"
          className="h-40 animate-pulse rounded-xl border border-mrv-border bg-mrv-surface"
        />
      )}

      {query.isError && !query.isLoading && (
        <LoadError
          message="리포트 목록을 불러오지 못했습니다."
          isUnauthorized={isUnauthorized}
          onRetry={query.refetch}
        />
      )}

      {!query.isLoading && !query.isError && items.length === 0 && (
        <CenteredMessage>
          아직 생성된 리포트가 없습니다. 기준선을 잠근 뒤 리포트를 생성하세요.
        </CenteredMessage>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-mrv-border bg-mrv-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mrv-border bg-mrv-bg text-mrv-muted">
                <th className="px-4 py-2 text-left font-medium">대상 기간(After)</th>
                <th className="px-4 py-2 text-right font-medium">감축량 (tCO2e)</th>
                <th className="px-4 py-2 text-left font-medium">생성</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-mrv-border last:border-0">
                  <td className="px-4 py-2 text-mrv-fg">
                    {isoDay(r.period.from)} ~ {isoDay(r.period.to)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium text-mrv-fg">
                    {formatNumber(r.reduction_tco2e, 4)}
                  </td>
                  <td className="px-4 py-2 text-mrv-muted">
                    {r.generated_by} · {formatIsoLocal(r.generated_at)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/mrv/mrv-reports/${encodeURIComponent(r.id)}`}
                      className="text-mrv-primary hover:underline"
                    >
                      상세 보기
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
