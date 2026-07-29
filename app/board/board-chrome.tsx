"use client"

import { useAuth } from "@/lib/auth-context"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { BottomNav } from "@/components/layout/bottom-nav"
import { PublicHeader, PublicFooter } from "@/components/layout/public-header"

/**
 * 게시판 전용 셸. 로그인 사용자는 일반 대시보드 셸(사이드바·헤더·하단네비)을
 * 그대로 보고, 비로그인 방문자는 공개 헤더(메뉴·언어 전환 포함)를 본다.
 * (게시판은 비로그인 열람이 가능한 대시보드 라우트라 (dashboard)
 *  레이아웃 밖에 있음 — 그래서 이 파일이 로그인 시의 셸을 별도로 복제한다.)
 */
export function BoardChrome({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  // 인증 상태 확정 전에도 본문을 렌더한다. 스피너만 그리면 서버 렌더된
  // 게시글 목록이 초기 HTML에서 빠져 크롤러가 빈 페이지로 인식한다.
  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PublicHeader maxWidth="max-w-3xl" />
        <main className="px-4 py-6">{children}</main>
        <PublicFooter maxWidth="max-w-3xl" />
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
      <PublicHeader maxWidth="max-w-3xl" />
      <main className="px-4 py-6">{children}</main>
      <PublicFooter maxWidth="max-w-3xl" />
    </div>
  )
}
