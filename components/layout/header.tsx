"use client"

import { useState, useEffect } from "react"
import { usePathname } from "next/navigation"
import { Bell, Search } from "lucide-react"
import { SearchPanel } from "@/components/layout/search-panel"
import { NotificationsPanel } from "@/components/layout/notifications-panel"
import { getAlerts } from "@/lib/db"
import { MOCK_ALERTS, isTestAccount } from "@/lib/mock-data"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"

export function Header() {
  const pathname = usePathname()
  const { user } = useAuth()
  const { t } = useT()

  const pageLabels: Record<string, string> = {
    "/dashboard":     t.nav.dashboard,
    "/water-quality": t.nav.waterQuality,
    "/journal":       t.nav.journal,
    "/farms":         t.nav.farms,
    "/diagnosis":     t.nav.diagnosis,
    "/ai-advisor":    t.nav.aiAdvisor,
    "/reports":       t.nav.reports,
    "/admin":         t.nav.admin,
  }

  const title = pageLabels[pathname] || "Shrimp365"

  const [searchOpen, setSearchOpen] = useState(false)
  const [notiOpen, setNotiOpen] = useState(false)
  const [alertCount, setAlertCount] = useState(0)

  // Load unread alert count on mount
  useEffect(() => {
    async function loadCount() {
      try {
        const data = await getAlerts(true)
        const count = data.length
          ? data.length
          : (isTestAccount(user?.email) ? MOCK_ALERTS.filter(a => !a.resolved).length : 0)
        setAlertCount(count)
      } catch {
        if (isTestAccount(user?.email)) {
          setAlertCount(MOCK_ALERTS.filter(a => !a.resolved).length)
        }
      }
    }
    loadCount()
  }, [user?.email])

  // Global Cmd+K / Ctrl+K shortcut for search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setNotiOpen(false)
        setSearchOpen(v => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <>
      <header className="h-16 border-b border-white/10 bg-slate-900/50 backdrop-blur-sm flex items-center justify-between px-4 lg:px-6 shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white">{title}</h1>
          <p className="text-xs text-slate-500 hidden sm:block">
            {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}
          </p>
        </div>

        <div className="flex items-center gap-1">
          {/* Search */}
          <button
            onClick={() => { setNotiOpen(false); setSearchOpen(v => !v) }}
            className="flex items-center gap-2 w-9 h-9 sm:w-auto sm:px-3 justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            title="검색 (Ctrl+K)"
          >
            <Search className="w-4 h-4 shrink-0" />
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500">
              <kbd className="bg-slate-800 border border-white/10 rounded px-1 py-0.5 text-slate-600 text-[10px]">⌘K</kbd>
            </span>
          </button>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => { setSearchOpen(false); setNotiOpen(v => !v) }}
              className="relative w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
              title="알림"
            >
              <Bell className="w-4 h-4" />
              {alertCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-[9px] font-bold px-0.5">
                  {alertCount > 9 ? "9+" : alertCount}
                </span>
              )}
            </button>
            <NotificationsPanel
              open={notiOpen}
              onClose={() => setNotiOpen(false)}
              onCountChange={setAlertCount}
            />
          </div>
        </div>
      </header>

      <SearchPanel open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  )
}
