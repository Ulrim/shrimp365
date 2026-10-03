import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSiteBaseline } from "@/hooks/useSiteBaseline";
import { useGenerateMrvReport } from "@/hooks/useGenerateMrvReport";
import { useEmissionFactors } from "@/hooks/useEmissionFactors";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api-client";
import { ConfirmGenerateDialog } from "./ConfirmGenerateDialog";

/*
 * MRV 리포트 생성 화면(MASTER 화면10, phase-3 슬라이스 M-FE, PRO 이상).
 * 흐름: After 기간(+선택적 배출계수 id) 입력 → 확인 다이얼로그 →
 *   POST /sites/{id}/mrv-reports/generate → 성공 시 MrvReportViewPage(/mrv-reports/:id)로 이동.
 * baseline 미잠금은 사전에 안내(useSiteBaseline 재사용, BaselineLockPage와 동일 훅)하고,
 * 생성 요청이 404로 응답해도 동일 안내로 처리한다(경합 방어).
 * 산식 재계산 금지 — 생성 결과는 다음 화면(MrvReportViewPage)이 그대로 표시한다.
 */

const DEMO_SITE_ID = import.meta.env.VITE_DEMO_SITE_ID ?? "demo-site";

function dayToIsoUtc(day: string): string | null {
  if (!day) return null;
  const iso = `${day}T00:00:00Z`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

export function MrvReportGeneratePage() {
  const siteId = DEMO_SITE_ID;
  const navigate = useNavigate();
  const { canLockBaseline, isViewer } = useAuth();

  const baselineQuery = useSiteBaseline(siteId);
  const generateMutation = useGenerateMrvReport(siteId);
  const emissionFactorsQuery = useEmissionFactors();
  const emissionFactors = emissionFactorsQuery.data?.items ?? [];

  const [from, setFrom] = useState("2026-07-01");
  const [to, setTo] = useState("2026-07-31");
  const [emissionFactorId, setEmissionFactorId] = useState("");
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleOpenConfirm() {
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
    setConfirmOpen(true);
  }

  function handleConfirm() {
    if (!period) return;
    generateMutation.mutate(
      {
        after_period: period,
        emission_factor_id: emissionFactorId.trim() || null,
      },
      {
        onSuccess: (data) => navigate(`/mrv-reports/${data.id}`),
        onSettled: () => setConfirmOpen(false),
      },
    );
  }

  // --- baseline 상태 로딩 ---
  if (baselineQuery.isLoading) {
    return (
      <PageShell>
        <div
          role="status"
          aria-label="기준선 상태 불러오는 중"
          className="h-24 animate-pulse rounded-card border border-border bg-surface"
        />
      </PageShell>
    );
  }

  const baselineMissing = baselineQuery.data === null;
  const generateError =
    generateMutation.error instanceof ApiError ? generateMutation.error : null;
  const generateErrorIsBaselineMissing = generateError?.status === 404;

  return (
    <PageShell>
      {isViewer && (
        <p role="note" className="rounded-card border border-border bg-surface p-4 text-sm text-muted">
          MRV 리포트 생성은 owner/operator만 가능합니다. viewer 권한으로는 생성할 수 없습니다.
        </p>
      )}

      {(baselineMissing || generateErrorIsBaselineMissing) && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-card border border-signal-amber bg-signal-amber-bg p-5 text-sm"
        >
          <p className="font-semibold text-fg">먼저 기준선을 잠가주세요</p>
          <p className="text-muted">
            이 사이트는 아직 잠긴 기준선(baseline)이 없어 MRV 리포트를 생성할 수 없습니다.
          </p>
          <Link
            to="/baseline"
            className="self-start rounded-md border border-border px-3 py-1.5 text-sm text-fg hover:bg-bg"
          >
            기준선 잠금으로 이동
          </Link>
        </div>
      )}

      {generateError && !generateErrorIsBaselineMissing && (
        <p role="alert" className="text-sm text-signal-red">
          {generateError.status === 422
            ? "요청 기간이 올바르지 않습니다."
            : generateError.status === 403
              ? "MRV 리포트 생성은 PRO 이상 요금제에서 제공됩니다."
              : generateError.isUnauthorized
                ? "인증이 만료되었습니다. 다시 로그인해 주세요."
                : (generateError.message ?? "MRV 리포트 생성에 실패했습니다.")}
        </p>
      )}

      <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">After 기간 선택</h2>
        <p className="text-xs text-muted">
          기준선(Before)은 이미 잠긴 값을 그대로 사용합니다(재계산 없음).
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
        </div>

        <label className="flex flex-col gap-1 text-sm text-fg">
          배출계수 (선택)
          {emissionFactors.length > 0 ? (
            <select
              value={emissionFactorId}
              onChange={(e) => setEmissionFactorId(e.target.value)}
              className="w-96 rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
            >
              <option value="">자동(활성 배출계수 사용)</option>
              {emissionFactors.map((ef, idx) => (
                <option key={ef.id} value={ef.id}>
                  {ef.version} · {ef.source} ({ef.year}년, {ef.factor_tco2e_per_mwh} tCO2e/MWh)
                  {idx === 0 ? " — 활성" : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={emissionFactorId}
              onChange={(e) => setEmissionFactorId(e.target.value)}
              placeholder="비워두면 활성(최신) 배출계수가 자동 적용됩니다"
              className="w-72 rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
            />
          )}
        </label>
        <p className="text-xs text-muted">
          {emissionFactorsQuery.isError
            ? "배출계수 목록을 불러오지 못했습니다 — ID를 직접 입력할 수 있습니다."
            : "과거 배출계수로 재현·검증이 필요한 경우에만 활성값이 아닌 다른 버전을 선택하세요."}
        </p>

        {periodError && (
          <p role="alert" className="text-sm text-signal-red">
            {periodError}
          </p>
        )}

        {!isViewer && (
          <button
            type="button"
            onClick={handleOpenConfirm}
            disabled={!canLockBaseline || baselineMissing || generateMutation.isPending}
            className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            리포트 생성
          </button>
        )}
      </section>

      <ConfirmGenerateDialog
        open={confirmOpen}
        period={period ?? { from, to }}
        pending={generateMutation.isPending}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-fg">MRV 리포트 생성</h1>
        <p className="text-sm text-muted">
          사이트 {DEMO_SITE_ID} · 기준선(Before) 대비 After 기간의 탄소저감 성과 리포트(PRO 이상)
        </p>
      </header>
      {children}
    </div>
  );
}
