"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { modeOfPath } from "@/lib/agri-route"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { BottomNav } from "@/components/layout/bottom-nav"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  // 농업 화면인지는 주소로 결정한다(설계서 3장). 네비게이션마다 다시 렌더되므로
  // /home ↔ /daumlabs/home 전환에 즉시 반응하고, 비동기가 없어 깜빡임이 없다.
  const pathname = usePathname()

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login")
    }
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" data-mode={modeOfPath(pathname ?? "")}>
        <div className="w-10 h-10 border-4 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return null

  // 인쇄(리포트 → PDF 증빙)에서는 앱 크롬을 걷어내고 스크롤 컨테이너를 푼다.
  //
  // 크롬은 display:contents 래퍼로 감싼다. 래퍼는 화면에서 박스를 만들지 않아
  // flex 배치가 그대로고, 인쇄에서만 print:hidden 으로 통째로 사라진다. 사이드바
  // 자체에 print:hidden 을 붙이면 같은 미디어 계열인 lg:flex 와 순서 싸움이 나서
  // 인쇄 폭에 따라 다시 나타날 수 있어 이 방식을 쓴다. 검색·알림·설정 패널도
  // 같은 래퍼 안이라 열려 있는 채로 인쇄해도 찍히지 않는다.
  //
  // 높이·overflow 해제는 app/globals.css 의 @media print 가 맡는다. 여기서
  // print:overflow-visible 로 덮으면 lg:* 와 순서에 의존하게 되기 때문이다.
  //
  // data-mode 는 셸 강조색 토큰(--brand)을 고른다(설계서 mode-split.md 4장).
  // 농업 화면(/daumlabs/**)이면 녹색, 아니면 기존 파랑 그대로다. 설정·알림·검색
  // 패널은 이 div 아래에 렌더되므로 함께 물든다. 농업 뷰는 자기 사전(useAgriT)을
  // 읽으므로 사전 오버라이드 래퍼는 없다(설계서 7장).
  return (
    <div className="min-h-screen flex bg-background" data-mode={modeOfPath(pathname ?? "")}>
      <div className="contents print:hidden">
        <Sidebar />
      </div>
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <div className="contents print:hidden">
          <Header />
        </div>
        <main className="flex-1 overflow-auto p-4 pb-24 lg:p-6 lg:pb-6">
          {children}
        </main>
      </div>
      <div className="contents print:hidden">
        <BottomNav />
      </div>
    </div>
  )
}
