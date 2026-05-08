"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { cn } from "@/lib/utils"
import {
  Waves, LayoutDashboard, Droplets, BookOpen, Building2,
  FlaskConical, BrainCircuit, BarChart3, Settings, LogOut,
  ChevronLeft, ChevronRight, Bell, Menu, X
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { SettingsPanel } from "@/components/layout/settings-panel"
import { getDiagnosisCount } from "@/lib/db"
import { isTestAccount, MOCK_DIAGNOSES } from "@/lib/mock-data"

const BASE_NAV = [
  { href: "/dashboard",    icon: LayoutDashboard, label: "대시보드" },
  { href: "/water-quality", icon: Droplets,       label: "수질 모니터링" },
  { href: "/journal",      icon: BookOpen,        label: "양식 일지" },
  { href: "/farms",        icon: Building2,       label: "양식장·수조 관리" },
  { href: "/diagnosis",    icon: FlaskConical,    label: "질병 진단" },
  { href: "/ai-advisor",   icon: BrainCircuit,    label: "AI 어드바이저" },
  { href: "/reports",      icon: BarChart3,       label: "리포트" },
]

interface SidebarProps {
  alertCount?: number
}

export function Sidebar({ alertCount = 3 }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [diagBadge, setDiagBadge] = useState<number>(0)

  useEffect(() => {
    async function loadDiagCount() {
      try {
        const count = await getDiagnosisCount()
        if (count > 0) { setDiagBadge(count); return }
        if (isTestAccount(user?.email)) {
          const mock = MOCK_DIAGNOSES.filter(d => d.risk_level === "high" || d.risk_level === "critical").length
          setDiagBadge(mock)
        }
      } catch {
        if (isTestAccount(user?.email)) {
          setDiagBadge(MOCK_DIAGNOSES.filter(d => d.risk_level === "high" || d.risk_level === "critical").length)
        }
      }
    }
    loadDiagCount()
  }, [user?.email])

  const handleLogout = async () => {
    await logout()
    router.replace("/login")
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={cn("flex items-center gap-3 px-4 py-5 border-b border-white/10", collapsed && "justify-center px-2")}>
        <div className="w-9 h-9 bg-gradient-to-br from-ocean-400 to-teal-500 rounded-xl flex items-center justify-center shrink-0">
          <Waves className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <div>
            <span className="text-white font-bold text-lg">Shrimp365</span>
            <p className="text-ocean-400 text-xs">스마트 양식 플랫폼</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {BASE_NAV.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
          const badge = item.href === "/diagnosis" ? (diagBadge > 0 ? String(diagBadge) : null) : null
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group relative",
                isActive
                  ? "bg-gradient-to-r from-ocean-500/20 to-teal-500/20 text-white border border-ocean-500/30"
                  : "text-slate-400 hover:text-white hover:bg-white/5",
                collapsed && "justify-center px-2"
              )}
            >
              <item.icon className={cn("w-5 h-5 shrink-0", isActive ? "text-ocean-400" : "text-slate-500 group-hover:text-slate-300")} />
              {!collapsed && (
                <>
                  <span className="flex-1">{item.label}</span>
                  {badge && (
                    <Badge variant="danger" className="h-5 text-xs px-1.5">{badge}</Badge>
                  )}
                  {item.href === "/water-quality" && alertCount > 0 && (
                    <Badge variant="warning" className="h-5 text-xs px-1.5">{alertCount}</Badge>
                  )}
                </>
              )}
              {collapsed && badge && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
              )}
              {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-ocean-400 rounded-r-full" />}
            </Link>
          )
        })}
      </nav>

      {/* Bottom */}
      <div className="px-3 pb-4 space-y-1 border-t border-white/10 pt-3">
        <button
          onClick={() => setSettingsOpen(true)}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-all",
            collapsed && "justify-center"
          )}
        >
          <Settings className="w-5 h-5 shrink-0" />
          {!collapsed && <span>설정</span>}
        </button>

        <div className={cn("flex items-center gap-3 px-3 py-2.5", collapsed && "justify-center")}>
          <Avatar className="w-8 h-8 shrink-0">
            <AvatarFallback className="bg-gradient-to-br from-ocean-500 to-teal-500 text-white text-xs">
              {user?.name?.[0] || "U"}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white font-medium truncate">{user?.name}</p>
              <p className="text-xs text-slate-500 truncate">{user?.email}</p>
            </div>
          )}
          {!collapsed && (
            <button onClick={handleLogout} className="text-slate-500 hover:text-red-400 transition-colors" aria-label="로그아웃">
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
        "hidden lg:flex flex-col bg-slate-900/80 border-r border-white/10 backdrop-blur-xl transition-all duration-300 relative",
        collapsed ? "w-16" : "w-60"
      )}>
        <SidebarContent />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 w-6 h-6 bg-slate-800 border border-white/20 rounded-full flex items-center justify-center text-slate-400 hover:text-white transition-colors z-10"
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </aside>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Mobile Sidebar */}
      <div className="lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="fixed top-4 left-4 z-50 w-10 h-10 bg-slate-900/90 border border-white/10 rounded-xl flex items-center justify-center text-white backdrop-blur-sm"
          aria-label="메뉴 열기"
        >
          <Menu className="w-5 h-5" />
        </button>

        {mobileOpen && (
          <>
            <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <aside className="fixed left-0 top-0 bottom-0 w-64 bg-slate-900 border-r border-white/10 z-50 flex flex-col">
              <div className="absolute top-4 right-4">
                <button onClick={() => setMobileOpen(false)} className="text-slate-400 hover:text-white" aria-label="메뉴 닫기">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <SidebarContent />
            </aside>
          </>
        )}
      </div>
    </>
  )
}
