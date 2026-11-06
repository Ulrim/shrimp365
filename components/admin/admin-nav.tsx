"use client"

// 관리자 콘솔 메뉴. 데스크톱은 세로 목록, 모바일은 가로 스크롤 탭 — 항목은 같다.
// 색은 중립(foreground) 하나다. 농가 brand 토큰을 쓰지 않아 농가 화면과 한눈에 구별된다.
import { useEffect, useRef } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutGrid, Users, Droplets, Radar, UserCog, Stethoscope, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { ADMIN_PAGES, adminPageOf, type AdminAccess, type AdminPageKey } from "@/lib/admin-access"

const META: Record<AdminPageKey, { label: string; icon: LucideIcon }> = {
  overview:    { label: "개요",       icon: LayoutGrid },
  users:       { label: "사용자",     icon: Users },
  readings:    { label: "수질 기록",   icon: Droplets },
  control:     { label: "관제센터",   icon: Radar },
  managers:    { label: "매니저 관리", icon: UserCog },
  diagnostics: { label: "시스템 진단", icon: Stethoscope },
}

/** 화면 제목(셸 머리) — 메뉴 라벨과 같다. */
export function adminPageTitle(pathname: string): string {
  const key = adminPageOf(pathname)
  return key ? META[key].label : "관리자 콘솔"
}

export function AdminNav({ access, variant }: { access: AdminAccess; variant: "sidebar" | "tabs" }) {
  const pathname = usePathname() ?? ""
  const current = adminPageOf(pathname)
  const items = ADMIN_PAGES.filter(p => access[p.key])
  const activeRef = useRef<HTMLAnchorElement | null>(null)

  // 가로 탭 — 들어오거나 화면이 바뀌면 활성 탭이 보이게 민다(오른쪽 끝 탭이
  // 가려져 지금 어디인지 모르는 일이 없게). 세로 목록은 다 보이니 하지 않는다.
  useEffect(() => {
    if (variant !== "tabs") return
    activeRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" })
  }, [variant, current])

  if (variant === "tabs") {
    return (
      // 좌우 가장자리를 흐리게(mask) — 더 밀 수 있다는 표시.
      <nav
        aria-label="관리자 메뉴"
        className="flex gap-1 overflow-x-auto px-4 pb-2 -mb-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,transparent,#000_16px,#000_calc(100%-16px),transparent)]"
      >
        {items.map(({ key, href }) => {
          const { label, icon: Icon } = META[key]
          const active = current === key
          return (
            <Link
              key={key}
              ref={active ? activeRef : undefined}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg text-sm font-medium transition-colors",
                active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground hover:bg-accent",
              )}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              {label}
            </Link>
          )
        })}
      </nav>
    )
  }

  return (
    <nav aria-label="관리자 메뉴" className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
      {items.map(({ key, href }) => {
        const { label, icon: Icon } = META[key]
        const active = current === key
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 px-3 min-h-[44px] rounded-lg text-sm font-medium transition-colors",
              active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
