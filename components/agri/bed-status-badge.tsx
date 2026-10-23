"use client"

// 베드·항목 상태 배지 — 설계서 mode-split.md 5-1.
//
// 색 + 점 + 텍스트를 **함께** 쓴다(색만으로 뜻을 전하지 않는다). 주의·위험만
// 깜빡이고, "미측정"·"기준 없음" 중립은 깜빡이지 않는다 — 깜빡이면 "뭔가 문제"로
// 읽히기 때문이다. 스타일은 lib/agri-standards.ts 의 AGRI_STATUS_STYLES 한 벌이고,
// 라벨은 농업 사전(common.status)이라 4개 언어에서 모두 농업 어휘로 나온다.
import { cn } from "@/lib/utils"
import { useAgriT } from "@/lib/i18n-context"
import { AGRI_STATUS_STYLES, agriStatusPulses, type AgriStatusLevel } from "@/lib/agri-standards"
import type { AgriCommonDict } from "@/lib/i18n/agri/common"

/** AgriStatusLevel(한국어 리터럴) → 사전 키. 판정 함수는 리터럴을 돌려주고
 *  화면은 사전을 읽는다 — 둘을 잇는 표는 여기 한 곳이다. */
const DICT_KEY: Record<AgriStatusLevel, keyof AgriCommonDict["status"]> = {
  정상: "normal",
  주의: "warning",
  위험: "danger",
  미측정: "notMeasured",
  기준없음: "noStandard",
}

/** 상태 라벨 문자열만 필요할 때(차트 범례·aria 등). */
export function useAgriStatusLabel(): (status: AgriStatusLevel) => string {
  const { common } = useAgriT()
  return (status) => common.status[DICT_KEY[status]]
}

interface BedStatusBadgeProps {
  status: AgriStatusLevel
  /** sm = 카드 타일 안(기본), md = 페이지 상단·목록 행. */
  size?: "sm" | "md"
  className?: string
}

export function BedStatusBadge({ status, size = "sm", className }: BedStatusBadgeProps) {
  const label = useAgriStatusLabel()(status)
  const style = AGRI_STATUS_STYLES[status]
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        style.bg,
        style.text,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "shrink-0 rounded-full",
          size === "sm" ? "w-1.5 h-1.5" : "w-2 h-2",
          style.dot,
          agriStatusPulses(status) && "animate-pulse",
        )}
      />
      {label}
    </span>
  )
}
