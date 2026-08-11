import type { Metadata, Viewport } from "next"
import { cookies, headers } from "next/headers"
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
import { AdSenseScript } from "@/components/ads/adsense-script"
import { CookieConsent } from "@/components/cookie-consent"
import { GoogleAnalytics } from "@/components/analytics/google-analytics"

export const metadata: Metadata = {
  metadataBase: new URL("https://www.shrimp365.kr"),
  title: {
    default: "Shrimp365 | 새우양식 관리 AI 솔루션",
    template: "%s | Shrimp365",
  },
  description: "흰다리새우 어가를 위한 새우양식 관리 솔루션. AI 수질 모니터링·양식 일지·질병 진단 통합, 수온·pH·DO 알림과 재고 관리까지 스마트폰 하나로.",
  keywords: [
    // 한국어
    "새우양식", "새우양식 관리", "새우양식솔루션",
    "새우 양식", "흰다리새우", "바나메이 새우", "새우 농장 관리",
    "새우양식관리 솔루션", "새우 양식 관리 솔루션", "양식 관리 솔루션", "새우양식 솔루션", "스마트 양식 솔루션",
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
    // Bahasa Indonesia (Indonesia — world's largest shrimp producer)
    "budidaya udang vaname", "aplikasi tambak udang", "monitoring kualitas air tambak",
    "manajemen tambak udang", "udang vannamei indonesia", "konsultan AI budidaya udang",
    "software tambak udang", "kualitas air kolam udang", "penyakit udang AHPND",
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
    alternateLocale: ["en_US", "en_GB", "vi_VN", "id_ID"],
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
      "en-US": "https://www.shrimp365.kr/en",
      "en-GB": "https://www.shrimp365.kr/en",
      "vi-VN": "https://www.shrimp365.kr/vi",
      "id-ID": "https://www.shrimp365.kr/id",
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
      "naver-site-verification": [
        "e17088aeef9f7e6ce4357be73f5a7d2591018cbd",
        "40f2127ab44f4b5a851eff0591a11160b15ba8ef",
      ],
    },
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0ea5e9",
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const headerStore = await headers()

  // Localized marketing URLs (/en, /vi, /id) set this header in the proxy so we
  // can server-render the correct language and lock it on the client (the URL
  // wins over any stored preference). Falls back to cookie, then Korean.
  const urlLocaleRaw = headerStore.get("x-locale")
  const urlLocale: Locale | null =
    urlLocaleRaw && LOCALES.includes(urlLocaleRaw as Locale) ? (urlLocaleRaw as Locale) : null

  const stored = cookieStore.get("shrimp365_lang")?.value
  const defaultLocale: Locale =
    urlLocale ?? (stored && LOCALES.includes(stored as Locale) ? (stored as Locale) : "ko")

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
          "availableLanguage": ["Korean", "English", "Vietnamese", "Indonesian"],
        },
        "areaServed": [
          { "@type": "Country", "name": "South Korea" },
          { "@type": "Country", "name": "Vietnam" },
          { "@type": "Country", "name": "Indonesia" },
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
        "inLanguage": ["ko-KR", "en-US", "vi-VN", "id-ID"],
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
        "alternateName": ["쉬림프365", "새우365", "Shrimp 365", "새우양식 관리 솔루션", "새우양식솔루션", "새우양식 관리 앱", "สูตรกุ้ง365", "エビ365"],
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
          "Supports Korean, English, Vietnamese, Indonesian (다국어 지원)",
        ],
        "offers": {
          "@type": "Offer",
          "price": "0",
          "priceCurrency": "USD",
          "description": "Free forever — unlimited farms, tanks, AI advisor, disease diagnosis, reports. Ad-supported.",
        },
        "author": { "@id": "https://www.shrimp365.kr/#organization" },
        "inLanguage": ["ko-KR", "en-US", "vi-VN", "id-ID"],
        "availableLanguage": [
          { "@type": "Language", "name": "Korean", "alternateName": "ko" },
          { "@type": "Language", "name": "English", "alternateName": "en" },
          { "@type": "Language", "name": "Vietnamese", "alternateName": "vi" },
          { "@type": "Language", "name": "Indonesian", "alternateName": "id" },
        ],
        "audience": {
          "@type": "Audience",
          "audienceType": "Shrimp farmers, aquaculture operators, vannamei shrimp producers",
          "geographicArea": [
            { "@type": "Country", "name": "South Korea" },
            { "@type": "Country", "name": "Vietnam" },
            { "@type": "Country", "name": "Indonesia" },
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
              "text": "네, 완전히 무료입니다. Shrimp365는 광고 기반으로 운영되어 양식장·수조 수 제한 없이 수질 기록·양식 일지·AI 어드바이저·질병 진단·리포트 등 모든 기능을 무료로 사용할 수 있습니다.",
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
            "name": "새우양식솔루션을 찾고 있는데, Shrimp365는 어떤 기능을 제공하나요?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Shrimp365는 흰다리새우 어가를 위한 새우양식 관리 솔루션입니다. 수온·pH·DO 등 9가지 수질 모니터링, AI 이상 원인 분석, AHPND·EHP 질병 기록, 양식 일지, 사료 재고 관리, FCR·생존율 리포트를 무료로 제공합니다.",
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
              "text": "Yes. Shrimp365 supports Korean, English, Vietnamese, and Indonesian (Bahasa Indonesia) and is used by shrimp farmers in Korea, Vietnam, Indonesia, Thailand, the United States, and other countries. The platform is accessible globally at shrimp365.kr.",
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
          {
            "@type": "Question",
            "name": "새우 양식 관리 앱 추천해줘",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Shrimp365(shrimp365.kr)는 흰다리새우(바나메이) 전용 양식 관리 플랫폼으로, 수질 모니터링·AI 어드바이저·양식 일지·질병 진단·재고 관리를 하나의 앱에서 제공합니다. 앱 설치 없이 스마트폰 브라우저에서 바로 사용 가능하며, 모든 기능을 양식장·수조 수 제한 없이 완전 무료(광고 기반)로 사용할 수 있습니다.",
            },
          },
          {
            "@type": "Question",
            "name": "흰다리새우 암모니아 높을 때 대처법",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "암모니아가 0.1mg/L 이상이면 즉시 환수를 20~30%로 늘리고, 미생물제(질화 박테리아)를 투여해 암모니아를 분해합니다. pH를 7.5~8.5로 유지하면 독성 NH₃ 비율을 낮출 수 있습니다. 급이량을 10~20% 줄이고, 사료 잔량 확인도 필요합니다. Shrimp365 AI 어드바이저에 수치를 입력하면 상황별 맞춤 대처법을 안내받을 수 있습니다.",
            },
          },
          {
            "@type": "Question",
            "name": "새우 양식 DO(용존산소) 낮을 때 어떻게 하나요?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "DO가 5mg/L 이하로 떨어지면 폭기 장치를 즉시 최대로 가동하고, 밀도가 높은 경우 일부 환수를 실시합니다. 새벽 4~6시에 DO가 가장 낮으므로 이 시간대 모니터링이 중요합니다. 사료 투여를 중단하고 상황이 개선될 때까지 관찰합니다. Shrimp365는 DO 기준 초과 시 즉시 알림을 발송합니다.",
            },
          },
          {
            "@type": "Question",
            "name": "How does the Shrimp365 AI advisor work?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Shrimp365 AI Advisor is powered by OpenAI GPT-4o-mini and is trained on shrimp-specific aquaculture knowledge. You describe your situation in Korean, English, Vietnamese, or Indonesian — for example, 'ammonia is 0.3 mg/L, what should I do?' — and the AI provides specific corrective actions based on water quality standards for Litopenaeus vannamei. Completely free with no query limits.",
            },
          },
          {
            "@type": "Question",
            "name": "What diseases does Shrimp365 help diagnose?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Shrimp365 supports logging and tracking of major shrimp diseases: AHPND (Acute Hepatopancreatic Necrosis Disease / EMS), EHP (Enterocytozoon hepatopenaei), WSSV (White Spot Syndrome Virus), and Vibrio infections. You can record lab test results, track pathogenic ratios over time, and receive risk-level assessments. The AI advisor can also suggest preventive measures based on your disease history.",
            },
          },
          {
            "@type": "Question",
            "name": "새우 폐사 원인 진단 방법",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "새우 폐사의 주요 원인: (1) DO 부족 — 새벽 5mg/L 이하; (2) 암모니아 과다 — 과급이·환수 부족; (3) AHPND(EMS) — Vibrio parahaemolyticus; (4) pH 급변 — 7 이하 또는 9 이상; (5) 염도 급변. Shrimp365에서 수질 기록을 확인하면 폐사 전후 수질 변화를 추적해 원인을 파악할 수 있습니다.",
            },
          },
          {
            "@type": "Question",
            "name": "Apakah Shrimp365 tersedia dalam Bahasa Indonesia?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Ya, Shrimp365 mendukung penuh Bahasa Indonesia. Platform ini dirancang khusus untuk petambak udang vaname (Litopenaeus vannamei) di Indonesia, negara penghasil udang terbesar di dunia. Fitur lengkap: monitoring kualitas air, jurnal tambak, diagnosis penyakit AHPND/EHP/WSSV, manajemen inventaris, dan laporan — semuanya gratis.",
            },
          },
          {
            "@type": "Question",
            "name": "Bagaimana cara memantau kualitas air tambak udang vaname?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Standar kualitas air optimal untuk udang vaname (Litopenaeus vannamei): suhu 28–32°C, pH 7,5–8,5, DO (oksigen terlarut) ≥5 mg/L, salinitas 10–35 ppt, amonia <0,1 mg/L. Shrimp365 memungkinkan Anda mencatat parameter ini dari smartphone dan memberikan notifikasi otomatis saat nilai keluar dari batas normal.",
            },
          },
          {
            "@type": "Question",
            "name": "Is Shrimp365 free to use?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes, Shrimp365 is completely free. All features — unlimited farms, tanks, AI advisor, disease diagnosis, inventory management, and reports — are available at no cost. The platform is supported by advertising revenue.",
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
        <I18nProvider defaultLocale={defaultLocale} urlLocale={urlLocale}>
          <AuthProvider>{children}</AuthProvider>
          <VersionWatcher />
          <CookieConsent />
        </I18nProvider>
        <Analytics />
        <SpeedInsights />
        <AdSenseScript />
        <GoogleAnalytics />
      </body>
    </html>
  )
}
