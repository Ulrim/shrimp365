"use client"

// 콘솔 화면 공통 상태 — 로딩 스피너와 오류·권한 없음·키 미설정 안내.
// 개요·사용자(시스템 모니터링 통계)·관제센터·매니저 관리가 함께 쓴다.
// 색은 콘솔 규칙대로 중립(foreground·muted)뿐이다. 문구 틀은 사용자 상세의
// DetailError(user-detail-view.tsx)와 같다.
import Link from "next/link"
import { usePathname } from "next/navigation"
import { AlertCircle, KeyRound, RefreshCw, ShieldOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"
import { ADMIN_PAGES, adminAccess, adminPageOf } from "@/lib/admin-access"
import { cn } from "@/lib/utils"

export function StatsLoading({ label = "불러오는 중" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center h-64" role="status" aria-label={label}>
      <div className="w-8 h-8 border-4 border-foreground border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

/** 서버 응답 상태 → 화면 분류. 401·403 은 권한, 503 은 서비스 롤 키 미설정, 나머지는 실패. */
export type LoadProblem = "forbidden" | "service_key" | "failed"

export function problemOf(status: number): LoadProblem {
  if (status === 401 || status === 403) return "forbidden"
  if (status === 503) return "service_key"
  return "failed"
}

const TEXT: Record<LoadProblem, { title: string; body: string }> = {
  forbidden: {
    title: "권한이 없습니다",
    body: "이 화면을 볼 권한이 없습니다. 필요하면 총관리자에게 요청하세요.",
  },
  service_key: {
    title: "서비스 롤 키 미설정",
    body: "서버에 SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않아 관리자 데이터를 조회할 수 없습니다.",
  },
  failed: {
    title: "데이터를 불러오지 못했습니다",
    body: "잠시 뒤 다시 시도해 주세요. 계속되면 시스템 진단을 확인해 주세요.",
  },
}

/** 오류 안내. 권한 없음은 다시 시도 대신 "권한 있는 첫 화면" 버튼을 준다(자동 이동 없음).
 *  firstAllowedAdminHref 와 같은 순서로 찾되 지금 화면은 뺀다 — 화면 권한은 있는데
 *  서버가 거절한 경우 같은 주소로 돌아가는 버튼이 되지 않게. 없으면 서비스 홈으로. */
export function LoadProblemView({ problem, onRetry, retrying, body }: {
  problem: LoadProblem
  onRetry?: () => void
  retrying?: boolean
  /** 화면별로 더 구체적인 설명이 있으면 바꿔 넣는다. */
  body?: string
}) {
  const { user } = useAuth()
  const current = adminPageOf(usePathname() ?? "")
  const t = TEXT[problem]
  const Icon = problem === "forbidden" ? ShieldOff : problem === "service_key" ? KeyRound : AlertCircle
  const access = adminAccess(user)
  const other = ADMIN_PAGES.find(p => access[p.key] && p.key !== current)?.href
  const escape = other
    ? { href: other, label: "볼 수 있는 화면으로" }
    : { href: user?.ui_mode === "agriculture" ? "/daumlabs/home" : "/home", label: "서비스로 돌아가기" }

  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 py-16 px-4 rounded-xl border border-border bg-card" role="alert">
      <Icon className="w-10 h-10 text-muted-foreground" aria-hidden="true" />
      <p className="font-semibold text-foreground">{t.title}</p>
      <p className="text-sm text-muted-foreground max-w-sm">{body ?? t.body}</p>
      {problem === "forbidden" ? (
        <Button asChild variant="outline" size="sm" className="border-border min-h-[44px]">
          <Link href={escape.href}>{escape.label}</Link>
        </Button>
      ) : onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={retrying}
          className="border-border gap-2 min-h-[44px]"
        >
          <RefreshCw className={cn("w-4 h-4", retrying && "animate-spin")} aria-hidden="true" />
          다시 시도
        </Button>
      )}
    </div>
  )
}
