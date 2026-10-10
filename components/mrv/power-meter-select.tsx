"use client"

/**
 * 전력 계측기 선택.
 *
 * `BatchSelect` 와 같은 모양이지만 목록이 비었을 때의 처신이 **정반대**다. 배치는 목록
 * 조회가 실패해도 ID 직접 입력으로 넘어간다 — 현장 기록을 막는 쪽이 더 비싸기 때문이다.
 * 계측기는 그렇게 하지 않는다. 등록되지 않은 계측기 ID 로 전력을 보내면 서버가 그 건을
 * 스코프 밖으로 거부하고, 운영자는 "저장했는데 KPI 가 안 변한다" 를 겪는다. 게다가 전력
 * 계측값은 EI·Scope2·기준선의 근거라 **엉뚱한 계측기에 붙은 kWh 는 조용한 오염**이다.
 * 그래서 목록에 있는 것만 고르게 하고, 없으면 설정 화면으로 보낸다.
 *
 * 폭기 여부를 목록에 함께 적는다. 폭기 EI 는 `is_aeration=true` 계측기의 합이고, 그
 * 구분은 계측기 등록 때 한 번 정해지면 화면 어디에도 다시 나오지 않는다 — 전력을 넣는
 * 자리에서 보이지 않으면 총전력계에 폭기 전력을 적어도 아무도 알아채지 못한다.
 */

import { useId } from "react"
import { apiFetch, useApiQuery } from "@/lib/mrv/client"
import { INPUT_CLASS } from "@/components/mrv/ui"
import type { Meter, MeterListResponse } from "@/lib/mrv/api-types"

export function PowerMeterSelect({
  siteId,
  value,
  onChange,
  disabled,
  label = "전력 계측기",
}: {
  siteId: string | null
  value: string
  onChange: (meterId: string) => void
  disabled?: boolean
  label?: string
}) {
  const id = useId()
  const { data, isLoading, isError } = useApiQuery<MeterListResponse>(
    (signal) =>
      apiFetch<MeterListResponse>(`/sites/${encodeURIComponent(siteId as string)}/meters`, {
        signal,
      }),
    [siteId],
    { enabled: Boolean(siteId) },
  )

  // 전력 계측기만 고를 수 있어야 한다. DO 계측기에 kWh 를 적으면 그 값은 EI 에 들어가지
  // 않고(전력 타입만 합산된다) DO 시계열을 망친다.
  const powerMeters = (data?.items ?? []).filter((m: Meter) => m.type === "power")

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-mrv-fg">
        {label} <span className="text-mrv-red">*</span>
      </label>

      {isLoading && (
        <div
          role="status"
          className="h-10 animate-pulse rounded-md border border-mrv-border bg-mrv-surface"
          aria-label="계측기 목록 불러오는 중"
        />
      )}

      {!isLoading && (
        <select
          id={id}
          value={value}
          disabled={disabled || powerMeters.length === 0}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CLASS} py-2 disabled:opacity-60`}
        >
          <option value="">계측기를 선택하세요</option>
          {powerMeters.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label ? `${m.label} (${m.id})` : m.id} · {m.unit}
              {m.is_aeration ? " · 폭기" : " · 총전력"}
            </option>
          ))}
        </select>
      )}

      {!isLoading && isError && (
        <p role="alert" className="text-xs text-mrv-red">
          계측기 목록을 불러오지 못했습니다. 잘못된 계측기에 전력을 적으면 되돌릴 수 없으므로
          직접 입력은 두지 않았습니다 — 새로고침 후 다시 시도하세요.
        </p>
      )}

      {!isLoading && !isError && powerMeters.length === 0 && (
        <p role="note" className="text-xs text-mrv-muted">
          등록된 전력 계측기가 없습니다. 설정 화면에서 전력 계측기를 먼저 등록하세요 —
          계측기 없이 들어온 전력은 어느 설비의 값인지 알 수 없어 증빙이 되지 않습니다.
          (폭기 전력을 따로 재면 폭기 계측기도 함께 등록하세요. 폭기 EI 가 그 합입니다.)
        </p>
      )}
    </div>
  )
}
