"use client"

// 농업 화면 빈 상태 — 설계서 mode-split.md 5-1.
//
// 아이콘·제목·설명·CTA 한 벌. 농업 농장이 0개면 "농장 등록하기"(→ /daumlabs/farms),
// 측정 데이터가 없으면 "측정값 입력" 같은 식으로 각 뷰가 문구와 링크를 넣는다.
// CTA 는 링크(href)나 버튼(onClick) 둘 중 하나다.
import type { ReactNode } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { IconComponent } from "@/types"

interface AgriEmptyStateProps {
  icon: IconComponent
  title: string
  description?: string
  /** CTA 라벨. href 또는 onClick 과 함께 쓴다. 없으면 CTA 를 그리지 않는다. */
  ctaLabel?: string
  ctaHref?: string
  onCta?: () => void
  /** CTA 자리에 직접 넣을 것이 있을 때(셀렉트·버튼 둘 등). ctaLabel 보다 우선한다. */
  children?: ReactNode
  className?: string
}

export function AgriEmptyState({
  icon: Icon, title, description, ctaLabel, ctaHref, onCta, children, className,
}: AgriEmptyStateProps) {
  const ctaClass =
    "inline-flex items-center justify-center min-h-[44px] px-5 py-2 rounded-xl bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors"
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center text-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-12",
        className,
      )}
    >
      <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center" aria-hidden="true">
        <Icon className="w-7 h-7 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-foreground font-semibold">{title}</p>
        {description && <p className="text-sm text-muted-foreground max-w-sm">{description}</p>}
      </div>
      {children ?? (
        ctaLabel && (ctaHref
          ? <Link href={ctaHref} className={cn(ctaClass, "mt-1")}>{ctaLabel}</Link>
          : <button type="button" onClick={onCta} className={cn(ctaClass, "mt-1")}>{ctaLabel}</button>)
      )}
    </div>
  )
}
