"use client"

import { usePathname } from "next/navigation"
import { Bell, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { MOCK_ALERTS } from "@/lib/mock-data"

const pageLabels: Record<string, string> = {
  "/dashboard": "대시보드",
  "/water-quality": "수질 모니터링",
  "/journal": "양식 일지",
  "/farms": "양식장·수조 관리",
  "/diagnosis": "질병 진단",
  "/ai-advisor": "AI 어드바이저",
  "/reports": "리포트",
}

export function Header() {
  const pathname = usePathname()
  const title = pageLabels[pathname] || "Shrimp365"
  const activeAlerts = MOCK_ALERTS.filter(a => !a.resolved)

  return (
    <header className="h-16 border-b border-white/10 bg-slate-900/50 backdrop-blur-sm flex items-center justify-between px-4 lg:px-6 shrink-0">
      <div>
        <h1 className="text-lg font-semibold text-white">{title}</h1>
        <p className="text-xs text-slate-500 hidden sm:block">
          {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
          <Search className="w-4 h-4" />
        </button>
        <button className="relative w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
          <Bell className="w-4 h-4" />
          {activeAlerts.length > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
          )}
        </button>
      </div>
    </header>
  )
}
