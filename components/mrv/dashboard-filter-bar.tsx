"use client"

/**
 * 대시보드 기간·집계 단위 필터.
 * 원본: mrv-platform/apps/web/src/features/dashboard/components/DashboardFilterBar.tsx
 *
 * 날짜 입력은 UTC 로 해석한다(시작일 00:00:00Z, 종료일 23:59:59Z) — KPI 기간 규약이
 * UTC 이므로 화면이 로컬 자정을 보내면 경계에서 하루가 밀린다.
 */

import { useId } from "react"
import { INPUT_CLASS } from "@/components/mrv/ui"
import type { ReadingGranularity } from "@/lib/mrv/api-types"

export type DashboardFilterValue = {
  /** ISO8601 UTC */
  from: string
  /** ISO8601 UTC */
  to: string
  granularity: Extract<ReadingGranularity, "hourly" | "daily">
}

function isoToDateInput(iso: string): string {
  return iso.slice(0, 10)
}

function dateInputToIsoStart(value: string): string | null {
  if (!value) return null
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function dateInputToIsoEnd(value: string): string | null {
  if (!value) return null
  const d = new Date(`${value}T23:59:59Z`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function DashboardFilterBar({
  value,
  onChange,
}: {
  value: DashboardFilterValue
  onChange: (next: DashboardFilterValue) => void
}) {
  const fromId = useId()
  const toId = useId()
  const granularityId = useId()

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-mrv-border bg-mrv-surface p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={fromId} className="text-xs font-medium text-mrv-fg">
          시작일
        </label>
        <input
          id={fromId}
          type="date"
          value={isoToDateInput(value.from)}
          onChange={(e) => {
            const iso = dateInputToIsoStart(e.target.value)
            if (iso) onChange({ ...value, from: iso })
          }}
          className={INPUT_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={toId} className="text-xs font-medium text-mrv-fg">
          종료일
        </label>
        <input
          id={toId}
          type="date"
          value={isoToDateInput(value.to)}
          onChange={(e) => {
            const iso = dateInputToIsoEnd(e.target.value)
            if (iso) onChange({ ...value, to: iso })
          }}
          className={INPUT_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={granularityId} className="text-xs font-medium text-mrv-fg">
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
          className={INPUT_CLASS}
        >
          <option value="hourly">시간별</option>
          <option value="daily">일별</option>
        </select>
      </div>
    </div>
  )
}
