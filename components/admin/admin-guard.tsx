"use client"

// 관리자 콘솔 가드(설계서 admin-console.md 2·4장). app/(admin)/layout.tsx(서버)가
// 탭 제목(metadata)만 정하고 이 클라이언트 컴포넌트로 감싼다.
//
// route group (admin) 은 (dashboard) 와 나란한 별도 그룹이라 농가 셸을 물려받지
// 않는다. 루트 레이아웃(app/layout.tsx)은 공유하므로 전체 새로고침도 없다.
//
// 가드 두 겹:
//   1) 인증 — (dashboard)/layout.tsx 와 같은 방식(로딩 스피너 → 비로그인 /login).
//   2) 화면 권한 — lib/admin-access.ts 의 매트릭스. 권한 없는 화면으로 들어오면
//      권한 있는 첫 화면으로, 그것도 없으면 /home 으로 보낸다.
// 2) 는 프로필(profiles.role)이 도착한 뒤에만 판정한다(profileReady). 그 전의 role 은
//    임시값 "farmer" 라, 새로고침·직접 진입한 admin/manager 를 /home 으로 튕겼다.
// 어느 쪽도 보안 경계가 아니다. 데이터는 서버 API 가 이메일+role 로 다시 거른다.
import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { adminAccess, adminPageOf, firstAllowedAdminHref } from "@/lib/admin-access"
import { AdminShell } from "@/components/admin/admin-shell"

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background" role="status" aria-label="불러오는 중">
      <div className="w-10 h-10 border-4 border-foreground border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, profileReady } = useAuth()
  const router = useRouter()
  const pathname = usePathname() ?? ""

  const access = adminAccess(user)
  const page = adminPageOf(pathname)
  // 콘솔에 없는 하위 주소(404)는 not-found 가 그리도록 둔다.
  const allowed = page === null ? access.console : access[page]
  const fallback = firstAllowedAdminHref(access) ?? "/home"

  useEffect(() => {
    if (loading) return
    if (!user) { router.replace("/login"); return }
    if (!profileReady) return
    if (!allowed) router.replace(fallback)
  }, [user, loading, profileReady, allowed, fallback, router])

  if (loading) return <Spinner />
  if (!user) return null
  // 프로필 도착 전에는 판정하지 않는다 — 스피너만.
  if (!profileReady) return <Spinner />
  // 권한 없는 화면은 그리지 않는다 — 마운트되면 그 화면의 API 를 부르기 때문이다.
  if (!allowed) return <Spinner />

  return <AdminShell access={access}>{children}</AdminShell>
}
