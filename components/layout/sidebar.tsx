"use client"

import { useState } from "react"
import { SHOW_BOARD, showCardNews } from "@/lib/features"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useT, useAgriT } from "@/lib/i18n-context"
import { BRAND_NAME, isAgriPath } from "@/lib/agri-route"
import { cn } from "@/lib/utils"
import {
  Home, LayoutDashboard, Droplets, BookOpen, Building2,
  BrainCircuit, BarChart3, Settings, LogOut,
  ChevronLeft, ChevronRight, Zap, FlaskConical, Package, ShieldCheck,
  ClipboardList, HelpCircle, MessageSquare, Layers, Radar, Video, Beaker,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SettingsPanel } from "@/components/layout/settings-panel"
import { LanguageSwitcher } from "@/components/ui/language-switcher"
import { isMonitorAccount } from "@/lib/mock-data"
import { localizedHref, stripLocalePrefix } from "@/lib/marketing-locale"
import type { IconComponent } from "@/types"

const DropMark = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.5c4 4.5 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2-6.5 6-11Z" />
  </svg>
)

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()
  const { t, locale } = useT()
  const agri = useAgriT()
  // 농업 화면 판정은 주소로 한다(설계서 mode-split.md 2장). 메뉴는 모드별로
  // **명시 배열**을 둔다 — 새우 배열은 예전 그대로고, 농업 배열은 /daumlabs 리터럴이다.
  const isAgri = isAgriPath(pathname ?? "")
  const [collapsed, setCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const isAdmin = user?.role === "admin" || isMonitorAccount(user?.email)
  // 관제센터는 관리자·매니저만. 노출은 편의일 뿐이고 실제 차단은 서버 API 가 한다.
  const canControl = isAdmin || user?.role === "manager"

  // 두 모드가 함께 보는 항목(게시판·카드뉴스·관제·관리자) — 조건은 예전 그대로.
  // 공개 콘텐츠는 언어별 주소가 따로 있다. 접두사 없는 주소는 한국어로
  // 고정되므로, 로그인한 사용자의 언어에 맞는 주소로 보낸다.
  const SHARED_NAV = [
    ...(SHOW_BOARD ? [{ href: localizedHref("/board", locale),    icon: MessageSquare, label: t.board.title }] : []),
    ...(showCardNews(locale) ? [{ href: localizedHref("/cardnews", locale), icon: Layers,        label: t.cardNews.title }] : []),
    ...(canControl ? [{ href: "/control", icon: Radar, label: "관제센터" }] : []),
    ...(isAdmin ? [{ href: "/admin", icon: ShieldCheck, label: t.nav.admin }] : []),
  ]

  // ── 새우 모드 메뉴(기존 그대로) ──
  const RECORD_NAV = [
    { href: "/record/water-quality", icon: Droplets,       label: t.record.waterQuality },
    { href: "/record/journal",       icon: ClipboardList,  label: t.record.journal },
  ]

  const MONITOR_NAV = [
    { href: "/dashboard",    icon: LayoutDashboard, label: t.nav.dashboard },
    { href: "/water-quality", icon: Droplets,       label: t.nav.waterQuality },
    { href: "/vision",       icon: Video,          label: t.nav.vision },
    { href: "/journal",      icon: BookOpen,        label: t.nav.journal },
    { href: "/farms",        icon: Building2,       label: t.nav.farms },
    { href: "/production",   icon: FlaskConical,    label: t.nav.production },
    { href: "/inventory",    icon: Package,         label: t.nav.inventory },
    { href: "/ai-advisor",   icon: BrainCircuit,    label: t.nav.aiAdvisor },
    { href: "/reports",      icon: BarChart3,       label: t.nav.reports },
    ...SHARED_NAV,
  ]

  // ── 농업 모드 메뉴 — 라벨은 농업 사전(4개 언어), 주소는 /daumlabs 리터럴 ──
  const AGRI_RECORD_NAV = [
    { href: "/daumlabs/record/water-quality", icon: Beaker,        label: agri.nav.recordMeasure },
    { href: "/daumlabs/record/journal",       icon: ClipboardList, label: agri.nav.recordJournal },
  ]

  const AGRI_MONITOR_NAV = [
    { href: "/daumlabs/dashboard",     icon: LayoutDashboard, label: agri.nav.dashboard },
    { href: "/daumlabs/water-quality", icon: Droplets,        label: agri.nav.nutrient },
    { href: "/daumlabs/journal",       icon: BookOpen,        label: agri.nav.journal },
    { href: "/daumlabs/farms",         icon: Building2,       label: agri.nav.farms },
    ...SHARED_NAV,
  ]

  const homeHref = isAgri ? "/daumlabs/home" : "/home"
  // 농업 모드는 Farm365, 새우 모드는 Shrimp365(설계서 1장 결정 3). 마크는 공용.
  const brandName = BRAND_NAME[isAgri ? "agriculture" : "shrimp"]
  const recordNav = isAgri ? AGRI_RECORD_NAV : RECORD_NAV
  const monitorNav = isAgri ? AGRI_MONITOR_NAV : MONITOR_NAV
  const labels = isAgri
    ? { home: agri.nav.home, sectionRecord: agri.nav.sectionRecord, sectionMonitor: agri.nav.sectionMonitor, tagline: agri.nav.brandTagline }
    : { home: t.nav.home, sectionRecord: t.nav.sectionRecord, sectionMonitor: t.nav.sectionMonitor, tagline: t.nav.brandTagline }

  const handleLogout = async () => {
    // logout()이 홈("/")으로 하드 리다이렉트하므로 아래는 fallback.
    await logout()
    router.replace("/")
  }

  const NavItem = ({ href, icon: Icon, label, badge }: { href: string; icon: IconComponent; label: string; badge?: string }) => {
    // 언어 접두사를 뗀 뒤 견준다. /en/cardnews 를 보고 있어도 카드뉴스가
    // 눌린 것으로 표시되어야 한다.
    const here = stripLocalePrefix(pathname).path
    const target = stripLocalePrefix(href).path
    const isActive = here === target || here.startsWith(target + "/")
    return (
      <Link
        href={href}
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group relative",
          isActive
            ? "bg-brand/10 text-brand-fg border border-brand/25"
            : "text-muted-foreground hover:text-foreground hover:bg-accent",
          collapsed && "justify-center px-2"
        )}
      >
        <Icon className={cn("w-5 h-5 shrink-0", isActive ? "text-brand-fg" : "text-muted-foreground group-hover:text-foreground")} />
        {!collapsed && <span className="flex-1">{label}</span>}
        {!collapsed && badge && (
          <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full bg-[#D97706]/12 text-[#B45309] border border-[#D97706]/30 shrink-0">
            {badge}
          </span>
        )}
        {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-brand rounded-r-full" />}
      </Link>
    )
  }

  const SectionLabel = ({ label }: { label: string }) => (
    !collapsed ? (
      <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.15em] text-muted-foreground px-3 pt-3 pb-1">{label}</p>
    ) : <div className="border-t border-border mx-2 my-2" />
  )

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={cn("flex items-center gap-3 px-4 py-5 border-b border-border", collapsed && "justify-center px-2")}>
        <Link href={homeHref} className="flex items-center gap-3">
          <div className="w-9 h-9 border-[1.5px] border-brand text-brand-fg rounded-xl flex items-center justify-center shrink-0">
            <DropMark />
          </div>
          {!collapsed && (
            <div>
              <span className="text-foreground font-bold text-lg tracking-tight">{brandName}</span>
              <p className="text-brand-fg text-[10px] font-mono tracking-[0.15em]">{labels.tagline}</p>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-0.5">
        {/* Home */}
        <NavItem href={homeHref} icon={Home} label={labels.home} />

        {/* Record section */}
        <SectionLabel label={labels.sectionRecord} />
        {recordNav.map(item => <NavItem key={item.href} {...item} />)}

        {/* Monitor section */}
        <SectionLabel label={labels.sectionMonitor} />
        {monitorNav.map(item => <NavItem key={item.href} {...item} />)}
      </nav>

      {/* Bottom */}
      <div className="px-3 pb-4 space-y-1 border-t border-border pt-3">
        <LanguageSwitcher collapsed={collapsed} />

        <Link
          href="/help"
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all",
            pathname === "/help" && "bg-brand/10 text-brand-fg border border-brand/25",
            collapsed && "justify-center"
          )}
        >
          <HelpCircle className="w-5 h-5 shrink-0" />
          {!collapsed && <span>{t.headerX.help}</span>}
        </Link>

        <button
          onClick={() => setSettingsOpen(true)}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all",
            collapsed && "justify-center"
          )}
        >
          <Settings className="w-5 h-5 shrink-0" />
          {!collapsed && <span>{t.nav.settings}</span>}
        </button>

        {/* Free badge */}
        {!collapsed && (
          <div className="px-3 py-2">
            <span className="text-[10px] font-mono font-semibold tracking-wider px-2 py-0.5 rounded-full bg-brand/10 text-brand-fg border border-brand/25">
              FREE
            </span>
          </div>
        )}

        <div className={cn("flex items-center gap-3 px-3 py-2.5", collapsed && "justify-center")}>
          <Avatar className="w-8 h-8 shrink-0">
            <AvatarFallback className="bg-brand text-white text-xs font-semibold">
              {user?.name?.[0] || "U"}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground font-medium truncate">{user?.name}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
          )}
          {!collapsed && (
            <button onClick={handleLogout} className="text-muted-foreground hover:text-destructive transition-colors" aria-label={t.auth.logoutButton}>
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className={cn(
        "hidden lg:flex flex-col bg-card border-r border-border transition-all duration-300 relative h-screen sticky top-0 shrink-0",
        collapsed ? "w-16" : "w-60"
      )}>
        {sidebarContent}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 w-6 h-6 bg-card border border-border rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors z-10"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </aside>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
