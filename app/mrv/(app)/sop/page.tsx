"use client"

/**
 * SOP 라이브러리 목록.
 * 원본: mrv-platform/apps/web/src/features/sop/SopListPage.tsx
 *
 * SOP 문서 자체는 배포에 고정된 콘텐츠다(사용자별 커스터마이즈가 없다). 이 화면은 그
 * 목록을 카테고리별로 보여 주고, 점검 실행 기록은 상세 화면에서 남긴다.
 */

import Link from "next/link"
import { ApiError, apiFetch, useApiQuery } from "@/lib/mrv/client"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { SOP_CATEGORY_LABEL, SOP_CATEGORY_ORDER } from "@/lib/mrv/ui/sop-meta"
import { Badge, CenteredMessage, LoadError, PageHeader } from "@/components/mrv/ui"
import type { SopCategory, SopListResponse } from "@/lib/mrv/api-types"

const CATEGORY_BADGE: Record<SopCategory, string> = {
  normal: "bg-mrv-green-bg text-mrv-green",
  water_quality: "bg-mrv-amber-bg text-mrv-amber",
  do_drop: "bg-mrv-amber-bg text-mrv-amber",
  mortality_spike: "bg-mrv-red-bg text-mrv-red",
}

export default function SopListPage() {
  const { isPro, isLoading: sessionLoading } = useMrvSession()

  const query = useApiQuery<SopListResponse>(
    (signal) => apiFetch<SopListResponse>("/sop", { signal }),
    [],
    { enabled: isPro },
  )

  const header = (
    <PageHeader
      title="SOP 라이브러리"
      description="정상 운영과 이상 상황(수질 악화 · DO 저하 · 폐사 증가)의 표준 대응 절차"
    />
  )

  if (sessionLoading) return null

  if (!isPro) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
        {header}
        <CenteredMessage>SOP 라이브러리는 PRO 이상 요금제에서 이용할 수 있습니다.</CenteredMessage>
      </div>
    )
  }

  const isUnauthorized = query.error instanceof ApiError && query.error.isUnauthorized
  const items = query.data?.items ?? []
  // 카테고리 순서를 고정해 목록이 매번 같은 자리에서 읽히게 한다.
  const ordered = [...items].sort(
    (a, b) =>
      SOP_CATEGORY_ORDER.indexOf(a.category as SopCategory) -
      SOP_CATEGORY_ORDER.indexOf(b.category as SopCategory),
  )

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      {header}

      {query.isLoading && (
        <div
          role="status"
          aria-label="SOP 목록 불러오는 중"
          className="h-40 animate-pulse rounded-xl border border-mrv-border bg-mrv-surface"
        />
      )}

      {query.isError && !query.isLoading && (
        <LoadError
          message="SOP 목록을 불러오지 못했습니다."
          isUnauthorized={isUnauthorized}
          onRetry={query.refetch}
        />
      )}

      {!query.isLoading && !query.isError && ordered.length === 0 && (
        <CenteredMessage>등록된 SOP 가 없습니다.</CenteredMessage>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ordered.map((sop) => (
          <Link
            key={sop.id}
            href={`/mrv/sop/${encodeURIComponent(sop.id)}`}
            className="flex flex-col gap-2 rounded-xl border border-mrv-border bg-mrv-surface p-5 shadow-sm hover:border-mrv-primary"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-mrv-fg">{sop.title}</h2>
              <Badge className={CATEGORY_BADGE[sop.category as SopCategory]}>
                {SOP_CATEGORY_LABEL[sop.category as SopCategory]}
              </Badge>
            </div>
            <p className="text-xs leading-relaxed text-mrv-muted">{sop.summary}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
