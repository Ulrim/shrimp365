import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMrvReport } from "@/hooks/useMrvReport";
import { apiFetchBlob, ApiError } from "@/lib/api-client";
import { formatIsoLocal } from "@/lib/datetime";
import { MRV_METRIC_ROWS, formatMrvNumber } from "./mrv-meta";
import { SnapshotDrilldownDialog } from "./SnapshotDrilldownDialog";
import type { MrvReportResponse } from "@/types/api";

/*
 * MRV 리포트 뷰어(MASTER 화면10, phase-3 1.5~1.8절, 슬라이스 M-FE, PRO 이상).
 * 절대 규칙: 산식 재계산 금지(formula_text/reduction_tco2e 등 백엔드 값 그대로 표시),
 * 모든 숫자는 클릭 시 근거 데이터로 이동 가능해야 한다(drill-down, GET /kpi-snapshots/{id}).
 * "출력해서 제출 가능한 문서" 미감을 위해 여백·표·산식 가독성 위주로 단순하게 구성한다.
 */
export function MrvReportViewPage() {
  const { id } = useParams<{ id: string }>();
  const reportQuery = useMrvReport(id ?? "");

  const [drilldown, setDrilldown] = useState<{ snapshotId: string; label: string } | null>(
    null,
  );

  const apiError = reportQuery.error instanceof ApiError ? reportQuery.error : null;

  return (
    <PageShell>
      {reportQuery.isLoading && (
        <div
          role="status"
          aria-label="MRV 리포트 불러오는 중"
          className="h-40 animate-pulse rounded-card border border-border bg-surface"
        />
      )}

      {apiError?.status === 404 && (
        <p role="alert" className="text-sm text-signal-red">
          해당 MRV 리포트를 찾을 수 없습니다.
        </p>
      )}
      {apiError?.status === 403 && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-card border border-border bg-surface p-5 text-sm"
        >
          <p className="font-semibold text-fg">이 리포트를 볼 수 없습니다</p>
          <p className="text-muted">
            MRV 리포트는 PRO 이상 요금제 또는 해당 조직 소속 사용자만 조회할 수 있습니다.
          </p>
        </div>
      )}
      {apiError?.isUnauthorized && (
        <p role="alert" className="text-sm text-signal-red">
          인증이 만료되었습니다. 다시 로그인해 주세요.
        </p>
      )}
      {reportQuery.isError && !apiError && (
        <p role="alert" className="text-sm text-signal-red">
          MRV 리포트를 불러오지 못했습니다.
        </p>
      )}

      {reportQuery.data && (
        <ReportView
          report={reportQuery.data}
          onDrilldown={(snapshotId, label) => setDrilldown({ snapshotId, label })}
        />
      )}

      <SnapshotDrilldownDialog
        snapshotId={drilldown?.snapshotId ?? null}
        label={drilldown?.label ?? null}
        onClose={() => setDrilldown(null)}
      />
    </PageShell>
  );
}

function ReductionBadge({ value }: { value: number | null }) {
  const badge =
    value === null
      ? { text: "산출 불가", tone: "text-muted", bg: "bg-signal-na-bg" }
      : value > 0
        ? { text: "감축 달성", tone: "text-signal-green", bg: "bg-signal-green-bg" }
        : value < 0
          ? { text: "배출 증가(미달성)", tone: "text-signal-red", bg: "bg-signal-red-bg" }
          : { text: "변화 없음", tone: "text-muted", bg: "bg-signal-na-bg" };

  return (
    <section
      aria-label="감축량"
      className="flex flex-col items-start gap-2 rounded-card border border-border bg-surface p-6"
    >
      <span className={`inline-flex w-fit items-center rounded-full ${badge.bg} px-3 py-1 text-xs font-semibold ${badge.tone}`}>
        {badge.text}
      </span>
      <p className="text-4xl font-bold text-fg">
        {value === null ? "산출 불가" : `${value.toFixed(3)} tCO2e`}
      </p>
      <p className="text-xs text-muted">
        감축량 = (EI_baseline − EI_after) × 생산량(kg) / 1000 × 배출계수(tCO2e/MWh)
      </p>
    </section>
  );
}

function ReportView({
  report,
  onDrilldown,
}: {
  report: MrvReportResponse;
  onDrilldown: (snapshotId: string, label: string) => void;
}) {
  const configVersionMismatch =
    report.boundary.config_version.before !== report.boundary.config_version.after;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted">리포트 ID {report.id}</span>
          <span className="text-muted">
            생성 {formatIsoLocal(report.generated_at)} · {report.generated_by}
          </span>
        </div>
        <PdfDownloadButton report={report} />
      </section>

      <ReductionBadge value={report.reduction_tco2e} />

      <section className="flex flex-col gap-3" aria-label="Before/After 비교">
        <h2 className="text-base font-semibold text-fg">Before / After 비교</h2>
        <p className="text-xs text-muted">
          수치를 클릭하면 해당 기간의 근거 데이터(kpi_snapshot)로 이동할 수 있습니다.
        </p>
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-4 py-2">지표</th>
                <th className="px-4 py-2">
                  기준선(Before) {report.before.period.from.slice(0, 10)}~
                  {report.before.period.to.slice(0, 10)}
                </th>
                <th className="px-4 py-2">
                  현재(After) {report.after.period.from.slice(0, 10)}~
                  {report.after.period.to.slice(0, 10)}
                </th>
              </tr>
            </thead>
            <tbody>
              {MRV_METRIC_ROWS.map((row) => (
                <tr key={row.key} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-medium text-fg">
                    {row.label}
                    <span className="ml-1 text-xs text-muted">({row.unit})</span>
                  </td>
                  <MrvValueCell
                    value={row.getValue(report.before)}
                    snapshotId={report.before.kpi_snapshot_id}
                    label="기준선(Before)"
                    onDrilldown={onDrilldown}
                  />
                  <MrvValueCell
                    value={row.getValue(report.after)}
                    snapshotId={report.after.kpi_snapshot_id}
                    label="현재(After)"
                    onDrilldown={onDrilldown}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2" aria-label="산식 전문">
        <h2 className="text-base font-semibold text-fg">산식 전문</h2>
        <pre
          data-testid="mrv-formula-text"
          className="whitespace-pre-wrap break-words rounded-card border border-border bg-bg p-4 text-sm text-fg"
        >
          {report.formula_text}
        </pre>
      </section>

      <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5" aria-label="측정경계·가정">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-fg">측정경계 · 가정</h2>
          {configVersionMismatch && (
            <span
              role="status"
              className="inline-flex items-center gap-1 rounded-full bg-signal-amber-bg px-2 py-0.5 text-xs font-medium text-signal-amber"
            >
              <span aria-hidden="true">⚠</span> 산식 버전 차이
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <BoundaryList title="포함 계측기(meter)" items={report.boundary.included_meter_ids} />
          <BoundaryList
            title="포함 품질 플래그"
            items={report.boundary.included_quality_flags}
          />
          <BoundaryList
            title="생산량 근거(Before)"
            items={report.boundary.biomass_source_refs.before ?? []}
          />
          <BoundaryList
            title="생산량 근거(After)"
            items={report.boundary.biomass_source_refs.after ?? []}
          />
        </div>

        <div className="text-xs text-muted">
          산식 버전 — Before: {report.boundary.config_version.before} / After:{" "}
          {report.boundary.config_version.after}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-fg">가정(assumptions)</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-fg">
            {report.boundary.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex flex-col gap-1 rounded-card border border-border bg-surface p-5 text-sm" aria-label="배출계수 정보">
        <h2 className="text-base font-semibold text-fg">배출계수</h2>
        <p className="text-fg">
          버전 {report.emission_factor.version} · 출처 {report.emission_factor.source} · 공표연도{" "}
          {report.emission_factor.year}
        </p>
      </section>
    </div>
  );
}

function MrvValueCell({
  value,
  snapshotId,
  label,
  onDrilldown,
}: {
  value: number | null;
  snapshotId: string | null;
  label: string;
  onDrilldown: (snapshotId: string, label: string) => void;
}) {
  if (!snapshotId) {
    return <td className="px-4 py-2 text-fg">{formatMrvNumber(value)}</td>;
  }
  return (
    <td className="px-4 py-2">
      <button
        type="button"
        onClick={() => onDrilldown(snapshotId, label)}
        className="rounded-md text-fg underline decoration-dotted underline-offset-4 hover:text-primary"
        title={`${label} 근거 데이터 보기`}
      >
        {formatMrvNumber(value)}
      </button>
    </td>
  );
}

function BoundaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted">없음</p>
      ) : (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-fg">
          {items.map((item, i) => (
            <li key={i} className="break-all">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PdfDownloadButton({ report }: { report: MrvReportResponse }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function handleDownload() {
    setState("loading");
    try {
      const blob = await apiFetchBlob(`/mrv-reports/${report.id}/pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${report.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  if (!report.pdf_available) {
    return <p className="text-xs text-muted">PDF를 사용할 수 없습니다.</p>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleDownload}
        disabled={state === "loading"}
        className="rounded-md border border-primary px-3 py-1.5 text-sm font-medium text-primary hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "loading" ? "다운로드 중…" : "PDF 다운로드"}
      </button>
      {state === "error" && (
        <p role="alert" className="text-xs text-signal-red">
          PDF 다운로드에 실패했습니다.
        </p>
      )}
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-fg">MRV 리포트</h1>
        <p className="text-sm text-muted">
          탄소저감 성과 증빙 · 수치는 근거 데이터로 역추적 가능합니다.
        </p>
      </header>
      {children}
    </div>
  );
}
