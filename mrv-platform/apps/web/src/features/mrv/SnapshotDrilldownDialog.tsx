import { useEffect, useRef } from "react";
import { useKpiSnapshot } from "@/hooks/useKpiSnapshot";
import { ApiError } from "@/lib/api-client";
import { formatIsoLocal } from "@/lib/datetime";

/*
 * MRV 리포트 수치 drill-down 모달(절대 규칙: 모든 숫자는 클릭 시 근거 데이터로 이동 가능해야
 * 한다). 선택된 kpi_snapshot_id로 GET /kpi-snapshots/{id}를 조회(useKpiSnapshot, snapshotId가
 * null인 동안은 호출하지 않음 — 클릭 시에만 실제 요청 발생)해 스칼라 5종 + inputs_json +
 * provenance_json + config_version을 그대로 보여준다(재계산 금지).
 */
export function SnapshotDrilldownDialog({
  snapshotId,
  label,
  onClose,
}: {
  /** null이면 닫힘(모달 미표시, 쿼리 미호출). */
  snapshotId: string | null;
  /** "기준선(Before)" | "현재(After)" 등 호출부 표기용 라벨. */
  label: string | null;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const query = useKpiSnapshot(snapshotId);
  const open = Boolean(snapshotId);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const apiError = query.error instanceof ApiError ? query.error : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="drilldown-dialog-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-card border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="drilldown-dialog-title" className="text-lg font-bold text-fg">
            근거 데이터{label ? ` — ${label}` : ""}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-bg"
          >
            닫기
          </button>
        </div>

        {query.isLoading && (
          <div
            role="status"
            aria-label="근거 데이터 불러오는 중"
            className="h-24 animate-pulse rounded-card border border-border bg-bg"
          />
        )}

        {query.isError && !apiError && (
          <p role="alert" className="text-sm text-signal-red">
            근거 데이터를 불러오지 못했습니다.
          </p>
        )}
        {apiError && (
          <p role="alert" className="text-sm text-signal-red">
            {apiError.status === 404
              ? "근거 데이터(스냅샷)를 찾을 수 없습니다."
              : apiError.isUnauthorized
                ? "인증이 만료되었습니다. 다시 로그인해 주세요."
                : "근거 데이터를 불러오지 못했습니다."}
          </p>
        )}

        {query.data && (
          <div className="flex flex-col gap-3 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Field label="스냅샷 ID" value={query.data.id} />
              <Field label="산식 버전" value={query.data.config_version} />
              <Field
                label="기간"
                value={`${query.data.period.from.slice(0, 10)} ~ ${query.data.period.to.slice(0, 10)}`}
              />
              <Field label="생성 시각" value={formatIsoLocal(query.data.generated_at)} />
              <Field label="EI(총)" value={fmt(query.data.ei_total)} />
              <Field label="폭기 EI" value={fmt(query.data.ei_aeration)} />
              <Field label="OEI" value={fmt(query.data.oei)} />
              <Field label="FCR" value={fmt(query.data.fcr)} />
              <Field label="폐사율" value={fmt(query.data.mortality_rate)} />
            </dl>

            <JsonBlock title="입력값(inputs_json)" value={query.data.inputs_json} />
            <JsonBlock title="근거 참조(provenance_json)" value={query.data.provenance_json} />
          </div>
        )}
      </div>
    </div>
  );
}

function fmt(value: number | null): string {
  return value === null ? "산출 불가" : String(value);
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="break-all text-fg">{value}</dd>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold text-fg">{title}</h3>
      <pre className="max-h-48 overflow-auto rounded-md bg-bg p-3 text-xs text-fg">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
