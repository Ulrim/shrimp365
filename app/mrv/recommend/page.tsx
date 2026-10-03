"use client"

/**
 * 추천(운전 레시피) 보드.
 * 원본: mrv-platform/apps/web/src/features/recommend/RecommendationBoardPage.tsx
 *
 * 급이·산소·순환 3종 추천을 근거(rationale)와 함께 보여 준다. 이 화면은 "추천만" 한다 —
 * 값이 설비에 반영되려면 승인형 제어 콘솔(ENTERPRISE)을 거쳐야 하고, 그 사실을 화면에
 * 명시한다. 추천값이 그대로 적용된다고 오해하면 현장 판단이 왜곡된다.
 *
 * 운영자가 다른 값을 쓰기로 정하면 수동 버전으로 남길 수 있다. 근거를 필수로 받는 이유는
 * 근거 없는 버전은 나중에 아무도 해석할 수 없기 때문이다.
 */

import { useState } from "react"
import { ApiError, apiFetch, errorMessage, useApiMutation, useApiQuery } from "@/lib/mrv/client"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { useMrvSite } from "@/lib/mrv/ui/site"
import { formatIsoLocal } from "@/lib/mrv/ui/datetime"
import { RECIPE_TYPE_LABEL, formatRecommendedValue } from "@/lib/mrv/ui/recommend-meta"
import {
  Badge,
  CenteredMessage,
  INPUT_CLASS,
  LoadError,
  PRIMARY_BUTTON,
  PageHeader,
  SECONDARY_BUTTON,
} from "@/components/mrv/ui"
import type { RecommendationItem, RecommendationsResponse } from "@/lib/mrv/api-types"

const WRITER_ROLES = new Set(["owner", "operator"])

function ManualVersionForm({
  item,
  onSaved,
}: {
  item: RecommendationItem
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const [rationale, setRationale] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)

  const mutation = useApiMutation(async (body: unknown) =>
    apiFetch(`/recipes/${encodeURIComponent(item.recipe_id)}/versions`, {
      method: "POST",
      json: body,
    }),
  )

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${SECONDARY_BUTTON} self-start`}
      >
        다른 값으로 버전 남기기
      </button>
    )
  }

  /** 추천 파라미터와 같은 키를 써야 이후 제어 액션이 그대로 읽는다. */
  const paramKey =
    item.type === "feed"
      ? "feed_kg_per_day"
      : item.type === "oxygen"
        ? "oxygen_target_do_mg_l"
        : "circulation_setting"

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!rationale.trim()) return setFieldError("근거를 입력하세요.")
    if (!value.trim()) return setFieldError("값을 입력하세요.")

    const parsed =
      item.type === "circulation" ? value.trim() : Number(value)
    if (item.type !== "circulation" && !Number.isFinite(parsed as number)) {
      return setFieldError("값은 숫자여야 합니다.")
    }
    setFieldError(null)

    try {
      await mutation.mutate({
        params: { [paramKey]: parsed },
        rationale: rationale.trim(),
      })
      setOpen(false)
      setValue("")
      setRationale("")
      onSaved()
    } catch {
      /* 아래에 오류를 표시한다. */
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-md bg-mrv-bg p-3">
      <label className="flex flex-col gap-1 text-xs text-mrv-fg">
        적용할 값
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            item.type === "circulation" ? "normal | increase | reduce" : "숫자"
          }
          className={INPUT_CLASS}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-mrv-fg">
        근거 <span className="text-mrv-red">*</span>
        <textarea
          rows={2}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          className={INPUT_CLASS}
        />
      </label>
      {fieldError && (
        <p role="alert" className="text-xs text-mrv-red">
          {fieldError}
        </p>
      )}
      {mutation.error !== undefined && (
        <p role="alert" className="text-xs text-mrv-red">
          {errorMessage(mutation.error, "버전 저장에 실패했습니다.")}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={mutation.isPending} className={PRIMARY_BUTTON}>
          {mutation.isPending ? "저장 중…" : "버전 저장"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={SECONDARY_BUTTON}
        >
          취소
        </button>
      </div>
    </form>
  )
}

export default function RecommendationBoardPage() {
  const { selectedSiteId, selectedSite } = useMrvSite()
  const { isPro, role, isLoading: sessionLoading } = useMrvSession()
  const canWrite = role !== null && WRITER_ROLES.has(role)

  const query = useApiQuery<RecommendationsResponse>(
    (signal) =>
      apiFetch<RecommendationsResponse>(
        `/sites/${encodeURIComponent(selectedSiteId as string)}/recommendations`,
        { signal },
      ),
    [selectedSiteId],
    { enabled: Boolean(selectedSiteId) && isPro },
  )

  const header = (
    <PageHeader
      title="추천 보드 (운전 레시피)"
      description={`${selectedSite?.name ?? "사이트"} · 급이 · 산소 · 순환 추천값과 근거`}
    />
  )

  if (sessionLoading) return null

  if (!isPro) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
        {header}
        <CenteredMessage>추천 보드는 PRO 이상 요금제에서 이용할 수 있습니다.</CenteredMessage>
      </div>
    )
  }

  const isUnauthorized = query.error instanceof ApiError && query.error.isUnauthorized
  const items = query.data?.items ?? []

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      {header}

      <div
        role="note"
        className="rounded-xl border border-mrv-border bg-mrv-na-bg p-4 text-sm text-mrv-muted"
      >
        이 값은 <strong className="text-mrv-fg">추천</strong>이며 설비에 자동 적용되지 않습니다.
        실제 반영은 운영자가 판단해 수행하고, ENTERPRISE 요금제에서는 제어 콘솔의 승인 절차를
        통해 그 사실과 결과를 기록합니다.
      </div>

      {query.isLoading && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              role="status"
              aria-label="추천 불러오는 중"
              className="h-52 animate-pulse rounded-xl border border-mrv-border bg-mrv-surface"
            />
          ))}
        </div>
      )}

      {query.isError && !query.isLoading && (
        <LoadError
          message="추천을 불러오지 못했습니다."
          isUnauthorized={isUnauthorized}
          onRetry={query.refetch}
        />
      )}

      {!query.isLoading && !query.isError && items.length === 0 && (
        <CenteredMessage>표시할 추천이 없습니다.</CenteredMessage>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {items.map((item) => {
          const value = formatRecommendedValue(item.type, item.params)
          return (
            <section
              key={item.type}
              className="flex flex-col gap-3 rounded-xl border border-mrv-border bg-mrv-surface p-5 shadow-sm"
              aria-label={`${RECIPE_TYPE_LABEL[item.type]} 추천`}
            >
              <header className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-mrv-fg">
                  {RECIPE_TYPE_LABEL[item.type]}
                </h2>
                <Badge className="bg-mrv-na-bg text-mrv-muted">
                  v{item.current_version}
                </Badge>
              </header>

              {value === null ? (
                <p className="text-2xl font-bold text-mrv-na">추천 불가</p>
              ) : (
                <p className="text-2xl font-bold text-mrv-fg">{value}</p>
              )}

              <p className="text-xs leading-relaxed text-mrv-muted">{item.rationale}</p>

              {canWrite && (
                <ManualVersionForm item={item} onSaved={query.refetch} />
              )}

              <footer className="mt-1 border-t border-mrv-border pt-2 text-[11px] text-mrv-muted">
                <div>산식 버전 {item.config_version}</div>
                <div>산출 {formatIsoLocal(item.generated_at)}</div>
              </footer>
            </section>
          )
        })}
      </div>
    </div>
  )
}
