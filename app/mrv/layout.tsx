import type { Metadata } from "next"
import type { ReactNode } from "react"
import { MrvSessionProvider } from "@/lib/mrv/ui/session"
import { MrvShell } from "@/components/mrv/shell"

/*
 * /mrv 하위 전체의 셸.
 *
 * 이 구역은 shrimp365(B2C)와 다른 제품이다 — 조직 단위 멀티테넌시에 초대 기반이고,
 * 화면도 별도 디자인 토큰(mrv-*)을 쓴다. 그래서 대시보드 사이드바 대신 자체 내비를
 * 두고, 세션 컨텍스트도 따로 잡는다. 공유하는 것은 로그인 계정 하나뿐이다.
 */

export const metadata: Metadata = {
  title: "컬리버 탄소 MRV 플랫폼",
  description:
    "흰다리새우 양식 공정의 전력·산소·수질·급이·폐사 데이터를 통합해 KPI 를 산출하고, " +
    "전력 절감을 Scope2 탄소저감 성과로 환산해 MRV 리포트로 증빙합니다.",
  robots: { index: false, follow: false },
}

export default function MrvLayout({ children }: { children: ReactNode }) {
  return (
    <MrvSessionProvider>
      <MrvShell>{children}</MrvShell>
    </MrvSessionProvider>
  )
}
