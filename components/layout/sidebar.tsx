"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { cn } from "@/lib/utils"
import {
  Home, LayoutDashboard, Droplets, BookOpen, Building2,
  BrainCircuit, BarChart3, Settings, LogOut,
  ChevronLeft, ChevronRight, Zap, FlaskConical, Package, ShieldCheck,
  ClipboardList, HelpCircle, MessageSquare, Layers,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SettingsPanel } from "@/components/layout/settings-panel"
import { LanguageSwitcher } from "@/components/ui/language-switcher"
import { isMonitorAccount } from "@/lib/mock-data"
import { localizedHref, stripLocalePrefix } from "@/lib/marketing-locale"

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
  const [collapsed, setCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const isAdmin = user?.role === "admin" || isMonitorAccount(user?.email)

  const RECORD_NAV = [
    { href: "/record/water-quality", icon: Droplets,       label: t.record.waterQuality },
    { href: "/record/journal",       icon: ClipboardList,  label: t.record.journal },
  ]

  const MONITOR_NAV = [
    { href: "/dashboard",    icon: LayoutDashboard, label: t.nav.dashboard },
    { href: "/water-quality", icon: Droplets,       label: t.nav.waterQuality },
    { href: "/journal",      icon: BookOpen,        label: t.nav.journal },
    { href: "/farms",        icon: Building2,       label: t.nav.farms },
    { href: "/production",   icon: FlaskConical,    label: t.nav.production },
    { href: "/inventory",    icon: Package,         label: t.nav.inventory },
    { href: "/ai-advisor",   icon: BrainCircuit,    label: t.nav.aiAdvisor, badge: t.common.comingSoon },
    { href: "/reports",      icon: BarChart3,       label: t.nav.reports },
    // 공개 콘텐츠는 언어별 주소가 따로 있다. 접두사 없는 주소는 한국어로
    // 고정되므로, 로그인한 사용자의 언어에 맞는 주소로 보낸다.
    { href: localizedHref("/board", locale),    icon: MessageSquare, label: t.board.title },
    { href: localizedHref("/cardnews", locale), icon: Layers,        label: t.cardNews.title },
    ...(isAdmin ? [{ href: "/admin", icon: ShieldCheck, label: t.nav.admin }] : []),
  ]

  const handleLogout = async () => {
    // logout()이 홈("/")으로 하드 리다이렉트하므로 아래는 fallback.
    await logout()
    router.replace("/")
  }

  const NavItem = ({ href, icon: Icon, label, badge }: { href: string; icon: React.ElementType; label: string; badge?: string }) => {
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
            ? "bg-[#1E40AF]/10 text-[#1E40AF] border border-[#1E40AF]/25"
            : "text-muted-foreground hover:text-foreground hover:bg-accent",
          collapsed && "justify-center px-2"
        )}
      >
        <Icon className={cn("w-5 h-5 shrink-0", isActive ? "text-[#1E40AF]" : "text-muted-foreground group-hover:text-foreground")} />
        {!collapsed && <span className="flex-1">{label}</span>}
        {!collapsed && badge && (
          <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full bg-[#D97706]/12 text-[#B45309] border border-[#D97706]/30 shrink-0">
            {badge}
          </span>
        )}
        {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-[#1E40AF] rounded-r-full" />}
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
        <Link href="/home" className="flex items-center gap-3">
          <div className="w-9 h-9 border-[1.5px] border-[#1E40AF] text-[#1E40AF] rounded-xl flex items-center justify-center shrink-0">
            <DropMark />
          </div>
          {!collapsed && (
            <div>
              <span className="text-foreground font-bold text-lg tracking-tight">Shrimp365</span>
              <p className="text-[#1E40AF] text-[10px] font-mono tracking-[0.15em]">SMART AQUACULTURE</p>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-0.5">
        {/* Home */}
        <NavItem href="/home" icon={Home} label={t.nav.home} />

        {/* Record section */}
        <SectionLabel label={t.nav.sectionRecord} />
        {RECORD_NAV.map(item => <NavItem key={item.href} {...item} />)}

        {/* Monitor section */}
        <SectionLabel label={t.nav.sectionMonitor} />
        {MONITOR_NAV.map(item => <NavItem key={item.href} {...item} />)}
      </nav>

      {/* Bottom */}
      <div className="px-3 pb-4 space-y-1 border-t border-border pt-3">
        <LanguageSwitcher collapsed={collapsed} />

        <Link
          href="/help"
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all",
            pathname === "/help" && "bg-[#1E40AF]/10 text-[#1E40AF] border border-[#1E40AF]/25",
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
            <span className="text-[10px] font-mono font-semibold tracking-wider px-2 py-0.5 rounded-full bg-[#1E40AF]/10 text-[#1E40AF] border border-[#1E40AF]/25">
              FREE
            </span>
          </div>
        )}

        <div className={cn("flex items-center gap-3 px-3 py-2.5", collapsed && "justify-center")}>
          <Avatar className="w-8 h-8 shrink-0">
            <AvatarFallback className="bg-[#1E40AF] text-white text-xs font-semibold">
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
