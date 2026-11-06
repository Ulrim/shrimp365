"use client"

// 농업 페이지 상단 공통 머리 — 설계서 mode-split.md 5-1.
//
// 제목·부제·우측 액션 슬롯. 모든 농업 페이지(components/agri/agri-*-view.tsx)가
// 같은 자리·같은 간격으로 시작하게 한다. 강조색은 `brand` 토큰(농업 모드에서 녹색).
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import type { IconComponent } from "@/types"

interface AgriPageHeaderProps {
  title: string
  subtitle?: string
  /** 제목 왼쪽 아이콘(lucide). 없으면 아이콘 칸을 그리지 않는다. */
  icon?: IconComponent
  /** 우측 액션(버튼·셀렉트 등). 모바일에서는 제목 아래로 내려온다. */
  actions?: ReactNode
  className?: string
}

export function AgriPageHeader({ title, subtitle, icon: Icon, actions, className }: AgriPageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="flex items-start gap-3 min-w-0">
        {Icon && (
          <div className="w-10 h-10 shrink-0 rounded-xl bg-brand-a10 text-brand border border-brand-a25 flex items-center justify-center" aria-hidden="true">
            <Icon className="w-5 h-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
    </div>
  )
}
