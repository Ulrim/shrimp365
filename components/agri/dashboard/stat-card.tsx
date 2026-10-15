"use client"

// 모니터링 상단 통계 4칸 — 수아 시안 mode-split-ui.md 5-5.
// 아이콘 색·배경은 정적 Tailwind 클래스로 받는다(런타임 생성 클래스는 JIT 가 못 잡는다).
import type { IconComponent } from "@/types"

interface StatCardProps {
  icon: IconComponent
  label: string
  value: string | number
  sub?: string
  /** 아이콘 글자색. 기본 brand-fg(다크 대비 보정 토큰). */
  iconColor?: string
  /** 아이콘 박스 배경. 기본 bg-brand/10. */
  iconBg?: string
}

export function StatCard({ icon: Icon, label, value, sub, iconColor = "text-brand-fg", iconBg = "bg-brand/10" }: StatCardProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 min-w-0 overflow-hidden shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs sm:text-sm text-muted-foreground mb-1 truncate">{label}</p>
          <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-1 truncate">{sub}</p>}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`} aria-hidden="true">
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
      </div>
    </div>
  )
}
