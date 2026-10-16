"use client"

// 관리자 콘솔 셸(설계서 admin-console.md 4장).
//
// 농가 셸(사이드바·하단 메뉴·모드 스위치·brand 테마)을 쓰지 않는다. 색은 중립
// (slate·foreground)뿐이고 활성 항목만 bg-foreground 로 뒤집는다 — 농가 화면과
// 한눈에 구별되게. 콘솔은 내부 운영 도구라 한국어 전용이다.
//
// 인쇄에서는 크롬을 걷어낸다. (dashboard)/layout.tsx 와 같은 이유로 display:contents
// 래퍼에 print:hidden 을 건다 — lg:flex 와 순서 싸움을 피하려는 것이다.
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ShieldCheck, ArrowLeft, LogOut } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { isMonitorAccount, isTestAccount } from "@/lib/mock-data"
import { firstAllowedAdminHref, isSuperAdminEmail, type AdminAccess } from "@/lib/admin-access"
import { AdminNav, adminPageTitle } from "@/components/admin/admin-nav"

function roleLabel(user: { email: string; role: string }): string | null {
  if (isSuperAdminEmail(user.email)) return "총관리자"
  if (user.role === "admin") return "관리자"
  if (user.role === "manager") return "매니저"
  if (isMonitorAccount(user.email) || isTestAccount(user.email)) return "모니터"
  return null
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-foreground text-background flex items-center justify-center shrink-0">
        <ShieldCheck className="w-4 h-4" aria-hidden="true" />
      </div>
      <div className="leading-tight">
        <p className="text-foreground font-bold tracking-tight">Shrimp365</p>
        <p className="text-[10px] font-mono font-semibold tracking-[0.2em] text-muted-foreground">ADMIN</p>
      </div>
    </div>
  )
}

export function AdminShell({ access, children }: { access: AdminAccess; children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const router = useRouter()
  const pathname = usePathname() ?? ""
  const title = adminPageTitle(pathname)
  const badge = user ? roleLabel(user) : null
  // 모니터·테스트(데모) 계정은 개요·사용자·수질 기록에 목데이터를 본다 — 실제 수치로 오해하지 않게 띠를 단다.
  const isDemo = isMonitorAccount(user?.email) || isTestAccount(user?.email)
  const serviceHref = user?.ui_mode === "agriculture" ? "/daumlabs/home" : "/home"

  const handleLogout = async () => {
    // logout()이 홈("/")으로 하드 리다이렉트하므로 아래는 fallback(농가 셸과 같다).
    await logout()
    router.replace("/")
  }

  const identity = (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-muted-foreground truncate">{user?.email}</span>
      {badge && (
        <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border border-border text-foreground bg-muted">
          {badge}
        </span>
      )}
    </div>
  )

  return (
    <div className="min-h-screen flex bg-background">
      {/* 데스크톱 사이드바 */}
      <div className="contents print:hidden">
        <aside className="hidden lg:flex flex-col w-56 shrink-0 h-screen sticky top-0 bg-card border-r border-border">
          <div className="px-4 py-5 border-b border-border">
            <Link href={firstAllowedAdminHref(access) ?? "/admin"} aria-label="관리자 콘솔 처음으로">
              <Brand />
            </Link>
          </div>
          <AdminNav access={access} variant="sidebar" />
          <div className="px-3 pb-4 pt-3 border-t border-border space-y-0.5">
            <Link
              href={serviceHref}
              className="flex items-center gap-3 px-3 min-h-[44px] rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
              서비스로 돌아가기
            </Link>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 min-h-[44px] rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
            >
              <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
              로그아웃
            </button>
          </div>
        </aside>
      </div>

      <div className="flex-1 flex flex-col min-h-screen min-w-0 overflow-hidden">
        <div className="contents print:hidden">
          {/* 모바일 상단바 + 가로 스크롤 탭 */}
          <header className="lg:hidden bg-card border-b border-border">
            <div className="flex items-center justify-between gap-3 px-4 h-14">
              <Brand />
              <div className="flex items-center gap-1">
                <Link
                  href={serviceHref}
                  aria-label="서비스로 돌아가기"
                  className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                </Link>
                <button
                  onClick={handleLogout}
                  aria-label="로그아웃"
                  className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-accent"
                >
                  <LogOut className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
            </div>
            {/* 제목(h1)은 셸에만 하나 — 모바일 화면에서는 탭이 제목 구실을 하니 스크린리더용으로만 둔다. */}
            <h1 className="sr-only">{title}</h1>
            <div className="px-4 pb-2">{identity}</div>
            <AdminNav access={access} variant="tabs" />
          </header>

          {/* 데스크톱 머리 */}
          <header className="hidden lg:flex items-center justify-between gap-4 h-16 px-6 bg-card border-b border-border">
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>
            {identity}
          </header>

          {isDemo && (
            <div className="px-4 lg:px-6 py-1.5 text-xs font-medium text-center bg-muted text-foreground border-b border-border" role="note">
              데모 데이터 — 이 계정의 개요·사용자·수질 기록 화면은 실제 운영 수치가 아닌 예시입니다
            </div>
          )}
        </div>

        <main className="flex-1 overflow-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  )
}
