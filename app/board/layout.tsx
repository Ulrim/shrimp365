import type { Metadata } from "next"
import { BoardChrome } from "./board-chrome"

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.shrimp365.kr"

export const metadata: Metadata = {
  title: "커뮤니티 게시판",
  description:
    "흰다리새우(바나메이) 양식 노하우와 정보를 나누는 Shrimp365 커뮤니티 게시판. 수질 관리·질병·급이·재고 등 현장 경험을 자유롭게 공유하세요.",
  alternates: { canonical: `${BASE}/board` },
  openGraph: {
    title: "커뮤니티 게시판 | Shrimp365",
    description: "흰다리새우 양식 노하우와 정보를 나누는 Shrimp365 커뮤니티 게시판.",
    url: `${BASE}/board`,
    type: "website",
  },
  robots: { index: true, follow: true },
}

export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return <BoardChrome>{children}</BoardChrome>
}
