import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSiteKpi } from "./hooks/useSiteKpi";
import { KpiCard } from "./components/KpiCard";
import { PowerTimeSeriesChart } from "./components/PowerTimeSeriesChart";
import { TankMultiSelect } from "./components/TankMultiSelect";
import {
  DashboardFilterBar,
  type DashboardFilterValue,
} from "./components/DashboardFilterBar";
import type { UseSiteReadingsTarget } from "./hooks/useSiteReadings";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { ApiError } from "@/lib/api-client";
import { METRIC_META, METRIC_ORDER } from "@/lib/metric-meta";
import type { KpiCardProps } from "@/types/api";

/*
 * 사이트 개요 (통합 대시보드 첫 화면).
 * Phase 1: 5종 KPI 카드(EI 총/폭기 · FCR · OEI · 폐사율)를 KpiCard 재사용으로 렌더.
 * 지표 방향(betterWhen)은 METRIC_META 단일 출처에서 온다(OEI만 "높을수록 좋음").
 * 절대 규칙: metrics 값은 백엔드 결과를 그대로 표시(재계산 금지).
 * 로딩/에러/빈 상태를 명시적으로 처리한다.
 */

// 데모 사이트/기간 상수. 멀티사이트 선택 UI는 후속.
const DEMO_SITE_ID = import.meta.env.VITE_DEMO_SITE_ID ?? "demo-site";
const DEMO_FROM = "2026-06-01T00:00:00Z";
const DEMO_TO = "2026-06-30T23:59:59Z";
// 사이트 전체 전력 계측기(수조 미선택 시 폴백). 배선 전 데모 기본값.
const DEMO_POWER_METER_ID =
  import.meta.env.VITE_DEMO_POWER_METER_ID ?? "mtr_power_main";

function CenteredMessage({
  tone = "muted",
  role,
  children,
}: {
  tone?: "muted" | "error";
  role?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={role}
      className={`flex min-h-[8rem] items-center justify-center rounded-card border border-border bg-surface p-8 text-center text-sm ${
        tone === "error" ? "text-signal-red" : "text-muted"
      }`}
    >
      {children}
    </div>
  );
}

export function OverviewPage() {
  const period = { from: DEMO_FROM, to: DEMO_TO };
  const query = useSiteKpi({ siteId: DEMO_SITE_ID, ...period });
  const { data, isLoading, isError, error, refetch } = query;

  // 온보딩 미완료 배너(MASTER 화면16, phase-3 7절) — 최소한만: 조회 실패 시 조용히 숨긴다
  // (대시보드 핵심 기능을 가리지 않기 위함, 과설계 금지).
  const onboardingStatusQuery = useOnboardingStatus(DEMO_SITE_ID);
  const onboardingIncomplete =
    onboardingStatusQuery.data !== undefined &&
    Object.values(onboardingStatusQuery.data.steps).some((s) => !s.done);

  const isUnauthorized = error instanceof ApiError && error.isUnauthorized;

  // 대시보드 실데이터 필터(phase-2 4.3절 DashboardFilterState) — 로컬 상태.
  const [filter, setFilter] = useState<DashboardFilterValue>({
    from: DEMO_FROM,
    to: DEMO_TO,
    granularity: "hourly",
  });
  const [selectedTankIds, setSelectedTankIds] = useState<string[]>([]);

  // 수조 선택 없음 = 사이트 전체 전력 계측기 1개. 선택 있음 = 수조별 series(4.3절 tank_id+type).
  const readingTargets: UseSiteReadingsTarget[] = useMemo(() => {
    if (selectedTankIds.length === 0) {
      return [{ key: DEMO_POWER_METER_ID, meterId: DEMO_POWER_METER_ID }];
    }
    return selectedTankIds.map((tankId) => ({
      key: tankId,
      tankId,
      type: "power",
      label: tankId,
    }));
  }, [selectedTankIds]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-fg">사이트 개요</h1>
        <p className="text-sm text-muted">
          사이트 {DEMO_SITE_ID} · 기간 {DEMO_FROM.slice(0, 10)} ~{" "}
          {DEMO_TO.slice(0, 10)}
        </p>
      </header>

      {onboardingIncomplete && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-signal-amber bg-signal-amber-bg p-4 text-sm"
        >
          <span className="text-fg">온보딩을 완료하세요 — 설치키트/센서매핑/기준선수집/유료전환</span>
          <Link
            to="/onboarding"
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-bg"
          >
            온보딩 계속하기
          </Link>
        </div>
      )}

      {/* KPI 카드 영역 (5종) */}
      <section className="flex flex-col gap-3" aria-label="핵심 지표(KPI)">
        {isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {METRIC_ORDER.map((key) => (
              <div
                key={key}
                className="h-40 animate-pulse rounded-card border border-border bg-surface"
                role="status"
                aria-label={`${METRIC_META[key].title} 불러오는 중`}
              />
            ))}
          </div>
        )}

        {isError && !isLoading && (
          <CenteredMessage tone="error" role="alert">
            <div className="flex flex-col items-center gap-2">
              <p>
                {isUnauthorized
                  ? "인증이 만료되었습니다. 다시 로그인해 주세요."
                  : "KPI를 불러오지 못했습니다."}
              </p>
              {!isUnauthorized && (
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="rounded-md border border-border px-3 py-1 text-fg hover:bg-bg"
                >
                  다시 시도
                </button>
              )}
            </div>
          </CenteredMessage>
        )}

        {!isLoading && !isError && !data && (
          <CenteredMessage>표시할 KPI 데이터가 없습니다.</CenteredMessage>
        )}

        {data && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {METRIC_ORDER.map((key) => {
              const meta = METRIC_META[key];
              const props: KpiCardProps = {
                title: meta.title,
                metricKey: key,
                metric: data.metrics[key],
                configVersion: data.kpi_config.version,
                period: { from: data.period.from, to: data.period.to },
                betterWhen: meta.betterWhen,
              };
              return <KpiCard key={key} {...props} />;
            })}
          </div>
        )}
      </section>

      {/* 시계열 차트 필터 + 수조별 비교 + 실데이터 차트 (phase-2 4.1/4.3절) */}
      <section className="flex flex-col gap-4" aria-label="전력 시계열">
        <DashboardFilterBar value={filter} onChange={setFilter} />
        <TankMultiSelect
          siteId={DEMO_SITE_ID}
          value={selectedTankIds}
          onChange={setSelectedTankIds}
        />
        <PowerTimeSeriesChart
          siteId={DEMO_SITE_ID}
          from={filter.from}
          to={filter.to}
          granularity={filter.granularity}
          targets={readingTargets}
        />
      </section>
    </div>
  );
}
