"use client"

import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { BottomNav } from "@/components/layout/bottom-nav"

const DropMark = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.5c4 4.5 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2-6.5 6-11Z" />
  </svg>
)

function PublicHeader() {
  const { t } = useT()
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-card/85 backdrop-blur-md">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="w-7 h-7 border-[1.5px] border-[#1E40AF] text-[#1E40AF] rounded-lg flex items-center justify-center">
            <DropMark />
          </span>
          Shrimp365
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/board" className="hidden sm:inline text-muted-foreground hover:text-foreground px-2 py-1.5 transition-colors">
            {t.board.title}
          </Link>
          <Link href="/login" className="text-foreground px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors">
            {t.auth.loginButton}
          </Link>
          <Link href="/signup" className="bg-[#1E40AF] hover:bg-[#3B82F6] text-white px-3 py-1.5 rounded-lg font-semibold transition-colors">
            {t.common.signup}
          </Link>
        </nav>
      </div>
    </header>
  )
}

/**
 * 카드뉴스 전용 셸. 게시판(board-chrome)과 같은 원칙 —
 * 로그인 사용자는 대시보드 셸을, 비로그인 방문자·크롤러는 최소한의 공개 헤더를 본다.
 */
export function CardNewsChrome({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  // 인증 상태가 정해지기 전에도 본문은 반드시 렌더한다.
  // 여기서 스피너만 그리면 서버 렌더된 콘텐츠가 초기 HTML에서 사라져
  // JS를 실행하지 않는 크롤러에게는 빈 페이지로 보인다(색인 실패).
  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="sticky top-0 z-20 border-b border-border bg-card/85 h-14" aria-hidden="true" />
        <main className="px-4 py-6">{children}</main>
      </div>
    )
  }

  if (user) {
    return (
      <div className="min-h-screen flex bg-background">
        <Sidebar />
        <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
          <Header />
          <main className="flex-1 overflow-auto p-4 pb-24 lg:p-6 lg:pb-6">{children}</main>
        </div>
        <BottomNav />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />
      <main className="px-4 py-6">{children}</main>
      <footer className="border-t border-border mt-12">
        <div className="max-w-5xl mx-auto px-4 py-6 text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/" className="hover:text-foreground transition-colors">홈</Link>
          <Link href="/board" className="hover:text-foreground transition-colors">커뮤니티</Link>
          <Link href="/guide" className="hover:text-foreground transition-colors">사용 가이드</Link>
          <Link href="/pricing" className="hover:text-foreground transition-colors">요금제</Link>
          <span className="ml-auto">© CULIVER INC.</span>
        </div>
      </footer>
    </div>
  )
}
