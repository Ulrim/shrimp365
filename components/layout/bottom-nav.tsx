"use client"

import { useState } from "react"
import { MRV_PLATFORM_IS_INTERNAL, MRV_PLATFORM_URL, SHOW_BOARD, showCardNews } from "@/lib/features"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { useAgriRoute } from "@/lib/agri-route"
import { cn } from "@/lib/utils"
import {
  Home, LayoutDashboard, Droplets, ClipboardList,
  MoreHorizontal, Building2, FlaskConical, Package,
  BarChart3, Settings, LogOut, ShieldCheck, ChevronRight, BookOpen, BrainCircuit, MessageSquare, Layers, Radar, Leaf, ExternalLink,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SettingsPanel } from "@/components/layout/settings-panel"
import { PLAN_LABELS, PLAN_COLORS } from "@/lib/plans"
import { isMonitorAccount } from "@/lib/mock-data"
import { localizedHref, stripLocalePrefix } from "@/lib/marketing-locale"

// 농업 화면(/daumlabs)에 없는 메뉴 — sidebar 와 같은 집합(설계서 4-3).
const AGRI_HIDDEN = new Set(["/production", "/inventory", "/ai-advisor", "/reports"])

export function BottomNav() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, logout } = useAuth()
  const { t, locale } = useT()
  // 농업 화면 판정은 주소로 한다. withAgri()는 새우 화면에서 문자열을 그대로 돌려준다.
  const { isAgri, href: withAgri } = useAgriRoute()
  const [moreOpen, setMoreOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const isAdmin = user?.role === "admin" || isMonitorAccount(user?.email)
  const canControl = isAdmin || user?.role === "manager"
  /**
   * 탄소 MRV 플랫폼 진입을 보여 줄 대상.
   *
   * 지금은 관제센터(`canControl`)와 같은 집합이지만 **변수를 따로 둔다** — 이유가 다르기
   * 때문이다. 관제센터는 권한이 없으면 서버가 막는 기능이고, MRV 는 조직 초대제인 **별도
   * 플랫폼**이다. 초대되지 않은 계정이 들어가면 "초대되지 않음" 안내만 보게 되므로, 그
   * 화면을 대부분 사용자에게 들이밀지 않으려고 좁힌다. 한쪽 기준이 바뀔 때 다른 쪽이
   * 조용히 따라가면 안 된다.
   *
   * 노출은 편의일 뿐이고 실제 접근 판정은 MRV 쪽 세션·조직 조회가 한다 — 이 메뉴가
   * 없어도 주소를 직접 치면 들어갈 수 있고, 그래야 초대받은 작업자가 막히지 않는다.
   */
  const canSeeMrv = isAdmin || user?.role === "manager"

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
    // 컬리버 탄소 MRV 플랫폼. 사이드바는 lg 이상에서만 보이므로, 휴대폰에서 같은
    // 자리는 이 '더보기' 목록이다. 농업 화면에서 숨기는 이유는 sidebar 와 같다 —
    // 아래 AGRI_HIDDEN 필터는 href 로 견주는데 이 항목의 href 는 환경변수에 따라
    // 절대 URL 이 될 수 있고, 새우 RAS 탄소 MRV 는 수경재배 문맥의 메뉴가 아니다.
    ...(canSeeMrv && !isAgri && MRV_PLATFORM_URL
      ? [
          {
            href: MRV_PLATFORM_URL,
            icon: Leaf,
            label: t.nav.mrvPlatform,
            external: !MRV_PLATFORM_IS_INTERNAL,
          },
        ]
      : []),
    // 공개 콘텐츠는 언어별 주소가 따로 있다. 접두사 없는 주소는 한국어로
    // 고정되므로, 로그인한 사용자의 언어에 맞는 주소로 보낸다.
    ...(SHOW_BOARD ? [{ href: localizedHref("/board", locale),    icon: MessageSquare, label: t.board.title }] : []),
    ...(showCardNews(locale) ? [{ href: localizedHref("/cardnews", locale), icon: Layers,        label: t.cardNews.title }] : []),
    ...(canControl ? [{ href: "/control", icon: Radar, label: "관제센터" }] : []),
    ...(isAdmin ? [{ href: "/admin", icon: ShieldCheck, label: t.nav.admin }] : []),
  ].filter(item => !isAgri || !AGRI_HIDDEN.has(item.href))

  // 언어 접두사를 뗀 뒤 견준다. /en/cardnews 도 "더보기" 안의 항목이다.
  const here = stripLocalePrefix(pathname).path
  const isMoreActive = MORE.some((item) => {
    // 외부 주소는 이 앱의 경로가 아니므로 활성 판정에 넣지 않는다.
    if ("external" in item && item.external) return false
    const target = stripLocalePrefix(withAgri(item.href)).path
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
          {PRIMARY.map((item) => {
            const to = withAgri(item.href)
            const active = pathname === to || pathname.startsWith(to + "/")
            return (
              <Link
                key={item.href}
                href={to}
                className="relative flex-1 flex flex-col items-center justify-center gap-1 min-h-[44px] transition-colors px-1"
              >
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-[#1E40AF] rounded-b-full" />
                )}
                <item.icon className={cn("w-5 h-5 shrink-0 transition-transform", active ? "text-[#1E40AF] scale-110" : "text-muted-foreground")} />
                <span className={cn("text-[10px] font-medium leading-none truncate w-full text-center", active ? "text-[#1E40AF]" : "text-muted-foreground")}>
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
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-[#1E40AF] rounded-b-full" />
            )}
            <MoreHorizontal className={cn("w-5 h-5 shrink-0", isMoreActive ? "text-[#1E40AF]" : "text-muted-foreground")} />
            <span className={cn("text-[10px] font-medium leading-none truncate w-full text-center", isMoreActive ? "text-[#1E40AF]" : "text-muted-foreground")}>
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
                <AvatarFallback className="bg-[#1E40AF] text-white font-semibold">
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
                const external = "external" in item && item.external === true
                const to = external ? item.href : withAgri(item.href)
                const active = !external && (pathname === to || pathname.startsWith(to + "/"))
                const className = cn(
                  "flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all",
                  active
                    ? "bg-[#1E40AF]/10 text-[#1E40AF] border border-[#1E40AF]/25"
                    : "text-foreground active:bg-accent"
                )
                const inner = (
                  <>
                    <item.icon className={cn("w-5 h-5", active ? "text-[#1E40AF]" : "text-muted-foreground")} />
                    <span className="flex-1 font-medium text-[15px]">{item.label}</span>
                    {/* 새 탭으로 열리는 항목은 꺾쇠(이 앱 안에서 이동) 대신 그 사실을
                        아이콘으로 알린다 — 같은 모양이면 뒤로 가기가 되는 줄 안다. */}
                    {external ? (
                      <ExternalLink className="w-4 h-4 text-muted-foreground" aria-label="새 탭에서 열림" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                  </>
                )
                if (external) {
                  return (
                    <a
                      key={item.href}
                      href={to}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setMoreOpen(false)}
                      className={className}
                    >
                      {inner}
                    </a>
                  )
                }
                return (
                  <Link
                    key={item.href}
                    href={to}
                    onClick={() => setMoreOpen(false)}
                    className={className}
                  >
                    {inner}
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
