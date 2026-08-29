"use client"

/**
 * 수조 다중 선택(수조별 비교).
 * 원본: mrv-platform/apps/web/src/features/dashboard/components/TankMultiSelect.tsx
 *
 * 선택이 없으면 사이트 전체 전력 시계열을 본다는 뜻이다 — 빈 선택을 "아무것도 안 보임"이
 * 아니라 기본값으로 다루는 것이 원본의 규칙이다.
 */

import { useMemo } from "react"
import { ApiError, apiFetch, useApiQuery } from "@/lib/mrv/client"
import type { Batch } from "@/lib/mrv/api-types"

export function TankMultiSelect({
  siteId,
  value,
  onChange,
}: {
  siteId: string | null
  value: string[]
  onChange: (tankIds: string[]) => void
}) {
  const { data, isLoading, isError, error } = useApiQuery<Batch[]>(
    (signal) =>
      apiFetch<Batch[]>(`/sites/${encodeURIComponent(siteId as string)}/batches`, {
        signal,
      }),
    [siteId],
    { enabled: Boolean(siteId) },
  )
  const isUnauthorized = error instanceof ApiError && error.isUnauthorized

  const tankIds = useMemo(() => {
    const set = new Set<string>()
    for (const b of data ?? []) set.add(b.tank_id)
    return Array.from(set).sort()
  }, [data])

  function toggle(tankId: string) {
    onChange(
      value.includes(tankId) ? value.filter((id) => id !== tankId) : [...value, tankId],
    )
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-mrv-fg">수조별 비교</legend>

      {isLoading && (
        <div
          role="status"
          className="h-9 w-full animate-pulse rounded-md border border-mrv-border bg-mrv-surface"
          aria-label="수조 목록 불러오는 중"
        />
      )}

      {!isLoading && isError && (
        <p className="text-xs text-mrv-red" role="alert">
          {isUnauthorized
            ? "인증이 만료되어 수조 목록을 불러오지 못했습니다."
            : "수조 목록을 불러오지 못했습니다."}
        </p>
      )}

      {!isLoading && !isError && tankIds.length === 0 && (
        <p className="text-xs text-mrv-muted">등록된 수조가 없습니다.</p>
      )}

      {!isLoading && !isError && tankIds.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {tankIds.map((tankId) => (
            <label key={tankId} className="flex items-center gap-1.5 text-sm text-mrv-fg">
              <input
                type="checkbox"
                checked={value.includes(tankId)}
                onChange={() => toggle(tankId)}
                className="h-4 w-4 rounded border-mrv-border"
              />
              {tankId}
            </label>
          ))}
        </div>
      )}

      {value.length === 0 && !isLoading && (
        <p className="text-xs text-mrv-muted">
          선택 없음 = 사이트 전체 전력 시계열을 표시합니다.
        </p>
      )}
    </fieldset>
  )
}
