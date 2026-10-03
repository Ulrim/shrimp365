"use client"

/**
 * 사이트 개요 — 통합 대시보드 첫 화면.
 * 원본: mrv-platform/apps/web/src/features/dashboard/OverviewPage.tsx
 *
 * 5종 KPI 카드(EI 총/폭기 · FCR · OEI · 폐사율)와 계측 시계열을 함께 보여 준다.
 * 지표 방향(낮을수록 좋음/높을수록 좋음)은 METRIC_META 한 곳에서 온다.
 *
 * 시계열은 MASTER 4장 화면 #3 대로 전력·DO·수온·pH·ORP·EC 여섯 지표를 **고를 수 있게**
 * 한다(기본으로 켜지는 것은 전력·DO 둘이다 — 요청 수를 아끼고, 나머지는 필요할 때 켠다).
 * 지표마다 단위가 달라 한 Y축에 겹칠 수 없으므로 **지표당 차트 한 장**을 쌓고, X축을 선택
 * 기간으로 고정해 **가로 위치가 차트끼리 같은 시각**을 가리키게 한다. 기간·집계·수조 선택은
 * 전 차트가 함께 따른다.
 *
 * 절대 규칙: metrics 값은 서버 결과를 그대로 표시한다(화면에서 재계산 금지).
 */

import Link from "next/link"
import { useMemo, useState } from "react"
import { ApiError, apiFetch, useApiQuery } from "@/lib/mrv/client"
import { useMrvSite } from "@/lib/mrv/ui/site"
import { METRIC_META, METRIC_ORDER } from "@/lib/mrv/ui/metric-meta"
import {
  DEFAULT_READING_TYPES,
  READING_TYPE_META,
  READING_TYPE_ORDER,
} from "@/lib/mrv/ui/reading-meta"
import { isoDay, recentPeriod } from "@/lib/mrv/ui/period"
import { KpiCard } from "@/components/mrv/kpi-card"
import { ReadingTimeSeriesChart } from "@/components/mrv/reading-time-series-chart"
import { ReadingTypeSelect } from "@/components/mrv/reading-type-select"
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
  ReadingMeterType,
} from "@/lib/mrv/api-types"

export default function OverviewPage() {
  const { selectedSiteId, selectedSite, sites, isLoading: sitesLoading } = useMrvSite()

  // 기본 기간은 최근 30일. 필터를 바꾸면 KPI 카드와 차트가 함께 그 기간을 따른다.
  const [filter, setFilter] = useState<DashboardFilterValue>(() => ({
    ...recentPeriod(30),
    granularity: "daily",
  }))
  const [selectedTankIds, setSelectedTankIds] = useState<string[]>([])
  const [selectedTypes, setSelectedTypes] =
    useState<ReadingMeterType[]>(DEFAULT_READING_TYPES)

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

  // 계측기 목록은 두 가지에 쓰인다 — 어떤 지표를 고를 수 있는지, 그리고 수조를 고르지
  // 않았을 때 사이트 전체 계측기를 타입별로 묶는 데. 그래서 수조 선택과 무관하게 조회한다.
  const meters = useApiQuery<MeterListResponse>(
    (signal) =>
      apiFetch<MeterListResponse>(
        `/sites/${encodeURIComponent(selectedSiteId as string)}/meters`,
        { signal },
      ),
    [selectedSiteId],
    { enabled: Boolean(selectedSiteId) },
  )

  /** 이 사이트에 계측기가 등록된 타입(고를 수 있는 지표). */
  const availableTypes = useMemo(() => {
    const present = new Set((meters.data?.items ?? []).map((m) => m.type))
    return READING_TYPE_ORDER.filter((t) => present.has(t))
  }, [meters.data])

  /**
   * 타입별 조회 대상.
   *   - 수조를 골랐으면 수조마다 `tank_id + type` 으로 본다(수조별 비교).
   *   - 안 골랐으면 사이트의 해당 타입 계측기 전체를 계측기 단위로 본다.
   *
   * ★ **실제로 존재하는 (수조, 타입) 쌍만 만든다.** 계측기 목록에 `tank_id` 와 `type` 이
   *   이미 있으므로 공짜로 알 수 있다. 존재 여부를 보지 않고 전부 발사하면 두 가지가 같이
   *   나빠진다 — (1) 없는 조합까지 요청해 지표 6종 × 수조 20개 = 120건이 기간 변경 한 번마다
   *   나가고(요청 하나가 인증 왕복까지 포함해 대략 5왕복이다), (2) 서버가 빈 포인트를 주므로
   *   화면이 "선택한 기간에 데이터가 없습니다" 라고 말한다 — 기간을 바꿔 볼 일인지 센서를
   *   달 일인지 운영자가 구분할 수 없다. 걸러 내면 대상이 0 이 되어 "계측기가 없습니다" 로
   *   정확히 안내한다.
   */
  const targetsByType = useMemo(() => {
    const items = meters.data?.items ?? []
    /** (tank_id, type) → 그 수조에 그 타입 계측기가 있는가. */
    const tankTypePairs = new Set(
      items.filter((m) => m.tank_id).map((m) => `${m.tank_id}\u0000${m.type}`),
    )
    const map = new Map<ReadingMeterType, UseSiteReadingsTarget[]>()
    for (const type of READING_TYPE_ORDER) {
      if (selectedTankIds.length > 0) {
        map.set(
          type,
          selectedTankIds
            .filter((tankId) => tankTypePairs.has(`${tankId}\u0000${type}`))
            .map((tankId) => ({
              key: `${type}:${tankId}`,
              tankId,
              type,
              label: tankId,
            })),
        )
      } else {
        map.set(
          type,
          items
            .filter((m) => m.type === type)
            .map((m) => ({
              key: `${type}:${m.id}`,
              meterId: m.id,
              label: m.label ?? m.id,
            })),
        )
      }
    }
    return map
  }, [selectedTankIds, meters.data])

  // 켜 둔 지표 중 실제로 그릴 것(계측기가 있는 것만). 선택 상태는 건드리지 않는다 —
  // 사이트를 옮겼다 돌아오면 선택이 그대로 살아 있어야 한다.
  const chartTypes = useMemo(
    () => selectedTypes.filter((t) => availableTypes.includes(t)),
    [selectedTypes, availableTypes],
  )

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

      <section className="flex flex-col gap-4" aria-label="계측 시계열">
        <DashboardFilterBar value={filter} onChange={setFilter} />
        <ReadingTypeSelect
          value={selectedTypes}
          onChange={setSelectedTypes}
          availableTypes={availableTypes}
          isLoading={meters.isLoading}
        />
        <TankMultiSelect
          siteId={selectedSiteId}
          value={selectedTankIds}
          onChange={setSelectedTankIds}
        />

        {meters.isError && !meters.isLoading && (
          <LoadError
            message="계측기 목록을 불러오지 못했습니다. 시계열을 표시할 수 없습니다."
            isUnauthorized={
              meters.error instanceof ApiError && meters.error.isUnauthorized
            }
            onRetry={meters.refetch}
          />
        )}

        {chartTypes.map((type) => (
          <ReadingTimeSeriesChart
            key={type}
            siteId={selectedSiteId}
            type={type}
            from={filter.from}
            to={filter.to}
            granularity={filter.granularity}
            targets={targetsByType.get(type) ?? []}
            noMeterNotice={
              selectedTankIds.length > 0
                ? `선택한 수조에 ${READING_TYPE_META[type].label} 계측기가 없습니다.`
                : undefined
            }
          />
        ))}
      </section>
    </div>
  )
}
