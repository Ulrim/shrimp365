import type { Metadata } from "next"
import { cookies } from "next/headers"
import localFont from "next/font/local"
import "./globals.css"

const pretendard = localFont({
  src: "../public/fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "100 900",
  display: "swap",
  preload: true,
  fallback: ["-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
  adjustFontFallback: "Arial",
})
import { AuthProvider } from "@/lib/auth-context"
import { I18nProvider } from "@/lib/i18n-context"
import { type Locale, LOCALES } from "@/lib/i18n"
import { VersionWatcher } from "@/components/version-watcher"
import { Analytics } from "@vercel/analytics/next"
import { SpeedInsights } from "@vercel/speed-insights/next"

export const metadata: Metadata = {
  metadataBase: new URL("https://www.shrimp365.kr"),
  title: {
    default: "Shrimp365 | 새우 양식 AI 관리 플랫폼",
    template: "%s | Shrimp365",
  },
  description: "흰다리새우 AI 수질 모니터링·양식 일지·질병 진단 통합 플랫폼. 수온·pH·DO 알림, 재고 관리까지 스마트폰 하나로.",
  keywords: [
    // 한국어
    "새우 양식", "흰다리새우", "바나메이 새우", "새우 농장 관리",
    "수질 모니터링", "수질 관리 시스템", "양식장 관리",
    "AI 양식", "스마트 양식", "수산 ICT",
    "양식 일지", "급이 관리", "폐사 관리",
    "AHPND 진단", "새우 질병 관리",
    "새우 수질", "DO 용존산소", "pH 모니터링",
    "Shrimp365", "쉬림프365", "컬리버",
    // English (USA / Europe / Japan / Global)
    "shrimp farming app", "vannamei shrimp management", "aquaculture management software",
    "water quality monitoring system", "shrimp farm management", "smart aquaculture",
    "AI aquaculture advisor", "shrimp disease management", "AHPND detection",
    "pond water quality", "dissolved oxygen monitoring", "aquaculture IoT",
    "shrimp farm app", "aquaculture platform", "fish farm management",
    // Tiếng Việt (Vietnam)
    "nuôi tôm thẻ chân trắng", "quản lý trang trại tôm", "giám sát chất lượng nước",
    "phần mềm nuôi tôm", "tôm vannamei", "tư vấn AI nuôi tôm",
    // ภาษาไทย (Thailand)
    "การเลี้ยงกุ้งขาว", "ระบบตรวจสอบคุณภาพน้ำ", "ฟาร์มกุ้ง",
    // 日本語 (Japan)
    "エビ養殖管理", "水質モニタリング", "バナメイエビ", "養殖管理アプリ",
  ],
  authors: [{ name: "CULIVER INC.", url: "https://www.shrimp365.kr" }],
  creator: "CULIVER INC.",
  publisher: "CULIVER INC.",
  category: "Business Software",
  applicationName: "Shrimp365",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    alternateLocale: ["en_US", "en_GB", "vi_VN", "th_TH", "ja_JP"],
    url: "https://www.shrimp365.kr",
    siteName: "Shrimp365",
    title: "Shrimp365 | AI Shrimp Farm Management Platform",
    description: "AI-powered water quality monitoring, production management & disease diagnosis for vannamei shrimp farms. Real-time pH·DO·temperature alerts on your smartphone.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Shrimp365 — AI Shrimp Farm Management Platform" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Shrimp365 | AI Shrimp Farm Management Platform",
    description: "AI-powered water quality monitoring & disease diagnosis for vannamei shrimp farms. Manage feeding, inventory & health from your phone.",
    images: ["/opengraph-image"],
  },
  alternates: {
    canonical: "https://www.shrimp365.kr",
    languages: {
      "x-default": "https://www.shrimp365.kr",
      "ko-KR": "https://www.shrimp365.kr",
      "en-US": "https://www.shrimp365.kr",
      "en-GB": "https://www.shrimp365.kr",
      "vi-VN": "https://www.shrimp365.kr",
      "th-TH": "https://www.shrimp365.kr",
      "ja-JP": "https://www.shrimp365.kr",
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
          "availableLanguage": ["Korean", "English", "Vietnamese"],
        },
        "areaServed": [
          { "@type": "Country", "name": "South Korea" },
          { "@type": "Country", "name": "Vietnam" },
          { "@type": "Country", "name": "Thailand" },
          { "@type": "Country", "name": "United States" },
          { "@type": "Country", "name": "Japan" },
          { "@type": "Country", "name": "United Kingdom" },
          { "@type": "Country", "name": "Germany" },
          { "@type": "Country", "name": "France" },
        ],
        "sameAs": [],
      },
      {
        "@type": "WebSite",
        "@id": "https://www.shrimp365.kr/#website",
        "url": "https://www.shrimp365.kr",
        "name": "Shrimp365",
        "description": "흰다리새우 양식 어가를 위한 AI 기반 수질 모니터링·생산 관리·질병 진단 통합 플랫폼",
        "publisher": { "@id": "https://www.shrimp365.kr/#organization" },
        "inLanguage": ["ko-KR", "en-US", "vi-VN"],
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
        "alternateName": ["쉬림프365", "새우365", "Shrimp 365", "สูตรกุ้ง365", "エビ365"],
        "applicationCategory": "BusinessApplication",
        "applicationSubCategory": "Aquaculture Management Software",
        "operatingSystem": "Web, iOS, Android",
        "description": "AI-powered vannamei shrimp farm management platform. Water quality monitoring (temperature, pH, DO, ammonia), farm journal, disease diagnosis (AHPND, EHP), inventory and production reports — all in one app. 흰다리새우(바나메이) 양식 어가를 위한 AI 기반 통합 관리 플랫폼.",
        "url": "https://www.shrimp365.kr",
        "screenshot": "https://www.shrimp365.kr/opengraph-image",
        "featureList": [
          "Real-time water quality monitoring — temperature, pH, DO, ammonia, nitrite, nitrate, salinity, alkalinity, turbidity",
          "AI Advisor — automated root-cause analysis and corrective action guidance",
          "Disease diagnosis records — AHPND, EHP, Vibrio",
          "Farm journal — feed, mortality, water exchange, disinfection",
          "Inventory management — feed, probiotics, disinfectants with auto-alert",
          "Production management & PDF report export",
          "Supports Korean, English, Vietnamese (다국어 지원)",
        ],
        "offers": {
          "@type": "AggregateOffer",
          "lowPrice": "0",
          "highPrice": "39900",
          "priceCurrency": "KRW",
          "offerCount": 4,
          "offers": [
            { "@type": "Offer", "name": "Free", "price": "0", "priceCurrency": "KRW", "description": "1 farm, 5 tanks, AI advisor 3 queries/hour" },
            { "@type": "Offer", "name": "Basic", "price": "19900", "priceCurrency": "KRW", "description": "2 farms, 15 tanks, AI advisor 10 queries/hour" },
            { "@type": "Offer", "name": "Pro", "price": "39900", "priceCurrency": "KRW", "description": "5 farms, 50 tanks, AI advisor 30 queries/hour" },
            { "@type": "Offer", "name": "Enterprise", "price": "0", "priceCurrency": "KRW", "description": "Unlimited farms/tanks, custom pricing" },
          ],
        },
        "author": { "@id": "https://www.shrimp365.kr/#organization" },
        "inLanguage": ["ko-KR", "en-US", "vi-VN"],
        "availableLanguage": [
          { "@type": "Language", "name": "Korean", "alternateName": "ko" },
          { "@type": "Language", "name": "English", "alternateName": "en" },
          { "@type": "Language", "name": "Vietnamese", "alternateName": "vi" },
        ],
        "audience": {
          "@type": "Audience",
          "audienceType": "Shrimp farmers, aquaculture operators, vannamei shrimp producers",
          "geographicArea": [
            { "@type": "Country", "name": "South Korea" },
            { "@type": "Country", "name": "Vietnam" },
            { "@type": "Country", "name": "Thailand" },
            { "@type": "Country", "name": "United States" },
            { "@type": "Country", "name": "Japan" },
            { "@type": "Country", "name": "United Kingdom" },
          ],
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
          {
            "@type": "Question",
            "name": "What is Shrimp365?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Shrimp365 is an AI-powered aquaculture management platform for vannamei (white leg) shrimp farmers. It covers water quality monitoring, farm journal, disease diagnosis, inventory, and production reports — accessible from any smartphone browser without installing an app.",
            },
          },
          {
            "@type": "Question",
            "name": "Is Shrimp365 available outside Korea?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes. Shrimp365 supports Korean, English, and Vietnamese and is used by shrimp farmers in Korea, Vietnam, Thailand, the United States, and other countries. The platform is accessible globally at shrimp365.kr.",
            },
          },
          {
            "@type": "Question",
            "name": "What are the ideal water quality parameters for vannamei shrimp?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Optimal water quality for Litopenaeus vannamei: temperature 28–32°C, pH 7.5–8.5, dissolved oxygen ≥5 mg/L, salinity 10–35 ppt, ammonia <0.1 mg/L. Shrimp365 automatically alerts you when any parameter exceeds these thresholds.",
            },
          },
          {
            "@type": "Question",
            "name": "Shrimp365 có hỗ trợ tiếng Việt không?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Có, Shrimp365 hỗ trợ đầy đủ tiếng Việt. Nền tảng giúp người nuôi tôm thẻ chân trắng tại Việt Nam theo dõi chất lượng nước, ghi nhật ký ao, quản lý kho và nhận tư vấn từ AI bằng tiếng Việt.",
            },
          },
        ],
      },
    ],
  }

  return (
    <html lang={defaultLocale} suppressHydrationWarning className={pretendard.variable}>
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
