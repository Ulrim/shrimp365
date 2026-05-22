import { Metadata } from "next"

export const metadata: Metadata = {
  title: "요금제 | Shrimp365",
  description: "새우 양식장 관리 플랫폼 Shrimp365 요금제. Free·Basic(₩19,900/월)·Pro(₩39,900/월)·Enterprise. 지금 가입하면 Pro 3개월 무료.",
  alternates: { canonical: "https://www.shrimp365.kr/pricing" },
  openGraph: {
    title: "Shrimp365 요금제 — Pro 3개월 무료",
    description: "새우 양식 AI 관리 플랫폼. Free부터 Enterprise까지. 지금 시작하면 Pro 플랜 3개월 무료.",
    url: "https://www.shrimp365.kr/pricing",
  },
}

const pricingSchema = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": "Shrimp365 요금제",
  "description": "새우 양식장 관리 플랫폼 Shrimp365의 구독 플랜",
  "itemListElement": [
    {
      "@type": "ListItem", "position": 1,
      "item": {
        "@type": "Product",
        "name": "Shrimp365 Free",
        "description": "양식장 1개, 수조 5개, AI 어드바이저 시간당 3회",
        "offers": { "@type": "Offer", "price": "0", "priceCurrency": "KRW", "availability": "https://schema.org/InStock" }
      }
    },
    {
      "@type": "ListItem", "position": 2,
      "item": {
        "@type": "Product",
        "name": "Shrimp365 Basic",
        "description": "양식장 2개, 수조 15개, AI 어드바이저 시간당 10회, IoT 센서 1개",
        "offers": { "@type": "Offer", "price": "19900", "priceCurrency": "KRW", "billingIncrement": "P1M", "availability": "https://schema.org/InStock" }
      }
    },
    {
      "@type": "ListItem", "position": 3,
      "item": {
        "@type": "Product",
        "name": "Shrimp365 Pro",
        "description": "양식장 5개, 수조 50개, AI 어드바이저 시간당 30회, IoT 센서 5개, CSV 내보내기",
        "offers": { "@type": "Offer", "price": "39900", "priceCurrency": "KRW", "billingIncrement": "P1M", "availability": "https://schema.org/InStock" }
      }
    }
  ]
}

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingSchema) }} />
      {children}
    </>
  )
}
