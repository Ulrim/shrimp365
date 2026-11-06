"use client"

/**
 * 수조 다중 선택(수조별 비교).
 * 원본: mrv-platform/apps/web/src/features/dashboard/components/TankMultiSelect.tsx
 *
 * 선택이 없으면 사이트 전체 시계열을 본다는 뜻이다 — 빈 선택을 "아무것도 안 보임"이
 * 아니라 기본값으로 다루는 것이 원본의 규칙이다.
 *
 * ── 수조 목록을 배치에서 뽑지 않는다 (고침) ────────────────────────────────
 * 원본도 이식본도 `GET /batches` 의 `tank_id` 를 모아 수조 목록을 만들었다. 수조를
 * 직접 주는 창구가 없었기 때문인데, 그 때문에 두 가지가 틀렸다:
 *
 *   · **배치가 없는 수조는 아예 나오지 않는다.** 이제 막 등록해 입식 전인 수조가
 *     그렇다 — 계측기를 달아 전력을 모으고 있어도 수조별 비교에 뜨지 않는다.
 *   · **이름이 아니라 id 가 찍힌다.** 시드 데이터의 id 가 `tank-1` 이라 그동안
 *     이름처럼 보였을 뿐이고, 화면에서 만든 수조는 `tank-<uuid>` 라 그대로 드러난다.
 *
 * `GET /sites/{id}/tanks` 가 생겼으므로 그것을 쓴다. id 오름차순은 서버가 준 순서를
 * 그대로 따른다(OEI 기준 수조를 고르는 순서와 같다).
 */

import { useMemo } from "react"
import { ApiError, apiFetch, useApiQuery } from "@/lib/mrv/client"
import type { TankListResponse } from "@/lib/mrv/api-types"

export function TankMultiSelect({
  siteId,
  value,
  onChange,
}: {
  siteId: string | null
  value: string[]
  onChange: (tankIds: string[]) => void
}) {
  const { data, isLoading, isError, error } = useApiQuery<TankListResponse>(
    (signal) =>
      apiFetch<TankListResponse>(`/sites/${encodeURIComponent(siteId as string)}/tanks`, {
        signal,
      }),
    [siteId],
    { enabled: Boolean(siteId) },
  )
  const isUnauthorized = error instanceof ApiError && error.isUnauthorized

  const tanks = useMemo(() => data?.items ?? [], [data])

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

      {!isLoading && !isError && tanks.length === 0 && (
        <p className="text-xs text-mrv-muted">등록된 수조가 없습니다.</p>
      )}

      {!isLoading && !isError && tanks.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {tanks.map((tank) => (
            <label key={tank.id} className="flex items-center gap-1.5 text-sm text-mrv-fg">
              <input
                type="checkbox"
                checked={value.includes(tank.id)}
                onChange={() => toggle(tank.id)}
                className="h-4 w-4 rounded border-mrv-border"
              />
              {tank.name}
            </label>
          ))}
        </div>
      )}

      {value.length === 0 && !isLoading && (
        <p className="text-xs text-mrv-muted">
          선택 없음 = 사이트의 계측기 전체를 지표별로 표시합니다.
        </p>
      )}
    </fieldset>
  )
}
