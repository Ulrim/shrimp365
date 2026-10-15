"use client"

// 모드 전환 스위치 — 설계서 mode-split.md 3장.
//
// 세그먼트 토글 2칸: 왼쪽 Waves "양식장", 오른쪽 Sprout "스마트팜". 활성 칸은
// **URL 기준**(지금 보는 화면)이고, 누르면 ui_mode 저장 → 상대 화면으로 이동한다.
// 저장이 실패해도 이동은 한다(URL 이 화면을 결정한다).
//
// 세 자리에 장착된다 — variant 로 모양만 다르고 동작은 같다:
//   header   : 헤더 우측(검색 버튼 왼쪽), sm 이상. 아이콘+라벨.
//   sheet    : 하단 네비 "더보기" 시트 프로필 행 아래. 전체 폭.
//   settings : 설정 패널 계정 탭 맨 위. 라벨 "기본 화면" + 세그먼트 + 한 줄 설명.
import { useState } from "react"
import { Waves, Sprout } from "lucide-react"
import { cn } from "@/lib/utils"
import { useUiMode, type UiMode } from "@/lib/agri-route"
import { useAgriT } from "@/lib/i18n-context"
import type { IconComponent } from "@/types"

interface ModeSwitchProps {
  variant: "header" | "sheet" | "settings"
  /** 시트에서 항목을 누르면 시트를 닫아야 한다 — 이동 직후 호출된다. */
  onSwitched?: () => void
  className?: string
}

export function ModeSwitch({ variant, onSwitched, className }: ModeSwitchProps) {
  const { current, switchTo } = useUiMode()
  const { common } = useAgriT()
  const [busy, setBusy] = useState(false)

  const SEGMENTS: { mode: UiMode; icon: IconComponent; label: string }[] = [
    { mode: "shrimp",      icon: Waves,  label: common.modeShrimp },
    { mode: "agriculture", icon: Sprout, label: common.modeAgri },
  ]

  const onPick = async (mode: UiMode) => {
    if (busy || mode === current) return
    setBusy(true)
    try {
      await switchTo(mode)
      onSwitched?.()
    } finally {
      setBusy(false)
    }
  }

  const segment = (
    <div
      role="group"
      aria-label={common.modeSwitchAria}
      className={cn(
        "inline-flex items-stretch rounded-xl border border-border bg-muted/60 p-0.5",
        variant === "header" ? "h-9" : "w-full h-11",
      )}
    >
      {SEGMENTS.map(({ mode, icon: Icon, label }) => {
        const active = mode === current
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={active}
            disabled={busy}
            onClick={() => onPick(mode)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-[10px] font-medium transition-colors min-w-0",
              variant === "header" ? "px-3 text-xs" : "flex-1 px-3 text-sm",
              active
                ? "bg-brand text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              busy && "cursor-wait",
            )}
          >
            <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </button>
        )
      })}
    </div>
  )

  if (variant === "settings") {
    return (
      <div className={cn("space-y-2", className)}>
        <p className="text-sm font-medium text-foreground">{common.defaultScreenLabel}</p>
        {segment}
        <p className="text-xs text-muted-foreground">{common.defaultScreenHint}</p>
      </div>
    )
  }

  if (variant === "sheet") {
    return <div className={cn("px-5 pb-2", className)}>{segment}</div>
  }

  return <div className={cn("hidden sm:flex", className)}>{segment}</div>
}
