"use client"

/**
 * MRV 앱 셸 — 상단 내비게이션 + 접근 게이트.
 * 원본: mrv-platform/apps/web/src/App.tsx (NavBar / RequireAuth / AppLayout)
 *
 * 게이트 규칙(원본 그대로):
 *   - 세션 확인 전에는 아무것도 그리지 않는다. 성급히 미인증으로 판단하면 새로고침 직후
 *     정상 사용자에게 로그인 화면이 번쩍인다.
 *   - 세션 없음(401) → shrimp365 로그인으로 보낸다.
 *   - 인증됐지만 초대 없음(403)·다중 조직(409) → 안내 화면으로 **대체**한다. 셸(내비)을
 *     함께 보여 주지 않는다 — 들어갈 수 있는 메뉴가 하나도 없는데 메뉴를 보여 주면
 *     오해만 키운다.
 *
 * 플랜별 메뉴 숨김은 UX 보조일 뿐이다. 주소를 직접 쳐서 들어와도 각 API 가 403 으로 막는다.
 */

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, type ReactNode } from "react"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { MrvSiteProvider, useMrvSite } from "@/lib/mrv/ui/site"
import { NotInvited } from "@/components/mrv/not-invited"

const BASE_NAV_ITEMS: { to: string; label: string }[] = [
  { to: "/mrv/overview", label: "개요" },
  { to: "/mrv/input", label: "급이·폐사 입력" },
  { to: "/mrv/baseline", label: "기준선 잠금" },
  { to: "/mrv/alerts", label: "알림 센터" },
  { to: "/mrv/onboarding", label: "온보딩" },
  // 설정은 플랜 게이팅 대상이 아니다 — 계측기를 등록하지 못하면 START 도 아무 값을
  // 볼 수 없으므로 전 플랜이 들어와야 한다. 쓰기 권한은 화면 안에서 역할로 가린다.
  { to: "/mrv/settings", label: "설정" },
]

const PRO_NAV_ITEMS: { to: string; label: string }[] = [
  { to: "/mrv/comparison", label: "전·후 비교" },
  { to: "/mrv/recommend", label: "추천 보드" },
  { to: "/mrv/mrv-reports", label: "MRV 리포트" },
  { to: "/mrv/sop", label: "SOP 라이브러리" },
]

const ENTERPRISE_NAV_ITEMS: { to: string; label: string }[] = [
  { to: "/mrv/control-console", label: "제어 콘솔" },
  { to: "/mrv/multisite", label: "멀티사이트" },
  { to: "/mrv/audit-logs", label: "감사 로그" },
]

const ENTERPRISE_PATHS = new Set(ENTERPRISE_NAV_ITEMS.map((i) => i.to))

/**
 * 사이트 선택기. 조직에 사이트가 하나뿐이면 이름만 보여 준다 — 고를 것이 없는데
 * 셀렉트를 띄우면 선택해야 할 것처럼 보인다.
 */
function SitePicker() {
  const { sites, selectedSiteId, setSelectedSiteId } = useMrvSite()

  if (sites.length === 0) return null
  if (sites.length === 1) {
    return (
      <span className="text-xs text-mrv-muted" title={sites[0].id}>
        {sites[0].name}
      </span>
    )
  }
  return (
    <label className="flex items-center gap-1.5 text-xs text-mrv-muted">
      <span className="sr-only">사이트 선택</span>
      <select
        value={selectedSiteId ?? ""}
        onChange={(e) => setSelectedSiteId(e.target.value)}
        className="rounded-md border border-mrv-border bg-mrv-surface px-2 py-1 text-xs text-mrv-fg"
      >
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function NavBar() {
  const { isPro, isEnterprise } = useMrvSession()
  const pathname = usePathname()

  const items = [
    ...BASE_NAV_ITEMS,
    ...(isPro ? PRO_NAV_ITEMS : []),
    ...(isEnterprise ? ENTERPRISE_NAV_ITEMS : []),
  ]

  // print:hidden — MRV 리포트는 심사용 증빙으로 인쇄되는 문서라 내비게이션이 함께 찍히면
  // 안 된다(앱의 다른 구역이 쓰는 규약과 같다).
  return (
    <nav
      aria-label="주요 메뉴"
      className="sticky top-0 z-40 flex items-center gap-1 border-b border-mrv-border bg-mrv-surface px-4 py-3 sm:px-6 print:hidden"
    >
      <div className="flex shrink-0 items-center gap-2 pr-3">
        {/* shrimp365 로 돌아가는 길. MRV 는 이제 별도 앱이 아니라 이 앱의 한 구역이므로,
            들어온 사람이 되돌아갈 문이 없으면 브라우저 뒤로가기 말고는 나갈 수가 없다. */}
        <Link
          href="/home"
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-mrv-muted hover:bg-mrv-bg hover:text-mrv-fg"
        >
          <span aria-hidden="true">←</span>
          <span className="hidden sm:inline">shrimp365</span>
        </Link>
        <Link href="/mrv/overview" className="text-sm font-bold text-mrv-fg">
          컬리버 MRV
        </Link>
      </div>
      {/* 메뉴가 최대 13개다(기본 6 + PRO 4 + ENTERPRISE 3). 좁은 화면에서 줄바꿈하면 내비가 화면 절반을 먹으므로
          가로 스크롤로 흘린다(항목은 전부 닿을 수 있고 본문 자리는 그대로다). */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {items.map((item) => {
          const isActive = pathname === item.to || pathname.startsWith(item.to + "/")
          return (
            <Link
              key={item.to}
              href={item.to}
              aria-current={isActive ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
                isActive
                  ? "bg-mrv-primary/10 text-mrv-primary"
                  : "text-mrv-muted hover:bg-mrv-bg hover:text-mrv-fg"
              }`}
            >
              {item.label}
              {ENTERPRISE_PATHS.has(item.to) && (
                <span className="rounded-full bg-mrv-na-bg px-1.5 py-0.5 text-[10px] font-semibold text-mrv-muted">
                  ENTERPRISE
                </span>
              )}
            </Link>
          )
        })}
      </div>
      <div className="shrink-0 pl-3">
        <SitePicker />
      </div>
    </nav>
  )
}

export function MrvShell({ children }: { children: ReactNode }) {
  const session = useMrvSession()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (session.isUnauthenticated) {
      // shrimp365 의 로그인 화면을 그대로 쓴다(계정이 공유되므로 별도 로그인이 없다).
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`)
    }
  }, [session.isUnauthenticated, router, pathname])

  // 확정 전에는 아무것도 그리지 않는다(깜빡임 방지).
  if (session.isLoading) return null
  if (session.isUnauthenticated) return null
  if (session.gateStatus !== null) return <NotInvited status={session.gateStatus} />

  return (
    <MrvSiteProvider>
      <div className="flex min-h-screen flex-col bg-mrv-bg text-mrv-fg">
        <NavBar />
        <main className="flex-1">{children}</main>
      </div>
    </MrvSiteProvider>
  )
}
