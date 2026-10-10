"use client"

/**
 * 시계열 지표 선택 — MASTER 4장 화면 #3 의 "전력·DO·수온·pH" 를 켜고 끈다.
 *
 * 사이트에 계측기가 없는 지표는 **감추지 않고 비활성으로 보여 준다.** 감추면
 * "우리 양식장은 pH 를 못 보는 건가, 이 제품이 못 보는 건가" 를 구분할 수 없다.
 * 비활성 항목에는 그 이유(계측기 미등록)를 항목 옆에 적고, 계측기가 **하나도** 없을 때는
 * 설정 화면으로 가는 링크를 함께 낸다.
 */

import Link from "next/link"
import { READING_TYPE_META, READING_TYPE_ORDER } from "@/lib/mrv/ui/reading-meta"
import type { ReadingMeterType } from "@/lib/mrv/api-types"

export function ReadingTypeSelect({
  value,
  onChange,
  availableTypes,
  isLoading = false,
}: {
  value: ReadingMeterType[]
  onChange: (next: ReadingMeterType[]) => void
  /** 이 사이트에 계측기가 등록된 타입. 로딩 중에는 비어 있을 수 있다. */
  availableTypes: ReadingMeterType[]
  isLoading?: boolean
}) {
  const available = new Set(availableTypes)

  function toggle(type: ReadingMeterType) {
    onChange(value.includes(type) ? value.filter((t) => t !== type) : [...value, type])
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-mrv-fg">표시할 지표</legend>

      {isLoading && (
        <div
          role="status"
          className="h-9 w-full animate-pulse rounded-md border border-mrv-border bg-mrv-surface"
          aria-label="계측기 목록 불러오는 중"
        />
      )}

      {!isLoading && (
        <div className="flex flex-wrap gap-3">
          {READING_TYPE_ORDER.map((type) => {
            const meta = READING_TYPE_META[type]
            const hasMeter = available.has(type)
            return (
              <label
                key={type}
                className={`flex items-center gap-1.5 text-sm ${
                  hasMeter ? "text-mrv-fg" : "text-mrv-muted"
                }`}
                title={hasMeter ? undefined : `${meta.label} 계측기가 등록되어 있지 않습니다.`}
              >
                <input
                  type="checkbox"
                  checked={value.includes(type)}
                  disabled={!hasMeter}
                  onChange={() => toggle(type)}
                  className="h-4 w-4 rounded border-mrv-border disabled:opacity-50"
                />
                {meta.label}
                {!hasMeter && <span className="text-[11px]">(계측기 없음)</span>}
              </label>
            )
          })}
        </div>
      )}

      {!isLoading && availableTypes.length === 0 && (
        <p className="text-xs text-mrv-muted">
          이 사이트에 등록된 계측기가 없습니다.{" "}
          <Link href="/mrv/settings" className="underline hover:text-mrv-fg">
            설정에서 계측기를 등록
          </Link>
          하면 시계열이 표시됩니다.
        </p>
      )}

      {!isLoading && value.length === 0 && availableTypes.length > 0 && (
        <p className="text-xs text-mrv-muted">
          지표를 하나 이상 선택하면 시계열이 표시됩니다.
        </p>
      )}
    </fieldset>
  )
}
