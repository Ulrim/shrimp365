import { useMemo, useState } from "react";
import { useSiteKpiBenchmark } from "@/hooks/useSiteKpiBenchmark";
import { ApiError } from "@/lib/api-client";
import {
  BENCHMARK_METRIC_META,
  findBestWorst,
  formatBenchmarkNumber,
  sortBenchmarkRows,
  type BenchmarkSortDirection,
  type SiteBenchmarkMetricKey,
} from "./multisite-meta";
import type { SiteBenchmarkRow } from "@/types/api";

/*
 * 멀티사이트 KPI 벤치마크(MASTER 화면12, phase-3 4.2절, ENTERPRISE). GET /sites/kpi-benchmark
 * 응답(site별 EI/OEI/FCR/폐사율)을 그대로 표시한다 — 산식 재계산 없음. 정렬/최우수·최하위
 * 하이라이트만 FE 표시 로직(단순 비교, 신규 산식 아님, 4.2절 명시 허용 범위).
 */

function dayToIsoUtc(day: string): string | null {
  if (!day) return null;
  const iso = `${day}T00:00:00Z`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

export function MultisiteBenchmarkPage() {
  const [from, setFrom] = useState("2026-07-01");
  const [to, setTo] = useState("2026-07-31");
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [periodError, setPeriodError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SiteBenchmarkMetricKey>("ei_total");
  const [sortDir, setSortDir] = useState<BenchmarkSortDirection>("asc");

  const benchmarkQuery = useSiteKpiBenchmark(period?.from ?? "", period?.to ?? "");
  const apiError = benchmarkQuery.error instanceof ApiError ? benchmarkQuery.error : null;

  function handleQuery() {
    const fromIso = dayToIsoUtc(from);
    const toIso = dayToIsoUtc(to);
    if (!fromIso || !toIso) {
      setPeriodError("기간이 올바르지 않습니다.");
      return;
    }
    if (new Date(fromIso).getTime() >= new Date(toIso).getTime()) {
      setPeriodError("시작일은 종료일보다 앞서야 합니다.");
      return;
    }
    setPeriodError(null);
    setPeriod({ from: fromIso, to: toIso });
  }

  function handleSortClick(key: SiteBenchmarkMetricKey) {
    if (key === sortKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortedRows = useMemo(
    () => sortBenchmarkRows(benchmarkQuery.data?.sites ?? [], sortKey, sortDir),
    [benchmarkQuery.data, sortKey, sortDir],
  );

  return (
    <PageShell>
      <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">비교 기간 선택</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-fg">
            시작일
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-fg">
            종료일
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
            />
          </label>
          <button
            type="button"
            onClick={handleQuery}
            className="rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-bg"
          >
            조회하기
          </button>
        </div>
        {periodError && (
          <p role="alert" className="text-sm text-signal-red">
            {periodError}
          </p>
        )}
      </section>

      {period && benchmarkQuery.isLoading && (
        <div
          role="status"
          aria-label="벤치마크 불러오는 중"
          className="h-40 animate-pulse rounded-card border border-border bg-surface"
        />
      )}

      {period && apiError?.status === 403 && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-card border border-border bg-surface p-5 text-sm"
        >
          <p className="font-semibold text-fg">멀티사이트 벤치마크를 사용할 수 없습니다</p>
          <p className="text-muted">
            멀티사이트 벤치마크는 ENTERPRISE 요금제에서 제공됩니다. 요금제를 업그레이드하면
            이용할 수 있습니다.
          </p>
        </div>
      )}
      {period && apiError?.isUnauthorized && (
        <p role="alert" className="text-sm text-signal-red">
          인증이 만료되었습니다. 다시 로그인해 주세요.
        </p>
      )}
      {period && benchmarkQuery.isError && !apiError && (
        <p role="alert" className="text-sm text-signal-red">
          벤치마크 결과를 불러오지 못했습니다.
        </p>
      )}

      {period && benchmarkQuery.data && sortedRows.length === 0 && (
        <p
          role="status"
          className="rounded-card border border-border bg-surface p-6 text-sm text-muted"
        >
          비교할 site가 없습니다.
        </p>
      )}

      {period && benchmarkQuery.data && sortedRows.length > 0 && (
        <BenchmarkTable
          rows={sortedRows}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortClick={handleSortClick}
        />
      )}
    </PageShell>
  );
}

function BenchmarkTable({
  rows,
  sortKey,
  sortDir,
  onSortClick,
}: {
  rows: SiteBenchmarkRow[];
  sortKey: SiteBenchmarkMetricKey;
  sortDir: BenchmarkSortDirection;
  onSortClick: (key: SiteBenchmarkMetricKey) => void;
}) {
  const bestWorstByKey = useMemo(() => {
    const map: Record<
      SiteBenchmarkMetricKey,
      { bestSiteId: string | null; worstSiteId: string | null }
    > = {} as Record<SiteBenchmarkMetricKey, { bestSiteId: string | null; worstSiteId: string | null }>;
    for (const meta of BENCHMARK_METRIC_META) {
      map[meta.key] = findBestWorst(rows, meta.key, meta.betterWhen);
    }
    return map;
  }, [rows]);

  return (
    <section aria-label="사이트별 KPI 벤치마크" className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="px-4 py-2">사이트</th>
            <th className="px-4 py-2">산식 버전</th>
            {BENCHMARK_METRIC_META.map((meta) => (
              <th key={meta.key} className="px-4 py-2">
                <button
                  type="button"
                  onClick={() => onSortClick(meta.key)}
                  aria-pressed={sortKey === meta.key}
                  className="inline-flex items-center gap-1 font-semibold text-fg hover:text-primary"
                >
                  {meta.label}
                  <span aria-hidden="true" className="text-muted">
                    {sortKey === meta.key ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.site_id} className="border-b border-border last:border-0">
              <td className="px-4 py-2 font-medium text-fg">{row.site_name}</td>
              <td className="px-4 py-2 text-muted">{row.config_version}</td>
              {BENCHMARK_METRIC_META.map((meta) => {
                const value = row.metrics[meta.key];
                const bw = bestWorstByKey[meta.key];
                const isBest = bw.bestSiteId === row.site_id && bw.bestSiteId !== bw.worstSiteId;
                const isWorst = bw.worstSiteId === row.site_id && bw.bestSiteId !== bw.worstSiteId;
                return (
                  <td
                    key={meta.key}
                    className={`px-4 py-2 ${
                      isBest
                        ? "bg-signal-green-bg font-semibold text-signal-green"
                        : isWorst
                          ? "bg-signal-red-bg text-signal-red"
                          : "text-fg"
                    }`}
                  >
                    {formatBenchmarkNumber(value)}
                    {isBest && (
                      <span className="ml-1 text-xs" aria-label="최우수">
                        ★
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-fg">멀티사이트 벤치마크</h1>
        <p className="text-sm text-muted">
          조직 소속 site 전체의 KPI 비교(EI/OEI/FCR/폐사율, ENTERPRISE)
        </p>
      </header>
      {children}
    </div>
  );
}
