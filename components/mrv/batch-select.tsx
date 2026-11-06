"use client"

/**
 * 배치 선택.
 * 원본: mrv-platform/apps/web/src/features/input/BatchSelect.tsx
 *
 * 목록을 못 불러오면 드롭다운 대신 직접 입력으로 바꾼다 — 배치 목록 조회가 실패했다고
 * 해서 급이·폐사 기록까지 막으면 현장 기록이 통째로 유실된다.
 */

import { useId } from "react"
import { ApiError, apiFetch, useApiQuery } from "@/lib/mrv/client"
import { INPUT_CLASS } from "@/components/mrv/ui"
import type { Batch } from "@/lib/mrv/api-types"

export function BatchSelect({
  siteId,
  value,
  onChange,
  disabled,
}: {
  siteId: string | null
  value: string
  onChange: (batchId: string) => void
  disabled?: boolean
}) {
  const id = useId()
  const { data, isLoading, isError, error } = useApiQuery<Batch[]>(
    (signal) =>
      apiFetch<Batch[]>(`/sites/${encodeURIComponent(siteId as string)}/batches`, {
        signal,
      }),
    [siteId],
    { enabled: Boolean(siteId) },
  )

  const isUnauthorized = error instanceof ApiError && error.isUnauthorized
  const batches = data ?? []
  const useManualFallback = !isLoading && (isError || batches.length === 0)

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-mrv-fg">
        배치 <span className="text-mrv-red">*</span>
      </label>

      {isLoading && (
        <div
          role="status"
          className="h-10 animate-pulse rounded-md border border-mrv-border bg-mrv-surface"
          aria-label="배치 목록 불러오는 중"
        />
      )}

      {!isLoading && !useManualFallback && (
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
        >
          <option value="">배치를 선택하세요</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.id} · {b.species} · 입식 {b.stocked_count.toLocaleString("ko-KR")}마리
              {b.closed_at ? " (종료)" : ""}
            </option>
          ))}
        </select>
      )}

      {useManualFallback && (
        <>
          <input
            id={id}
            type="text"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder="배치 ID 직접 입력"
            className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
          />
          <p className="text-xs text-mrv-muted">
            {isUnauthorized
              ? "인증이 만료되어 배치 목록을 불러오지 못했습니다. 배치 ID를 직접 입력하세요."
              : isError
                ? "배치 목록을 불러오지 못했습니다. 배치 ID를 직접 입력하세요."
                : "등록된 배치가 없습니다. 배치 ID를 직접 입력하세요."}
          </p>
        </>
      )}
    </div>
  )
}
