"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { cn } from "@/lib/utils"
import {
  Home, LayoutDashboard, Droplets, ClipboardList,
  MoreHorizontal, Building2, FlaskConical, Package,
  BarChart3, Settings, LogOut, ShieldCheck, ChevronRight, BookOpen, BrainCircuit,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SettingsPanel } from "@/components/layout/settings-panel"
import { PLAN_LABELS, PLAN_COLORS } from "@/lib/plans"
import { isMonitorAccount } from "@/lib/mock-data"

export function BottomNav() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()
  const { t } = useT()
  const [moreOpen, setMoreOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const isAdmin = user?.role === "admin" || isMonitorAccount(user?.email)

  const PRIMARY = [
    { href: "/home",               icon: Home,          label: t.nav.home },
    { href: "/record/water-quality", icon: Droplets,    label: t.record.waterQuality },
    { href: "/record/journal",     icon: ClipboardList, label: t.record.journal },
    { href: "/dashboard",          icon: LayoutDashboard, label: t.nav.dashboard },
  ]

  const MORE = [
    { href: "/water-quality", icon: Droplets,      label: t.nav.waterQuality },
    { href: "/journal",       icon: BookOpen,      label: t.nav.journal },
    { href: "/farms",         icon: Building2,     label: t.nav.farms },
    { href: "/production",    icon: FlaskConical,  label: t.nav.production },
    { href: "/inventory",     icon: Package,       label: t.nav.inventory },
    { href: "/ai-advisor",    icon: BrainCircuit,  label: t.nav.aiAdvisor },
    { href: "/reports",       icon: BarChart3,     label: t.nav.reports },
    ...(isAdmin ? [{ href: "/admin", icon: ShieldCheck, label: t.nav.admin }] : []),
  ]

  const isMoreActive = MORE.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/")
  )

  const handleLogout = async () => {
    setMoreOpen(false)
    await logout()
    router.replace("/login")
  }

  return (
    <>
      {/* ── Bottom Tab Bar ───────────────────────────────────── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-xl border-t border-border">
        <div className="flex items-stretch h-16 pb-safe">
          {PRIMARY.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/")
            return (
              <Link
                key={item.href}
                href={item.href}
                className="relative flex-1 flex flex-col items-center justify-center gap-1 min-h-[44px] transition-colors px-1"
              >
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-ocean-500 rounded-b-full" />
                )}
                <item.icon className={cn("w-5 h-5 shrink-0 transition-transform", active ? "text-ocean-500 scale-110" : "text-muted-foreground")} />
                <span className={cn("text-[10px] font-medium leading-none truncate w-full text-center", active ? "text-ocean-500" : "text-muted-foreground")}>
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
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-ocean-500 rounded-b-full" />
            )}
            <MoreHorizontal className={cn("w-5 h-5 shrink-0", isMoreActive ? "text-ocean-500" : "text-muted-foreground")} />
            <span className={cn("text-[10px] font-medium leading-none truncate w-full text-center", isMoreActive ? "text-ocean-500" : "text-muted-foreground")}>
              더보기
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
                <AvatarFallback className="bg-gradient-to-br from-ocean-500 to-teal-500 text-white">
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

            {/* Nav items */}
            <div className="px-4 space-y-1">
              {MORE.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/")
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all",
                      active
                        ? "bg-ocean-50 text-ocean-700 border border-ocean-200"
                        : "text-foreground active:bg-accent"
                    )}
                  >
                    <item.icon className={cn("w-5 h-5", active ? "text-ocean-500" : "text-muted-foreground")} />
                    <span className="flex-1 font-medium text-[15px]">{item.label}</span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </Link>
                )
              })}
            </div>

            {/* Bottom actions */}
            <div className="px-4 pt-2 pb-6 mt-2 border-t border-border space-y-1">
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
