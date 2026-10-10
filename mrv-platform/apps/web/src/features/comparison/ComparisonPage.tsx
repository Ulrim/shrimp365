import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSiteComparison } from "@/hooks/useSiteComparison";
import { ApiError } from "@/lib/api-client";
import { formatIsoLocal } from "@/lib/datetime";
import { toComparisonViewModel } from "./comparisonViewModel";

/*
 * 전·후(A/B) 비교 화면(MASTER 화면9, phase-2 슬라이스 J-FE, PRO 이상).
 * 산식 재계산 금지 — GET /sites/{id}/comparison 응답(delta/improvement_pct)을 그대로 표시.
 *
 * 이중 방어: App.tsx 네비게이션은 GET /auth/me(usePlan) 기반으로 START 플랜이면 메뉴 자체를
 * 숨긴다(선제 게이팅). 다만 라우트는 막지 않으므로 직접 URL로 접근하면 이 화면이 계속 렌더되고,
 * 그 경우 실제 API 403 응답을 받은 뒤 아래 안내 화면으로 전환한다(백엔드가 최종 방어선).
 */

const DEMO_SITE_ID = import.meta.env.VITE_DEMO_SITE_ID ?? "demo-site";

function dayToIsoUtc(day: string): string | null {
  if (!day) return null;
  const iso = `${day}T00:00:00Z`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

export function ComparisonPage() {
  const siteId = DEMO_SITE_ID;
  const { isViewer } = useAuth();

  const [from, setFrom] = useState("2026-07-01");
  const [to, setTo] = useState("2026-07-31");
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [periodError, setPeriodError] = useState<string | null>(null);

  const comparisonQuery = useSiteComparison(
    siteId,
    period?.from ?? "",
    period?.to ?? "",
  );

  function handleCompare() {
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

  const apiError =
    comparisonQuery.error instanceof ApiError ? comparisonQuery.error : null;

  return (
    <PageShell>
      {isViewer && (
        <p role="note" className="rounded-card border border-border bg-surface p-4 text-sm text-muted">
          전·후 비교는 owner/operator만 볼 수 있습니다. viewer 권한으로는 조회할 수 없습니다.
        </p>
      )}

      <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">비교 기간(현재, current) 선택</h2>
        <p className="text-xs text-muted">
          기준선(baseline)은 이미 잠긴 값을 그대로 사용합니다(재계산 없음).
        </p>
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
            onClick={handleCompare}
            className="rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-bg"
          >
            비교하기
          </button>
        </div>
        {periodError && (
          <p role="alert" className="text-sm text-signal-red">
            {periodError}
          </p>
        )}
      </section>

      {/* --- 로딩 --- */}
      {period && comparisonQuery.isLoading && (
        <div
          role="status"
          aria-label="비교 결과 불러오는 중"
          className="h-40 animate-pulse rounded-card border border-border bg-surface"
        />
      )}

      {/* --- 404: baseline 미잠금 --- */}
      {period && apiError?.status === 404 && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-card border border-signal-amber bg-signal-amber-bg p-5 text-sm"
        >
          <p className="font-semibold text-fg">먼저 기준선을 잠가주세요</p>
          <p className="text-muted">
            이 사이트는 아직 잠긴 기준선(baseline)이 없어 비교할 수 없습니다.
          </p>
          <Link
            to="/baseline"
            className="self-start rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:bg-bg"
          >
            기준선 잠금으로 이동
          </Link>
        </div>
      )}

      {/* --- 403: 플랜/권한 부족 --- */}
      {period && apiError?.status === 403 && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-card border border-border bg-surface p-5 text-sm"
        >
          <p className="font-semibold text-fg">전·후 비교를 사용할 수 없습니다</p>
          <p className="text-muted">
            {isViewer
              ? "전·후 비교는 owner/operator만 볼 수 있습니다."
              : "전·후 비교는 PRO 이상 요금제에서 제공됩니다. 요금제를 업그레이드하면 이용할 수 있습니다."}
          </p>
        </div>
      )}

      {/* --- 그 외 에러 --- */}
      {period && comparisonQuery.isError && !apiError && (
        <p role="alert" className="text-sm text-signal-red">
          비교 결과를 불러오지 못했습니다.
        </p>
      )}
      {period && apiError && apiError.isUnauthorized && (
        <p role="alert" className="text-sm text-signal-red">
          인증이 만료되었습니다. 다시 로그인해 주세요.
        </p>
      )}

      {/* --- 정상 결과 --- */}
      {comparisonQuery.data && (
        <ComparisonResultView vm={toComparisonViewModel(comparisonQuery.data)} />
      )}
    </PageShell>
  );
}

function ComparisonResultView({
  vm,
}: {
  vm: ReturnType<typeof toComparisonViewModel>;
}) {
  const versionMismatch = vm.baselineConfigVersion !== vm.currentConfigVersion;

  return (
    <section className="flex flex-col gap-4" aria-label="비교 결과">
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface p-4 text-sm">
        <span className="text-muted">
          기준선(Before) {vm.baselinePeriod.from.slice(0, 10)} ~{" "}
          {vm.baselinePeriod.to.slice(0, 10)} (v{vm.baselineConfigVersion})
        </span>
        <span className="text-muted">
          현재(After) {formatIsoLocal(vm.currentPeriod.from)} ~{" "}
          {formatIsoLocal(vm.currentPeriod.to)} (v{vm.currentConfigVersion})
        </span>
        {versionMismatch && (
          <span
            role="status"
            className="inline-flex items-center gap-1 rounded-full bg-signal-amber-bg px-2 py-0.5 text-xs font-medium text-signal-amber"
          >
            <span aria-hidden="true">⚠</span> 산식 버전 차이
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-4 py-2">지표</th>
              <th className="px-4 py-2">기준선(Before)</th>
              <th className="px-4 py-2">현재(After)</th>
              <th className="px-4 py-2">증감</th>
              <th className="px-4 py-2">개선율</th>
            </tr>
          </thead>
          <tbody>
            {vm.rows.map((row) => (
              <ComparisonRowView key={row.key} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ComparisonRowView({
  row,
}: {
  row: ReturnType<typeof toComparisonViewModel>["rows"][number];
}) {
  const improved =
    row.improvementPct !== null ? row.improvementPct > 0 : null;
  const arrow =
    row.deltaValue === null
      ? "-"
      : row.deltaValue > 0
        ? "▲"
        : row.deltaValue < 0
          ? "▼"
          : "―";

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-2 font-medium text-fg">
        {row.label}
        <span className="ml-1 text-xs text-muted">
          ({row.direction === "lower_is_better" ? "낮을수록 좋음" : "높을수록 좋음"})
        </span>
      </td>
      <td className="px-4 py-2 text-fg">{row.baselineValue ?? "산출 불가"}</td>
      <td className="px-4 py-2 text-fg">{row.currentValue ?? "산출 불가"}</td>
      <td className="px-4 py-2 text-fg">
        <span aria-hidden="true">{arrow}</span>{" "}
        {row.deltaValue !== null ? row.deltaValue.toFixed(2) : "산출 불가"}
      </td>
      <td
        className={`px-4 py-2 font-medium ${
          improved === null
            ? "text-muted"
            : improved
              ? "text-signal-green"
              : "text-signal-red"
        }`}
      >
        {row.improvementPct !== null
          ? `${row.improvementPct > 0 ? "+" : ""}${row.improvementPct.toFixed(1)}%`
          : "산출 불가"}
      </td>
    </tr>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-fg">전·후(A/B) 비교</h1>
        <p className="text-sm text-muted">
          사이트 {DEMO_SITE_ID} · 기준선(Before) vs 현재 기간(After) KPI 비교(PRO 이상)
        </p>
      </header>
      {children}
    </div>
  );
}
