import { Metadata } from "next"

export const metadata: Metadata = {
  title: "무료 서비스",
  description: "Shrimp365는 완전 무료입니다. 광고 기반으로 운영되며 모든 기능을 제한 없이 사용할 수 있습니다.",
  alternates: { canonical: "https://www.shrimp365.kr/pricing" },
  openGraph: {
    title: "Shrimp365 — 완전 무료, 모든 기능 제한 없음",
    description: "수질 모니터링·AI 어드바이저·양식 일지·질병 진단·재고 관리 모두 무료. 광고 기반으로 운영됩니다.",
    url: "https://www.shrimp365.kr/pricing",
  },
}

const breadcrumbSchema = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "홈", "item": "https://www.shrimp365.kr" },
    { "@type": "ListItem", "position": 2, "name": "서비스 안내", "item": "https://www.shrimp365.kr/pricing" },
  ],
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      {children}
    </>
  )
}
