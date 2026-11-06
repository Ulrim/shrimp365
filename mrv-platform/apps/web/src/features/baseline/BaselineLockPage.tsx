import { useState } from "react";
import { useSiteBaseline } from "@/hooks/useSiteBaseline";
import { useLockBaseline } from "@/hooks/useLockBaseline";
import { useSiteKpi } from "@/features/dashboard/hooks/useSiteKpi";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api-client";
import { formatIsoLocal } from "@/lib/datetime";
import { BaselineMetricsGrid } from "./BaselineMetricsGrid";
import { ConfirmLockDialog } from "./ConfirmLockDialog";

/*
 * 기준선 확정/잠금 화면 (MASTER 화면15, 슬라이스 C-FE).
 * 흐름: 기간 선택 → 미리보기(GET /kpi, 잠금 전 확인) → 잠금(확인 다이얼로그) → POST /baseline/lock.
 * 이미 잠긴 경우: 잠금값·locked_by/at·config version + "잠금됨(불변)" 배지, 잠금 버튼 비활성.
 * 재잠금 409 → 안내. viewer: 잠금 버튼 숨김.
 * 절대 규칙: metrics 값은 백엔드 결과를 그대로 표시(재계산 금지).
 */

const DEMO_SITE_ID = import.meta.env.VITE_DEMO_SITE_ID ?? "demo-site";

// 날짜(YYYY-MM-DD) → UTC ISO(일 경계). 백엔드 계약(2.3절)과 동일 표현.
function dayToIsoUtc(day: string): string | null {
  if (!day) return null;
  const iso = `${day}T00:00:00Z`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

export function BaselineLockPage() {
  const siteId = DEMO_SITE_ID;
  const { canLockBaseline, isViewer } = useAuth();

  const baselineQuery = useSiteBaseline(siteId);
  const lockMutation = useLockBaseline(siteId);

  const [from, setFrom] = useState("2026-04-01");
  const [to, setTo] = useState("2026-05-01");
  const [previewPeriod, setPreviewPeriod] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const previewQuery = useSiteKpi({
    siteId,
    from: previewPeriod?.from ?? "",
    to: previewPeriod?.to ?? "",
  });

  function handlePreview() {
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
    setPreviewPeriod({ from: fromIso, to: toIso });
  }

  function handleConfirmLock() {
    if (!previewPeriod) return;
    lockMutation.mutate(
      { period: previewPeriod },
      { onSettled: () => setConfirmOpen(false) },
    );
  }

  // --- 로딩/에러(비 404) ---
  if (baselineQuery.isLoading) {
    return (
      <PageShell>
        <div
          role="status"
          aria-label="기준선 상태 불러오는 중"
          className="h-40 animate-pulse rounded-card border border-border bg-surface"
        />
      </PageShell>
    );
  }
  if (baselineQuery.isError) {
    const unauthorized =
      baselineQuery.error instanceof ApiError && baselineQuery.error.isUnauthorized;
    return (
      <PageShell>
        <p role="alert" className="text-sm text-signal-red">
          {unauthorized
            ? "인증이 만료되었습니다. 다시 로그인해 주세요."
            : "기준선 상태를 불러오지 못했습니다."}
        </p>
      </PageShell>
    );
  }

  const locked = baselineQuery.data; // null = 아직 잠금 안 됨

  // --- 이미 잠긴 경우: 불변 표시 ---
  if (locked) {
    return (
      <PageShell>
        <div className="flex items-center gap-2">
          <span
            role="status"
            className="inline-flex items-center gap-1 rounded-full bg-signal-na-bg px-3 py-1 text-xs font-medium text-fg"
          >
            <span aria-hidden="true">🔒</span> 잠금됨(불변)
          </span>
          <span className="text-sm text-muted">
            기간 {locked.period.from.slice(0, 10)} ~ {locked.period.to.slice(0, 10)}
          </span>
        </div>

        <BaselineMetricsGrid
          metrics={locked.metrics}
          configVersion={locked.kpi_config.version}
          period={{ from: locked.period.from, to: locked.period.to }}
        />

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-card border border-border bg-surface p-4 text-sm sm:grid-cols-4">
          <Field label="잠금 사용자" value={locked.locked_by ?? "-"} />
          <Field label="잠금 시각" value={formatIsoLocal(locked.locked_at)} />
          <Field label="산식 버전" value={locked.kpi_config.version} />
          <Field
            label="스냅샷 ID"
            value={locked.provenance.kpi_snapshot_id ?? "-"}
          />
        </dl>

        <button
          type="button"
          disabled
          aria-disabled="true"
          className="self-start rounded-md border border-border px-4 py-2 text-sm text-muted opacity-60"
        >
          기준선 잠금 (이미 잠김)
        </button>
        <p className="text-xs text-muted">
          기준선은 잠금 후 수정·삭제할 수 없습니다(Rule 3).
        </p>
      </PageShell>
    );
  }

  // --- 미잠금: 미리보기 → 잠금 ---
  const lockConflict =
    lockMutation.error instanceof ApiError && lockMutation.error.status === 409;
  const lockErrorMsg = lockMutation.isError
    ? lockConflict
      ? "이미 잠긴 기준선이 있습니다. 기준선은 재잠금할 수 없습니다."
      : lockMutation.error instanceof ApiError
        ? lockMutation.error.message
        : "기준선 잠금에 실패했습니다."
    : null;

  return (
    <PageShell>
      <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">기준선 기간 선택</h2>
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
            onClick={handlePreview}
            className="rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-bg"
          >
            미리보기
          </button>
        </div>
        {periodError && (
          <p role="alert" className="text-sm text-signal-red">
            {periodError}
          </p>
        )}
      </section>

      {/* 미리보기 결과 (잠금 전 확인) */}
      {previewPeriod && (
        <section className="flex flex-col gap-3" aria-label="기준선 미리보기">
          <h2 className="text-base font-semibold text-fg">
            미리보기 (잠금 전 확인)
          </h2>
          {previewQuery.isLoading && (
            <div
              role="status"
              aria-label="미리보기 불러오는 중"
              className="h-24 animate-pulse rounded-card border border-border bg-surface"
            />
          )}
          {previewQuery.isError && (
            <p role="alert" className="text-sm text-signal-red">
              미리보기 KPI를 불러오지 못했습니다.
            </p>
          )}
          {previewQuery.data && (
            <BaselineMetricsGrid
              metrics={previewQuery.data.metrics}
              configVersion={previewQuery.data.kpi_config.version}
              period={{
                from: previewQuery.data.period.from,
                to: previewQuery.data.period.to,
              }}
            />
          )}
        </section>
      )}

      {lockErrorMsg && (
        <p role="alert" className="text-sm text-signal-red">
          {lockErrorMsg}
        </p>
      )}

      {/* 잠금 버튼: viewer는 숨김 */}
      {!isViewer && (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={!canLockBaseline || !previewPeriod || lockMutation.isPending}
          className="self-start rounded-md bg-signal-red px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          기준선 잠금
        </button>
      )}
      {isViewer && (
        <p role="note" className="text-sm text-muted">
          읽기 전용 권한(viewer)입니다. 기준선 잠금은 owner/operator만 가능합니다.
        </p>
      )}
      {!previewPeriod && !isViewer && (
        <p className="text-xs text-muted">
          먼저 기간을 미리보기하면 잠금이 활성화됩니다.
        </p>
      )}

      <ConfirmLockDialog
        open={confirmOpen}
        period={previewPeriod ?? { from, to }}
        pending={lockMutation.isPending}
        onConfirm={handleConfirmLock}
        onCancel={() => setConfirmOpen(false)}
      />
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-fg">기준선 확정 · 잠금</h1>
        <p className="text-sm text-muted">
          사이트 {DEMO_SITE_ID} · 기준선(Before)은 잠금 후 불변입니다.
        </p>
      </header>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="break-all text-fg">{value}</dd>
    </div>
  );
}
