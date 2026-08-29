"use client"

/**
 * 사이트 개요 — 통합 대시보드 첫 화면.
 * 원본: mrv-platform/apps/web/src/features/dashboard/OverviewPage.tsx
 *
 * 5종 KPI 카드(EI 총/폭기 · FCR · OEI · 폐사율)와 전력 시계열을 함께 보여 준다.
 * 지표 방향(낮을수록 좋음/높을수록 좋음)은 METRIC_META 한 곳에서 온다.
 *
 * 절대 규칙: metrics 값은 서버 결과를 그대로 표시한다(화면에서 재계산 금지).
 */

import Link from "next/link"
import { useMemo, useState } from "react"
import { ApiError, apiFetch, useApiQuery } from "@/lib/mrv/client"
import { useMrvSite } from "@/lib/mrv/ui/site"
import { METRIC_META, METRIC_ORDER } from "@/lib/mrv/ui/metric-meta"
import { isoDay, recentPeriod } from "@/lib/mrv/ui/period"
import { KpiCard } from "@/components/mrv/kpi-card"
import { PowerTimeSeriesChart } from "@/components/mrv/power-time-series-chart"
import { TankMultiSelect } from "@/components/mrv/tank-multi-select"
import {
  DashboardFilterBar,
  type DashboardFilterValue,
} from "@/components/mrv/dashboard-filter-bar"
import { CenteredMessage, LoadError, PageHeader } from "@/components/mrv/ui"
import type { UseSiteReadingsTarget } from "@/lib/mrv/ui/use-site-readings"
import type {
  KpiCardProps,
  KpiResponse,
  MeterListResponse,
  OnboardingStatus,
} from "@/lib/mrv/api-types"

export default function OverviewPage() {
  const { selectedSiteId, selectedSite, sites, isLoading: sitesLoading } = useMrvSite()

  // 기본 기간은 최근 30일. 필터를 바꾸면 KPI 카드와 차트가 함께 그 기간을 따른다.
  const [filter, setFilter] = useState<DashboardFilterValue>(() => ({
    ...recentPeriod(30),
    granularity: "daily",
  }))
  const [selectedTankIds, setSelectedTankIds] = useState<string[]>([])

  const kpi = useApiQuery<KpiResponse>(
    (signal) =>
      apiFetch<KpiResponse>(`/sites/${encodeURIComponent(selectedSiteId as string)}/kpi`, {
        query: { from: filter.from, to: filter.to },
        signal,
      }),
    [selectedSiteId, filter.from, filter.to],
    { enabled: Boolean(selectedSiteId) },
  )

  // 온보딩 미완료 배너. 조회에 실패하면 조용히 숨긴다 — 보조 안내가 본 화면을 가리면 안 된다.
  const onboarding = useApiQuery<OnboardingStatus>(
    (signal) =>
      apiFetch<OnboardingStatus>(
        `/sites/${encodeURIComponent(selectedSiteId as string)}/onboarding-status`,
        { signal },
      ),
    [selectedSiteId],
    { enabled: Boolean(selectedSiteId) },
  )
  const onboardingIncomplete =
    onboarding.data !== undefined &&
    Object.values(onboarding.data.steps).some((s) => !s.done)

  // 수조를 고르지 않았으면 사이트의 전력 계측기 전체를 본다.
  const meters = useApiQuery<MeterListResponse>(
    (signal) =>
      apiFetch<MeterListResponse>(
        `/sites/${encodeURIComponent(selectedSiteId as string)}/meters`,
        { signal },
      ),
    [selectedSiteId],
    { enabled: Boolean(selectedSiteId) && selectedTankIds.length === 0 },
  )

  const readingTargets: UseSiteReadingsTarget[] = useMemo(() => {
    if (selectedTankIds.length > 0) {
      return selectedTankIds.map((tankId) => ({
        key: tankId,
        tankId,
        type: "power",
        label: tankId,
      }))
    }
    const powerMeters = (meters.data?.items ?? []).filter((m) => m.type === "power")
    return powerMeters.map((m) => ({
      key: m.id,
      meterId: m.id,
      label: m.label ?? m.id,
    }))
  }, [selectedTankIds, meters.data])

  const isUnauthorized = kpi.error instanceof ApiError && kpi.error.isUnauthorized

  if (!sitesLoading && sites.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
        <PageHeader title="사이트 개요" />
        <CenteredMessage>
          이 조직에 등록된 사이트가 없습니다. 관리자에게 사이트 등록을 요청해 주세요.
        </CenteredMessage>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <PageHeader
        title="사이트 개요"
        description={
          selectedSite
            ? `${selectedSite.name} · 기간 ${isoDay(filter.from)} ~ ${isoDay(filter.to)}`
            : "사이트를 불러오는 중…"
        }
      />

      {onboardingIncomplete && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-mrv-amber bg-mrv-amber-bg p-4 text-sm"
        >
          <span className="text-mrv-fg">
            온보딩을 완료하세요 — 설치키트 / 센서매핑 / 기준선수집 / 유료전환
          </span>
          <Link
            href="/mrv/onboarding"
            className="rounded-md border border-mrv-border bg-mrv-surface px-3 py-1.5 text-sm font-medium text-mrv-fg hover:bg-mrv-bg"
          >
            온보딩 계속하기
          </Link>
        </div>
      )}

      <section className="flex flex-col gap-3" aria-label="핵심 지표(KPI)">
        {kpi.isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {METRIC_ORDER.map((key) => (
              <div
                key={key}
                className="h-40 animate-pulse rounded-xl border border-mrv-border bg-mrv-surface"
                role="status"
                aria-label={`${METRIC_META[key].title} 불러오는 중`}
              />
            ))}
          </div>
        )}

        {kpi.isError && !kpi.isLoading && (
          <LoadError
            message="KPI를 불러오지 못했습니다."
            isUnauthorized={isUnauthorized}
            onRetry={kpi.refetch}
          />
        )}

        {!kpi.isLoading && !kpi.isError && !kpi.data && (
          <CenteredMessage>표시할 KPI 데이터가 없습니다.</CenteredMessage>
        )}

        {kpi.data && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {METRIC_ORDER.map((key) => {
              const meta = METRIC_META[key]
              const props: KpiCardProps = {
                title: meta.title,
                metricKey: key,
                metric: kpi.data!.metrics[key],
                configVersion: kpi.data!.kpi_config.version,
                period: { from: kpi.data!.period.from, to: kpi.data!.period.to },
                betterWhen: meta.betterWhen,
              }
              return <KpiCard key={key} {...props} />
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-label="전력 시계열">
        <DashboardFilterBar value={filter} onChange={setFilter} />
        <TankMultiSelect
          siteId={selectedSiteId}
          value={selectedTankIds}
          onChange={setSelectedTankIds}
        />
        <PowerTimeSeriesChart
          siteId={selectedSiteId}
          from={filter.from}
          to={filter.to}
          granularity={filter.granularity}
          targets={readingTargets}
        />
      </section>
    </div>
  )
}
