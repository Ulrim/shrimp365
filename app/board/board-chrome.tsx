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

function PublicBoardHeader() {
  const { t } = useT()
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-card/85 backdrop-blur-md">
      <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="w-7 h-7 border-[1.5px] border-[#1E40AF] text-[#1E40AF] rounded-lg flex items-center justify-center">
            <DropMark />
          </span>
          Shrimp365
        </Link>
        <div className="flex items-center gap-2 text-sm">
          <Link href="/login" className="text-foreground px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors">
            {t.auth.loginButton}
          </Link>
          <Link href="/signup" className="bg-[#1E40AF] hover:bg-[#3B82F6] text-white px-3 py-1.5 rounded-lg font-semibold transition-colors">
            {t.common.signup}
          </Link>
        </div>
      </div>
    </header>
  )
}

/**
 * 게시판 전용 셸. 로그인 사용자는 일반 대시보드 셸(사이드바·헤더·하단네비)을
 * 그대로 보고, 비로그인 방문자는 최소한의 공개 헤더만 본다.
 * (게시판은 비로그인 열람이 가능한 유일한 대시보드 라우트라 (dashboard)
 *  레이아웃 밖에 있음 — 그래서 이 파일이 로그인 시의 셸을 별도로 복제한다.)
 */
export function BoardChrome({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-10 h-10 border-4 border-[#1E40AF] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (user) {
    return (
      <div className="min-h-screen flex bg-background">
        <Sidebar />
        <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
          <Header />
          <main className="flex-1 overflow-auto p-4 pb-24 lg:p-6 lg:pb-6">
            {children}
          </main>
        </div>
        <BottomNav />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicBoardHeader />
      <main className="px-4 py-6">{children}</main>
    </div>
  )
}
