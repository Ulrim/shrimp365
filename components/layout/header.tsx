"use client"

import { useState, useEffect, useCallback } from "react"
import { usePathname } from "next/navigation"
import { Bell, Search } from "lucide-react"
import { SearchPanel } from "@/components/layout/search-panel"
import { NotificationsPanel } from "@/components/layout/notifications-panel"
import { getAlerts } from "@/lib/db"
import { useAutoRefresh } from "@/lib/use-auto-refresh"
import { useAlertNotifications } from "@/lib/use-alert-notifications"
import type { Alert } from "@/types"
import { MOCK_ALERTS, isTestAccount } from "@/lib/mock-data"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { stripLocalePrefix } from "@/lib/marketing-locale"
import { stripAgriPrefix } from "@/lib/agri-route"

const DropMark = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.5c4 4.5 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2-6.5 6-11Z" />
  </svg>
)

export function Header() {
  const pathname = usePathname()
  const { user } = useAuth()
  const { t, locale } = useT()

  const pageLabels: Record<string, string> = {
    "/home":                    t.nav.home,
    "/record":                  t.record.chooseTitle,
    "/record/water-quality":    t.record.waterQuality,
    "/record/journal":          t.record.journal,
    "/dashboard":               t.nav.dashboard,
    "/water-quality":           t.nav.waterQuality,
    "/journal":                 t.nav.journal,
    "/farms":                   t.nav.farms,
    "/diagnosis":               t.nav.diagnosis,
    "/ai-advisor":              t.nav.aiAdvisor,
    "/reports":                 t.nav.reports,
    "/production":              t.nav.production,
    "/inventory":               t.nav.inventory,
    "/cardnews":                t.cardNews.title,
    "/board":                   t.board.title,
    "/admin":                   t.nav.admin,
    "/help":                    t.headerX.help,
  }

  const dateLocale =
    locale === "ko" ? "ko-KR" :
    locale === "vi" ? "vi-VN" :
    locale === "id" ? "id-ID" : "en-US"

  // 언어 접두사와 /daumlabs 접두사를 뗀 뒤 찾는다. /en/cardnews 에서도,
  // /daumlabs/water-quality 에서도 제목이 나와야 한다(라벨은 i18n 이 치환한다).
  const title = pageLabels[stripAgriPrefix(stripLocalePrefix(pathname).path)] || "Shrimp365"

  const [searchOpen, setSearchOpen] = useState(false)
  const [notiOpen, setNotiOpen] = useState(false)
  const [alertCount, setAlertCount] = useState(0)
  const [alerts, setAlerts] = useState<Alert[]>([])

  // 미해결 알림을 불러온다. 개수만이 아니라 목록까지 들고 있어야
  // 새로 생긴 알림을 가려내 기기 알림으로 띄울 수 있다.
  //
  // 첫 로드는 프로미스 체인 안에서 상태를 넣는다 — 효과 본문에서 곧바로
  // setState 하면 렌더가 한 번 더 돈다(home-view 와 같은 방식).
  useEffect(() => {
    let alive = true
    const mockList = () => (isTestAccount(user?.email) ? MOCK_ALERTS.filter(a => !a.resolved) : [])
    getAlerts(true)
      .then(data => {
        if (!alive) return
        const list = data.length ? data : mockList()
        setAlerts(list)
        setAlertCount(list.length)
      })
      .catch(() => {
        if (!alive) return
        const mock = mockList()
        setAlerts(mock)
        setAlertCount(mock.length)
      })
    return () => { alive = false }
  }, [user?.email])

  // 센서가 1분마다 값을 올린다. 알림도 같은 주기로 따라가야 새로 생긴 이상을
  // 새로고침 없이 받는다 — 기기 알림이 의미를 가지려면 이 폴링이 있어야 한다.
  // 실패는 훅이 삼키고 다음 주기에 다시 시도한다.
  const reloadAlerts = useCallback(async () => {
    const data = await getAlerts(true)
    const list = data.length
      ? data
      : (isTestAccount(user?.email) ? MOCK_ALERTS.filter(a => !a.resolved) : [])
    setAlerts(list)
    setAlertCount(list.length)
  }, [user?.email])

  useAutoRefresh(reloadAlerts, 60)

  const { permission: notifyPermission, request: requestNotify } = useAlertNotifications(alerts)

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
      <header className="h-14 lg:h-16 border-b border-border bg-card/80 backdrop-blur-md flex items-center justify-between px-4 lg:px-6 shrink-0">
        {/* Mobile: logo + page title stacked; Desktop: just page title */}
        <div className="flex items-center gap-3 min-w-0 flex-1 mr-2">
          <div className="lg:hidden w-8 h-8 border-[1.5px] border-[#1E40AF] text-[#1E40AF] rounded-xl flex items-center justify-center shrink-0">
            <DropMark />
          </div>
          <div className="min-w-0">
            <h1 className="text-[15px] lg:text-lg font-semibold text-foreground leading-tight truncate tracking-tight">{title}</h1>
            <p className="text-[11px] font-mono text-muted-foreground hidden sm:block tracking-tight">
              {new Date().toLocaleDateString(dateLocale, { year: "numeric", month: "long", day: "numeric", weekday: "short" })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Search */}
          <button
            onClick={() => { setNotiOpen(false); setSearchOpen(v => !v) }}
            className="flex items-center gap-2 w-9 h-9 sm:w-auto sm:px-3 justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title={t.headerX.searchTitle}
          >
            <Search className="w-4 h-4 shrink-0" />
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
              <kbd className="bg-muted border border-border rounded px-1 py-0.5 text-muted-foreground text-[10px]">⌘K</kbd>
            </span>
          </button>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => { setSearchOpen(false); setNotiOpen(v => !v) }}
              className="relative w-9 h-9 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title={t.headerX.notifications}
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
              notifyPermission={notifyPermission}
              onEnableNotify={requestNotify}
            />
          </div>
        </div>
      </header>

      <SearchPanel open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  )
}
