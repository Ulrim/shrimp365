import type { Metadata } from "next"
import { cookies } from "next/headers"
import "./globals.css"
import { AuthProvider } from "@/lib/auth-context"
import { I18nProvider } from "@/lib/i18n-context"
import { type Locale, LOCALES } from "@/lib/i18n"
import { VersionWatcher } from "@/components/version-watcher"
import { Analytics } from "@vercel/analytics/next"
import { SpeedInsights } from "@vercel/speed-insights/next"

export const metadata: Metadata = {
  metadataBase: new URL("https://www.shrimp365.kr"),
  title: {
    default: "Shrimp365 — 흰다리새우 양식 관리 플랫폼 | 수질모니터링·AI어드바이저",
    template: "%s | Shrimp365",
  },
  description: "흰다리새우(바나메이) 양식 어가를 위한 AI 기반 수질 모니터링·생산 관리·질병 진단 통합 플랫폼. 수온·pH·DO 실시간 알림, AI 어드바이저, 양식 일지를 스마트폰에서 간편하게 관리하세요.",
  keywords: [
    "새우 양식", "흰다리새우", "바나메이 새우", "새우 농장 관리",
    "수질 모니터링", "수질 관리 시스템", "양식장 관리",
    "AI 양식", "스마트 양식", "수산 ICT",
    "양식 일지", "급이 관리", "폐사 관리",
    "AHPND 진단", "새우 질병 관리",
    "새우 수질", "DO 용존산소", "pH 모니터링",
    "aquaculture management", "shrimp farming", "water quality monitoring",
    "Shrimp365", "쉬림프365", "컬리버",
  ],
  authors: [{ name: "CULIVER INC.", url: "https://www.shrimp365.kr" }],
  creator: "CULIVER INC.",
  publisher: "CULIVER INC.",
  category: "Business Software",
  applicationName: "Shrimp365",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    alternateLocale: ["en_US"],
    url: "https://www.shrimp365.kr",
    siteName: "Shrimp365",
    title: "Shrimp365 — 흰다리새우 양식 관리 플랫폼",
    description: "수질 모니터링·AI 어드바이저·질병 진단·재고 관리를 하나의 앱에서. 흰다리새우 양식의 수익성과 안정성을 동시에 높이세요.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Shrimp365 — AI 새우 양식 관리 플랫폼" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Shrimp365 — 흰다리새우 양식 관리 플랫폼",
    description: "수질 모니터링·AI 어드바이저·양식 일지를 스마트폰 하나로. 흰다리새우 양식 어가를 위한 통합 관리 플랫폼.",
    images: ["/opengraph-image"],
  },
  alternates: {
    canonical: "https://www.shrimp365.kr",
    languages: {
      "ko-KR": "https://www.shrimp365.kr",
      "en-US": "https://www.shrimp365.kr",
    },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  verification: {
    google: "mNMCEXdK_oCiqIUM4SgQr6BahBkSMJ-ZZL7B64IAXaY",
    other: {
      "naver-site-verification": "e17088aeef9f7e6ce4357be73f5a7d2591018cbd",
    },
  },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const stored = cookieStore.get("shrimp365_lang")?.value
  const defaultLocale: Locale =
    stored && LOCALES.includes(stored as Locale) ? (stored as Locale) : "ko"

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://www.shrimp365.kr/#organization",
        "name": "CULIVER INC.",
        "alternateName": "컬리버",
        "url": "https://www.shrimp365.kr",
        "logo": {
          "@type": "ImageObject",
          "url": "https://www.shrimp365.kr/opengraph-image",
          "width": 1200,
          "height": 630,
        },
        "contactPoint": {
          "@type": "ContactPoint",
          "email": "contact@culiver.ai",
          "contactType": "customer service",
          "availableLanguage": ["Korean", "English"],
        },
        "sameAs": [],
      },
      {
        "@type": "WebSite",
        "@id": "https://www.shrimp365.kr/#website",
        "url": "https://www.shrimp365.kr",
        "name": "Shrimp365",
        "description": "흰다리새우 양식 어가를 위한 AI 기반 수질 모니터링·생산 관리·질병 진단 통합 플랫폼",
        "publisher": { "@id": "https://www.shrimp365.kr/#organization" },
        "inLanguage": "ko-KR",
        "potentialAction": {
          "@type": "SearchAction",
          "target": { "@type": "EntryPoint", "urlTemplate": "https://www.shrimp365.kr/?q={search_term_string}" },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "SoftwareApplication",
        "@id": "https://www.shrimp365.kr/#app",
        "name": "Shrimp365",
        "alternateName": ["쉬림프365", "새우365"],
        "applicationCategory": "BusinessApplication",
        "applicationSubCategory": "수산양식 관리 소프트웨어",
        "operatingSystem": "Web, iOS, Android",
        "description": "흰다리새우(바나메이) 양식 어가를 위한 AI 기반 수질 모니터링, 양식 일지, 질병 진단, 재고 관리 통합 플랫폼. 수온·pH·DO·암모니아 등 9가지 수질 지표 실시간 모니터링 및 이상 알림 제공.",
        "url": "https://www.shrimp365.kr",
        "screenshot": "https://www.shrimp365.kr/opengraph-image",
        "featureList": [
          "실시간 수질 모니터링 (수온, pH, DO, 암모니아, 아질산, 질산, 염도, 알칼리도, 탁도)",
          "AI 어드바이저 — 수질 이상 원인 분석 및 대처 방법 안내",
          "질병 진단 기록 (AHPND, EHP, 비브리오)",
          "양식 일지 (급이량, 폐사량, 환수, 소독)",
          "재고 관리 (사료, 미생물제, 소독약)",
          "생산 관리 및 리포트 PDF 내보내기",
        ],
        "offers": {
          "@type": "Offer",
          "price": "0",
          "priceCurrency": "KRW",
          "description": "무료로 시작 — 양식장 1개, 수조 3개, 기본 기능 포함",
        },
        "author": { "@id": "https://www.shrimp365.kr/#organization" },
        "inLanguage": ["ko-KR", "en-US", "vi-VN"],
        "audience": {
          "@type": "Audience",
          "audienceType": "흰다리새우 양식 어가, 수산양식업 종사자",
        },
      },
      {
        "@type": "FAQPage",
        "@id": "https://www.shrimp365.kr/#faq",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "Shrimp365는 어떤 서비스인가요?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Shrimp365는 흰다리새우(바나메이) 양식 어가를 위한 AI 기반 통합 관리 플랫폼입니다. 수질 모니터링, 양식 일지, 질병 진단, 재고 관리를 스마트폰 하나로 관리할 수 있습니다.",
            },
          },
          {
            "@type": "Question",
            "name": "어떤 수질 항목을 모니터링할 수 있나요?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "수온, pH, DO(용존산소), 염도, 암모니아, 아질산염, 질산염, 알칼리도, 탁도 등 9가지 수질 지표를 기록하고 기준값 초과 시 즉시 알림을 받을 수 있습니다.",
            },
          },
          {
            "@type": "Question",
            "name": "스마트폰에서도 사용할 수 있나요?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "네, 별도 앱 설치 없이 스마트폰 브라우저(Chrome, Safari)에서 바로 사용할 수 있습니다. 홈 화면에 추가하면 앱처럼 사용 가능합니다.",
            },
          },
          {
            "@type": "Question",
            "name": "무료로 사용할 수 있나요?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "네, 무료 플랜에서 양식장 1개·수조 최대 3개를 등록하고 수질 기록·양식 일지·AI 어드바이저 기본 기능을 모두 사용할 수 있습니다.",
            },
          },
          {
            "@type": "Question",
            "name": "흰다리새우 수질 적정 기준은?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "흰다리새우 적정 수질 기준: 수온 28~32℃, pH 7.5~8.5, DO 5mg/L 이상, 염도 10~35ppt, 암모니아 0.1mg/L 미만. Shrimp365는 이 기준값을 기반으로 이상 알림을 자동 발송합니다.",
            },
          },
        ],
      },
    ],
  }

  return (
    <html lang={defaultLocale} suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="antialiased">
        <I18nProvider defaultLocale={defaultLocale}>
          <AuthProvider>{children}</AuthProvider>
          <VersionWatcher />
        </I18nProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
