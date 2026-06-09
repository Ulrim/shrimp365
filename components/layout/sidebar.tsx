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
  ClipboardList, HelpCircle,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SettingsPanel } from "@/components/layout/settings-panel"
import { LanguageSwitcher } from "@/components/ui/language-switcher"
import { isMonitorAccount } from "@/lib/mock-data"

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()
  const { t } = useT()
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
    { href: "/farms",        icon: Building2,       label: t.nav.farms },
    { href: "/production",   icon: FlaskConical,    label: t.nav.production },
    { href: "/inventory",    icon: Package,         label: t.nav.inventory },
    { href: "/ai-advisor",   icon: BrainCircuit,    label: t.nav.aiAdvisor },
    { href: "/reports",      icon: BarChart3,       label: t.nav.reports },
    ...(isAdmin ? [{ href: "/admin", icon: ShieldCheck, label: t.nav.admin }] : []),
  ]

  const handleLogout = async () => {
    await logout()
    router.replace("/login")
  }

  const NavItem = ({ href, icon: Icon, label }: { href: string; icon: React.ElementType; label: string }) => {
    const isActive = pathname === href || pathname.startsWith(href + "/")
    return (
      <Link
        href={href}
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group relative",
          isActive
            ? "bg-ocean-50 text-ocean-700 border border-ocean-200"
            : "text-muted-foreground hover:text-foreground hover:bg-accent",
          collapsed && "justify-center px-2"
        )}
      >
        <Icon className={cn("w-5 h-5 shrink-0", isActive ? "text-ocean-500" : "text-muted-foreground group-hover:text-foreground")} />
        {!collapsed && <span className="flex-1">{label}</span>}
        {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-ocean-500 rounded-r-full" />}
      </Link>
    )
  }

  const SectionLabel = ({ label }: { label: string }) => (
    !collapsed ? (
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 pt-3 pb-1">{label}</p>
    ) : <div className="border-t border-border mx-2 my-2" />
  )

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={cn("flex items-center gap-3 px-4 py-5 border-b border-border", collapsed && "justify-center px-2")}>
        <Link href="/home" className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-ocean-400 to-teal-500 rounded-xl flex items-center justify-center shrink-0 text-lg leading-none">
            🦐
          </div>
          {!collapsed && (
            <div>
              <span className="text-foreground font-bold text-lg">Shrimp365</span>
              <p className="text-ocean-500 text-xs">Smart Aquaculture</p>
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
            pathname === "/help" && "bg-ocean-50 text-ocean-700 border border-ocean-200",
            collapsed && "justify-center"
          )}
        >
          <HelpCircle className="w-5 h-5 shrink-0" />
          {!collapsed && <span>도움말</span>}
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
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gradient-to-r from-ocean-500 to-teal-500 text-white">
              Free
            </span>
          </div>
        )}

        <div className={cn("flex items-center gap-3 px-3 py-2.5", collapsed && "justify-center")}>
          <Avatar className="w-8 h-8 shrink-0">
            <AvatarFallback className="bg-gradient-to-br from-ocean-500 to-teal-500 text-white text-xs">
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
