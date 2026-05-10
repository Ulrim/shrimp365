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
    default: "Shrimp365 — AI 새우 양식 관리 플랫폼",
    template: "%s | Shrimp365",
  },
  description: "수질 모니터링, 생산 사이클, 질병 진단, AI 어드바이저까지 — 스마트 새우 양식 관리의 모든 것. 국내 새우 양식 농가를 위한 SaaS 솔루션.",
  keywords: ["새우 양식", "새우 농장 관리", "수질 모니터링", "양식 관리 시스템", "AI 양식", "흰다리새우", "바나메이 새우", "스마트 양식", "shrimp farming", "aquaculture management"],
  authors: [{ name: "Shrimp365" }],
  creator: "Shrimp365",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: "https://www.shrimp365.kr",
    siteName: "Shrimp365",
    title: "Shrimp365 — AI 새우 양식 관리 플랫폼",
    description: "수질 모니터링, 생산 사이클, 질병 진단, AI 어드바이저까지 — 스마트 새우 양식 관리의 모든 것.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Shrimp365" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Shrimp365 — AI 새우 양식 관리 플랫폼",
    description: "수질 모니터링, 생산 사이클, 질병 진단, AI 어드바이저까지 — 스마트 새우 양식 관리의 모든 것.",
    images: ["/opengraph-image"],
  },
  alternates: {
    canonical: "https://www.shrimp365.kr",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  verification: {
    google: "mNMCEXdK_oCiqIUM4SgQr6BahBkSMJ-ZZL7B64IAXaY",
    other: {
      "naver-site-verification": "40f2127ab44f4b5a851eff0591a11160b15ba8ef",
    },
  },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const stored = cookieStore.get("shrimp365_lang")?.value
  const defaultLocale: Locale =
    stored && LOCALES.includes(stored as Locale) ? (stored as Locale) : "ko"

  return (
    <html lang={defaultLocale} suppressHydrationWarning>
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
