import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "요금제",
  description: "Shrimp365 Free·Basic·Pro·Enterprise 요금제 비교. 새우 양식 어가 규모에 맞는 플랜을 선택하세요.",
  alternates: { canonical: "https://www.shrimp365.kr/pricing" },
  openGraph: {
    url: "https://www.shrimp365.kr/pricing",
    title: "요금제 | Shrimp365",
    description: "Shrimp365 Free·Basic·Pro·Enterprise 요금제 비교.",
  },
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children
}
