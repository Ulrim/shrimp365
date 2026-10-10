import { useId } from "react";
import type { ReadingGranularity } from "@/types/api";

/*
 * 기간(from/to) + granularity(hourly/daily) 필터 UI (phase-2 4.3절 DashboardFilterState).
 * raw는 대시보드에서 미노출(차트 밀도 문제, 4.3절 명시).
 * 상태는 부모(OverviewPage)가 로컬로 들고 있고, 이 컴포넌트는 표시/입력만 담당한다.
 */

export interface DashboardFilterValue {
  from: string; // ISO8601 UTC
  to: string; // ISO8601 UTC
  granularity: Extract<ReadingGranularity, "hourly" | "daily">;
}

function isoToDateInput(iso: string): string {
  return iso.slice(0, 10);
}

function dateInputToIsoStart(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function dateInputToIsoEnd(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T23:59:59Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function DashboardFilterBar({
  value,
  onChange,
}: {
  value: DashboardFilterValue;
  onChange: (next: DashboardFilterValue) => void;
}) {
  const fromId = useId();
  const toId = useId();
  const granularityId = useId();

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={fromId} className="text-xs font-medium text-fg">
          시작일
        </label>
        <input
          id={fromId}
          type="date"
          value={isoToDateInput(value.from)}
          onChange={(e) => {
            const iso = dateInputToIsoStart(e.target.value);
            if (iso) onChange({ ...value, from: iso });
          }}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={toId} className="text-xs font-medium text-fg">
          종료일
        </label>
        <input
          id={toId}
          type="date"
          value={isoToDateInput(value.to)}
          onChange={(e) => {
            const iso = dateInputToIsoEnd(e.target.value);
            if (iso) onChange({ ...value, to: iso });
          }}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={granularityId} className="text-xs font-medium text-fg">
          집계 단위
        </label>
        <select
          id={granularityId}
          value={value.granularity}
          onChange={(e) =>
            onChange({
              ...value,
              granularity: e.target.value as DashboardFilterValue["granularity"],
            })
          }
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
        >
          <option value="hourly">시간별</option>
          <option value="daily">일별</option>
        </select>
      </div>
    </div>
  );
}
