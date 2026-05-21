"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { getFarms } from "@/lib/db"
import { isTestAccount } from "@/lib/mock-data"
import { ClipboardList, BarChart3 } from "lucide-react"

export default function HomePage() {
  const { user } = useAuth()
  const { t } = useT()
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (!user) return
    if (isTestAccount(user.email)) { setChecking(false); return }
    getFarms()
      .then(farms => {
        if (farms.length === 0) router.replace("/onboarding")
        else setChecking(false)
      })
      .catch(() => setChecking(false))
  }, [user, router])

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-ocean-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const greeting = t.hub.greeting.replace("{{name}}", user?.name?.split(" ")[0] || "")

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] py-10 px-4">
      <div className="w-full max-w-lg space-y-8">
        {/* Greeting */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{greeting}</h1>
          <p className="text-muted-foreground text-sm sm:text-base">오늘도 건강한 양식장을 위해 시작해볼까요?</p>
        </div>

        {/* Two big action cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            href="/record"
            className="group flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-ocean-200 bg-ocean-50 hover:bg-ocean-100 hover:border-ocean-400 transition-all duration-200 py-12 px-6 text-center shadow-sm hover:shadow-md"
          >
            <div className="w-16 h-16 rounded-2xl bg-ocean-500 flex items-center justify-center text-white group-hover:scale-110 transition-transform">
              <ClipboardList className="w-8 h-8" />
            </div>
            <div>
              <p className="text-lg sm:text-2xl font-bold text-ocean-700">📝 {t.hub.recordButton}</p>
              <p className="text-xs sm:text-sm text-ocean-500 mt-1">수질·양식 일지 입력</p>
            </div>
          </Link>

          <Link
            href="/dashboard"
            className="group flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-teal-200 bg-teal-50 hover:bg-teal-100 hover:border-teal-400 transition-all duration-200 py-12 px-6 text-center shadow-sm hover:shadow-md"
          >
            <div className="w-16 h-16 rounded-2xl bg-teal-500 flex items-center justify-center text-white group-hover:scale-110 transition-transform">
              <BarChart3 className="w-8 h-8" />
            </div>
            <div>
              <p className="text-lg sm:text-2xl font-bold text-teal-700">📊 {t.hub.monitorButton}</p>
              <p className="text-xs sm:text-sm text-teal-500 mt-1">수질·알림·통계 확인</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
