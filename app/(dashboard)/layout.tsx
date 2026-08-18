"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { AgriDictOverride } from "@/lib/i18n-context"
import { isAgriPath } from "@/lib/agri-route"
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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-10 h-10 border-4 border-[#1E40AF] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return null

  return (
    <AgriDictOverride enabled={isAgriPath(pathname ?? "")}>
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
    </AgriDictOverride>
  )
}
