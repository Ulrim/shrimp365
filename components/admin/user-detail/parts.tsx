"use client"

// 사용자 상세 화면의 작은 조각들 — 배지·시각 표기·상태 칩·카드 틀.
//
// 콘솔 셸 규칙(설계서 admin-console.md): 중립색만 쓰고 brand·ocean 토큰은 쓰지
// 않는다. 상태색은 emerald(정상)·amber(주의)·red(위험)·slate(비활성) 네 가지,
// 글자는 -600 / dark:-400 쌍. 숫자는 tabular-nums.
import { useEffect, useRef, useState } from "react"
import { Check, Copy, type LucideIcon } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// ─── 라벨 ────────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  admin: "관리자",
  manager: "매니저",
  farmer: "양식어가",
  operator: "운영자",
}
export function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? "뷰어"
}

const PLAN_LABELS: Record<string, string> = { free: "Free", basic: "Basic", pro: "Pro", enterprise: "Enterprise" }
export function planLabel(plan: string) {
  return PLAN_LABELS[plan] ?? plan
}

const PROVIDER_LABELS: Record<string, string> = {
  email: "이메일",
  google: "Google",
  kakao: "카카오",
  naver: "네이버",
  apple: "Apple",
  github: "GitHub",
  phone: "휴대폰",
}
export function providerLabel(p: string) {
  return PROVIDER_LABELS[p] ?? p
}

export function uiModeLabel(mode: "shrimp" | "agriculture" | null) {
  if (mode === "agriculture") return "스마트팜"
  if (mode === "shrimp") return "양식장"
  return "—"
}

// ─── 시각 ────────────────────────────────────────────────────────────────────

/** "3분 전", "2일 전", "4개월 전" … */
export function relTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff)) return "—"
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "방금 전"
  if (mins < 60) return `${mins}분 전`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}시간 전`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}일 전`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}개월 전`
  return `${Math.floor(days / 365)}년 전`
}

export function absTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  })
}

export function absDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("ko-KR")
}

// ─── 배지·칩 ─────────────────────────────────────────────────────────────────

export function NeutralBadge({ children, strong }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap",
        strong ? "bg-foreground text-background border-foreground" : "bg-muted text-foreground border-border",
      )}
    >
      {children}
    </span>
  )
}

export type Tone = "ok" | "warn" | "danger" | "idle"

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
  idle: "text-slate-600 dark:text-slate-400",
}

export const TONE_DOT: Record<Tone, string> = {
  ok: "bg-emerald-600 dark:bg-emerald-400",
  warn: "bg-amber-600 dark:bg-amber-400",
  danger: "bg-red-600 dark:bg-red-400",
  idle: "bg-slate-600 dark:bg-slate-400",
}

export function Dot({ tone, label }: { tone: Tone; label?: string }) {
  return (
    <span
      className={cn("inline-block w-2 h-2 rounded-full shrink-0", TONE_DOT[tone])}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}

/** 수조 상태 칩 — 0 인 상태는 그리지 않는다. */
export function StatusChip({ tone, label, count }: { tone: Tone; label: string; count: number }) {
  if (count <= 0) return null
  return (
    <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md border border-border whitespace-nowrap">
      <Dot tone={tone} />
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold tabular-nums", TONE_TEXT[tone])}>{count}</span>
    </span>
  )
}

// ─── 카드 틀 ─────────────────────────────────────────────────────────────────

export function Section({
  icon: Icon, title, aside, children, className,
}: {
  icon: LucideIcon
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn("bg-card border-border hover:shadow-sm min-w-0", className)}>
      <CardHeader className="p-4 pb-2 flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base text-foreground flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          {title}
        </CardTitle>
        {aside}
      </CardHeader>
      <CardContent className="p-4 pt-2">{children}</CardContent>
    </Card>
  )
}

/** 정의 목록 한 줄 — 라벨 왼쪽, 값 오른쪽. 좁은 화면에서는 값이 줄바꿈된다. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-sm">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-foreground text-right min-w-0 break-words">{children}</dd>
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground text-center py-6">{children}</p>
}

// ─── 복사 버튼 ───────────────────────────────────────────────────────────────

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // 클립보드 권한이 없으면 조용히 넘어간다 — 이메일은 화면에 그대로 보인다.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "복사됨" : label}
      className="inline-flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
      <span className="sr-only" aria-live="polite">{copied ? "복사됨" : ""}</span>
    </button>
  )
}
