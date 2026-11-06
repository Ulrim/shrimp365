import type { Metadata } from "next"
import type { ReactNode } from "react"

/*
 * /mrv 의 뿌리 레이아웃 — 메타데이터만 둔다.
 *
 * 세션 컨텍스트와 셸(내비)은 `(app)/layout.tsx` 에 있다. 둘을 나눈 이유는 `/mrv/demo`
 * (로그인 없이 열리는 공개 데모)가 같은 주소 밑에 있으면서도 세션·조직 조회를 **하지 않아야**
 * 하기 때문이다. 세션 provider 가 여기 있으면 데모 페이지도 /auth/me 를 두드려 "초대되지 않음"
 * 으로 떨어진다.
 */

export const metadata: Metadata = {
  title: "컬리버 탄소 MRV 플랫폼",
  description:
    "흰다리새우 양식 공정의 전력·산소·수질·급이·폐사 데이터를 통합해 KPI 를 산출하고, " +
    "전력 절감을 Scope2 탄소저감 성과로 환산해 MRV 리포트로 증빙합니다.",
  robots: { index: false, follow: false },
}

export default function MrvRootLayout({ children }: { children: ReactNode }) {
  return children
}
