"use client"

import { useAuth } from "@/lib/auth-context"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { BottomNav } from "@/components/layout/bottom-nav"
import { PublicHeader, PublicFooter } from "@/components/layout/public-header"

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
        <PublicHeader />
        <main className="px-4 py-6">{children}</main>
        <PublicFooter />
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
      <PublicFooter />
    </div>
  )
}
