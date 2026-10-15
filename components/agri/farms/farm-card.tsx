"use client"

// 농장 카드(농업 화면 왼쪽 목록) — 수아 시안 mode-split-ui.md 5-8 "농장 카드".
//
// 누르면 선택 농장이 바뀐다(aria-pressed). 두 번째 줄은 "베드 4 · 정상 3 · 주의 1" —
// 0 인 상태는 생략, 위험은 빨간 글자. 교차 링크("양식장 화면 열기")는 없다.
import { Building2 } from "lucide-react"
import { useAgriT } from "@/lib/i18n-context"
import { cn } from "@/lib/utils"
import type { Farm, Tank } from "@/types"
import { fill } from "./form-styles"

export function FarmCard({ farm, tanks, selected, onSelect }: {
  farm: Farm
  tanks: Tank[]
  selected: boolean
  onSelect: () => void
}) {
  const { farms: d, common } = useAgriT()
  const normal = tanks.filter(tk => tk.status === "active").length
  const warning = tanks.filter(tk => tk.status === "warning").length
  const danger = tanks.filter(tk => tk.status === "danger").length

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "w-full text-left rounded-xl border p-4 min-h-[44px] transition-colors duration-200 motion-reduce:transition-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected
          ? "bg-brand/10 border-brand/40 ring-1 ring-brand/20"
          : "bg-muted border-border hover:bg-accent",
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={cn(
            "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
            selected ? "bg-brand/20 text-brand-fg" : "bg-background text-muted-foreground",
          )}
          aria-hidden="true"
        >
          <Building2 className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-foreground font-semibold text-sm truncate">{farm.name}</p>
          <p className="text-xs text-muted-foreground tabular-nums truncate">
            {fill(d.bedCountN, { n: tanks.length })}
            {normal > 0 && <> · {common.status.normal} {normal}</>}
            {warning > 0 && <> · <span className="text-amber-600 dark:text-amber-400">{common.status.warning} {warning}</span></>}
            {danger > 0 && <> · <span className="text-red-600 dark:text-red-400 font-medium">{common.status.danger} {danger}</span></>}
          </p>
        </div>
      </div>
    </button>
  )
}
