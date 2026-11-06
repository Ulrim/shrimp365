"use client"

// 수질 기록 화면의 작은 조각 — 출처 배지·값 칸·시각 표기.
// 수질 기록 화면(readings-view.tsx)과 사용자 상세의 "최근 수질 기록" 카드가 함께 쓴다.
//
// 콘솔 규칙: 중립색만(출처는 색이 아니라 아이콘·테두리 모양으로 가른다), 숫자는
// tabular-nums, 상태색은 -600 / dark:-400 쌍.
import { Cpu, HelpCircle, PencilLine } from "lucide-react"
import { cn } from "@/lib/utils"
import type { WqSourceKind } from "@/lib/wq-source"
import { SOURCE_LABEL, formatKst, isLateEntry, type AdminReadingRow } from "@/lib/admin-readings"

export const GUESS_TITLE = "기기 구분 기능 이전 기록일 수 있음"

/** 출처 배지 — 수기(진한 테두리)·센서(채움)·수기(추정)(점선 테두리). */
export function SourceBadge({ kind, deviceName, compact }: { kind: WqSourceKind; deviceName?: string; compact?: boolean }) {
  const base = "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border whitespace-nowrap max-w-full"
  if (kind === "manual") {
    return (
      <span className={cn(base, "border-foreground/70 bg-background text-foreground font-semibold")}>
        <PencilLine className="w-3 h-3 shrink-0" aria-hidden="true" />
        {SOURCE_LABEL.manual}
      </span>
    )
  }
  if (kind === "sensor") {
    return (
      <span className={cn(base, "border-border bg-muted text-foreground font-medium")} title={deviceName}>
        <Cpu className="w-3 h-3 shrink-0" aria-hidden="true" />
        {SOURCE_LABEL.sensor}
        {deviceName && !compact && (
          <span className="text-muted-foreground font-normal truncate">· {deviceName}</span>
        )}
      </span>
    )
  }
  return (
    <span className={cn(base, "border-dashed border-foreground/40 text-muted-foreground font-medium")} title={GUESS_TITLE}>
      <HelpCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
      {SOURCE_LABEL.manual_guess}
      <span className="sr-only"> — {GUESS_TITLE}</span>
    </span>
  )
}

/** 값 한 칸 — 빈 값은 "—", 0 은 흐리게(예전 수기 폼이 빈 칸을 0 으로 저장했다). */
export function WqValue({ v, digits = 2 }: { v: number | null; digits?: number }) {
  if (v === null) return <span className="text-muted-foreground/70">—</span>
  if (v === 0) return <span className="text-muted-foreground/70">0</span>
  return <span className="text-foreground">{v.toLocaleString("ko-KR", { maximumFractionDigits: digits })}</span>
}

/** 수조 단위 — 스마트팜은 "베드". */
export function unitOf(farmType: "shrimp" | "agriculture") {
  return farmType === "agriculture" ? "베드" : "수조"
}

/** 측정 시각. 수기 폼은 날짜만 받아 시각이 꾸며낸 값(12:00 등)이라 날짜만 보인다. */
export function RecordedAt({ row }: { row: Pick<AdminReadingRow, "recorded_at" | "source_kind"> }) {
  const full = formatKst(row.recorded_at)
  const text = row.source_kind === "manual" ? full.slice(0, 10) : full
  return (
    <time dateTime={row.recorded_at} title={`${full} (KST)`} className="tabular-nums whitespace-nowrap">
      {text}
    </time>
  )
}

/** "나중 입력" 표시 — 센서 기록에는 달지 않는다(사후 입력 파악은 수기용). */
export function LateEntryMark({ row }: { row: Pick<AdminReadingRow, "recorded_at" | "created_at" | "source_kind"> }) {
  if (row.source_kind === "sensor" || !isLateEntry(row.recorded_at, row.created_at)) return null
  return (
    <span
      className="inline-block text-[11px] font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap"
      title="측정한 날보다 뒤에 입력한 기록"
    >
      나중 입력
    </span>
  )
}
