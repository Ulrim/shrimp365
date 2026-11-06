import type { ReactNode } from "react"
import { MrvSessionProvider } from "@/lib/mrv/ui/session"
import { MrvShell } from "@/components/mrv/shell"

/*
 * /mrv 하위 **앱 화면** 전체의 셸(공개 데모 /mrv/demo 는 제외 — 뿌리 레이아웃 참고).
 *
 * 이 구역은 shrimp365(B2C)와 다른 제품이다 — 조직 단위 멀티테넌시에 초대 기반이고,
 * 화면도 별도 디자인 토큰(mrv-*)을 쓴다. 그래서 대시보드 사이드바 대신 자체 내비를
 * 두고, 세션 컨텍스트도 따로 잡는다. 공유하는 것은 로그인 계정 하나뿐이다.
 */

export default function MrvAppLayout({ children }: { children: ReactNode }) {
  return (
    <MrvSessionProvider>
      <MrvShell>{children}</MrvShell>
    </MrvSessionProvider>
  )
}
