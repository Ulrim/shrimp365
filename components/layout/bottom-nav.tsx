"use client"

import { useState } from "react"
import { SHOW_BOARD, showCardNews } from "@/lib/features"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useT, useAgriT } from "@/lib/i18n-context"
import { isAgriPath } from "@/lib/agri-route"
import { cn } from "@/lib/utils"
import {
  Home, LayoutDashboard, Droplets, ClipboardList,
  MoreHorizontal, Building2, FlaskConical, Package,
  BarChart3, Settings, LogOut, ShieldCheck, ChevronRight, BookOpen, BrainCircuit, MessageSquare, Layers, Video, HelpCircle, Beaker,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SettingsPanel } from "@/components/layout/settings-panel"
import { ModeSwitch } from "@/components/layout/mode-switch"
import { PLAN_LABELS, PLAN_COLORS } from "@/lib/plans"
import { adminAccess } from "@/lib/admin-access"
import { localizedHref, stripLocalePrefix } from "@/lib/marketing-locale"

export function BottomNav() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()
  const { t, locale } = useT()
  const agri = useAgriT()
  // 농업 화면 판정은 주소로 한다(설계서 mode-split.md 2장). 메뉴는 모드별로
  // **명시 배열**을 둔다 — 새우 배열은 예전 그대로고, 농업 배열은 /daumlabs 리터럴이다.
  const isAgri = isAgriPath(pathname ?? "")
  const [moreOpen, setMoreOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 관리자 콘솔 링크 — 콘솔 가드와 같은 판정(lib/admin-access.ts, 총관리자 이메일 포함).
  const showConsole = adminAccess(user).console

  // 두 모드가 함께 보는 항목(게시판·카드뉴스) — 조건은 예전 그대로.
  // 관제센터·시스템 모니터링은 관리자 콘솔(/admin)로 옮겼다 — 아래 동작 목록의 링크 하나로 들어간다.
  // 공개 콘텐츠는 언어별 주소가 따로 있다. 접두사 없는 주소는 한국어로
  // 고정되므로, 로그인한 사용자의 언어에 맞는 주소로 보낸다.
  const SHARED_MORE = [
    ...(SHOW_BOARD ? [{ href: localizedHref("/board", locale),    icon: MessageSquare, label: t.board.title }] : []),
    ...(showCardNews(locale) ? [{ href: localizedHref("/cardnews", locale), icon: Layers,        label: t.cardNews.title }] : []),
  ]

  // ── 새우 모드(기존 그대로) ──
  const PRIMARY = [
    { href: "/home",               icon: Home,          label: t.nav.home },
    { href: "/record/water-quality", icon: Droplets,    label: t.record.waterQuality },
    { href: "/record/journal",     icon: ClipboardList, label: t.record.journal },
    { href: "/dashboard",          icon: LayoutDashboard, label: t.nav.dashboard },
  ]

  const MORE = [
    { href: "/water-quality", icon: Droplets,      label: t.nav.waterQuality },
    { href: "/vision",        icon: Video,         label: t.nav.vision },
    { href: "/journal",       icon: BookOpen,      label: t.nav.journal },
    { href: "/farms",         icon: Building2,     label: t.nav.farms },
    { href: "/production",    icon: FlaskConical,  label: t.nav.production },
    { href: "/inventory",     icon: Package,       label: t.nav.inventory },
    { href: "/ai-advisor",    icon: BrainCircuit,  label: t.nav.aiAdvisor },
    { href: "/reports",       icon: BarChart3,     label: t.nav.reports },
    ...SHARED_MORE,
  ]

  // ── 농업 모드 — 라벨은 농업 사전(4개 언어), 주소는 /daumlabs 리터럴 ──
  const AGRI_PRIMARY = [
    { href: "/daumlabs/home",                 icon: Home,            label: agri.nav.home },
    { href: "/daumlabs/record/water-quality", icon: Beaker,          label: agri.nav.recordMeasure },
    { href: "/daumlabs/record/journal",       icon: ClipboardList,   label: agri.nav.recordJournal },
    { href: "/daumlabs/dashboard",            icon: LayoutDashboard, label: agri.nav.dashboard },
  ]

  const AGRI_MORE = [
    { href: "/daumlabs/water-quality", icon: Droplets,  label: agri.nav.nutrient },
    { href: "/daumlabs/journal",       icon: BookOpen,  label: agri.nav.journal },
    { href: "/daumlabs/farms",         icon: Building2, label: agri.nav.farms },
    ...SHARED_MORE,
  ]

  const primary = isAgri ? AGRI_PRIMARY : PRIMARY
  const more = isAgri ? AGRI_MORE : MORE
  const moreLabel = isAgri ? agri.nav.more : "더보기"

  // 언어 접두사를 뗀 뒤 견준다. /en/cardnews 도 "더보기" 안의 항목이다.
  const here = stripLocalePrefix(pathname).path
  const isMoreActive = more.some((item) => {
    const target = stripLocalePrefix(item.href).path
    return here === target || here.startsWith(target + "/")
  })

  const handleLogout = async () => {
    setMoreOpen(false)
    // logout()이 홈("/")으로 하드 리다이렉트하므로 아래는 fallback.
    await logout()
    router.replace("/")
  }

  return (
    <>
      {/* ── Bottom Tab Bar ───────────────────────────────────── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-xl border-t border-border">
        <div className="flex items-stretch h-16 pb-safe">
          {primary.map((item) => {
            const to = item.href
            const active = pathname === to || pathname.startsWith(to + "/")
            return (
              <Link
                key={item.href}
                href={to}
                className="relative flex-1 flex flex-col items-center justify-center gap-1 min-h-[44px] transition-colors px-1"
              >
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-brand rounded-b-full" />
                )}
                <item.icon className={cn("w-5 h-5 shrink-0 transition-transform", active ? "text-brand-fg scale-110" : "text-muted-foreground")} />
                <span className={cn("text-[10px] font-medium leading-none truncate w-full text-center", active ? "text-brand-fg" : "text-muted-foreground")}>
                  {item.label}
                </span>
              </Link>
            )
          })}

          {/* More */}
          <button
            onClick={() => setMoreOpen(true)}
            className="relative flex-1 flex flex-col items-center justify-center gap-1 min-h-[44px] px-1"
          >
            {isMoreActive && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-brand rounded-b-full" />
            )}
            <MoreHorizontal className={cn("w-5 h-5 shrink-0", isMoreActive ? "text-brand-fg" : "text-muted-foreground")} />
            <span className={cn("text-[10px] font-medium leading-none truncate w-full text-center", isMoreActive ? "text-brand-fg" : "text-muted-foreground")}>
              {moreLabel}
            </span>
          </button>
        </div>
      </nav>

      {/* ── More Sheet ───────────────────────────────────────── */}
      {moreOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 bg-black/40 z-50 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
          />
          <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-card rounded-t-3xl border-t border-border animate-in slide-in-from-bottom duration-300">
            {/* Handle bar */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-border rounded-full" />
            </div>

            {/* Profile row */}
            <div className="flex items-center gap-3 px-5 py-3 mb-1">
              <Avatar className="w-11 h-11 shrink-0">
                <AvatarFallback className="bg-brand text-white font-semibold">
                  {user?.name?.[0] || "U"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground font-semibold truncate">{user?.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>
              <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full shrink-0", PLAN_COLORS[user?.plan ?? "free"])}>
                {PLAN_LABELS[user?.plan ?? "free"]}
              </span>
            </div>

            {/* 양식장 ↔ 스마트팜 전환(설계서 mode-split.md 3장). 헤더 스위치는
                sm 미만에서 숨기므로 휴대폰에서는 이 자리가 유일한 전환 수단이다. */}
            <ModeSwitch variant="sheet" onSwitched={() => setMoreOpen(false)} />

            {/* Nav items */}
            <div className="px-4 space-y-1">
              {more.map((item) => {
                const to = item.href
                const active = pathname === to || pathname.startsWith(to + "/")
                return (
                  <Link
                    key={item.href}
                    href={to}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all",
                      active
                        ? "bg-brand-a10 text-brand-fg border border-brand-a25"
                        : "text-foreground active:bg-accent"
                    )}
                  >
                    <item.icon className={cn("w-5 h-5", active ? "text-brand-fg" : "text-muted-foreground")} />
                    <span className="flex-1 font-medium text-[15px]">{item.label}</span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </Link>
                )
              })}
            </div>

            {/* Bottom actions */}
            <div className="px-4 pt-2 pb-6 mt-2 border-t border-border space-y-1">
              {/* 관리자 콘솔 — 관리자·매니저만(사이드바와 같은 자리: 도움말 위). */}
              {showConsole && (
                <Link
                  href="/admin"
                  onClick={() => setMoreOpen(false)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-foreground active:bg-accent transition-all"
                >
                  <ShieldCheck className="w-5 h-5 text-muted-foreground" />
                  <span className="flex-1 font-medium text-[15px] text-left">{isAgri ? agri.nav.adminConsole : t.nav.adminConsole}</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </Link>
              )}
              {/* 도움말은 사이드바에만 있어 휴대폰에서는 갈 길이 없었다.
                  사이드바와 같은 자리(설정 위)에 둔다. */}
              <Link
                href="/help"
                onClick={() => setMoreOpen(false)}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-foreground active:bg-accent transition-all"
              >
                <HelpCircle className="w-5 h-5 text-muted-foreground" />
                <span className="flex-1 font-medium text-[15px] text-left">{t.headerX.help}</span>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </Link>
              <button
                onClick={() => { setMoreOpen(false); setSettingsOpen(true) }}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-foreground active:bg-accent transition-all"
              >
                <Settings className="w-5 h-5 text-muted-foreground" />
                <span className="flex-1 font-medium text-[15px] text-left">{t.nav.settings}</span>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-destructive active:bg-destructive/10 transition-all"
              >
                <LogOut className="w-5 h-5" />
                <span className="flex-1 font-medium text-[15px] text-left">{t.auth.logoutButton}</span>
              </button>
            </div>
          </div>
        </>
      )}

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
