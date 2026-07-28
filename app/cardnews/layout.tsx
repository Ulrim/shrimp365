import type { Metadata } from "next"
import { CardNewsChrome } from "./cardnews-chrome"

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.shrimp365.kr"

export const metadata: Metadata = {
  title: "카드뉴스 — 새우 양식 정보 자료실",
  description:
    "흰다리새우(바나메이) 양식 수질 기준, 용존산소 관리, 암모니아 대처, 질병 초기 증상, 급이량 계산까지. 현장에서 바로 쓰는 정보를 카드뉴스로 정리했습니다.",
  keywords: [
    "새우양식", "흰다리새우", "바나메이", "카드뉴스", "수질관리", "용존산소",
    "암모니아", "AHPND", "급이량", "양식장 관리", "새우양식 정보",
  ],
  alternates: { canonical: `${BASE}/cardnews` },
  openGraph: {
    title: "카드뉴스 | Shrimp365",
    description: "새우 양식 현장에서 바로 쓰는 정보를 카드 한 장씩 정리했습니다.",
    url: `${BASE}/cardnews`,
    type: "website",
  },
  robots: { index: true, follow: true },
}

export default function CardNewsLayout({ children }: { children: React.ReactNode }) {
  return <CardNewsChrome>{children}</CardNewsChrome>
}
