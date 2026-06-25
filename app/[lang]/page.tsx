import type { Metadata } from "next"
import { notFound } from "next/navigation"
import LandingPage from "@/components/landing/landing-page"

// Korean is served at the root ("/"). These prefixes provide distinct,
// server-rendered, indexable URLs per language so search engines and AI
// crawlers see localized content instead of the Korean default.
const MARKETING_LOCALES = ["en", "vi", "id"] as const
type MarketingLocale = (typeof MARKETING_LOCALES)[number]

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.shrimp365.kr"

const HREFLANG = {
  "x-default": BASE,
  "ko-KR": BASE,
  "en-US": `${BASE}/en`,
  "vi-VN": `${BASE}/vi`,
  "id-ID": `${BASE}/id`,
}

const SEO: Record<MarketingLocale, { title: string; description: string; ogLocale: string }> = {
  en: {
    title: "Shrimp365 | AI Shrimp Farm Management Platform",
    description:
      "AI-powered water quality monitoring, farm journal and disease diagnosis for vannamei shrimp farms. Free forever, no app install — manage feeding, inventory and health from your phone.",
    ogLocale: "en_US",
  },
  vi: {
    title: "Shrimp365 | Nền tảng quản lý trại nuôi tôm bằng AI",
    description:
      "Giám sát chất lượng nước, nhật ký ao nuôi và chẩn đoán bệnh cho tôm thẻ chân trắng bằng AI. Miễn phí trọn đời, không cần cài app — quản lý cho ăn, kho và sức khỏe tôm ngay trên điện thoại.",
    ogLocale: "vi_VN",
  },
  id: {
    title: "Shrimp365 | Platform Manajemen Tambak Udang berbasis AI",
    description:
      "Monitoring kualitas air, jurnal tambak, dan diagnosis penyakit udang vaname berbasis AI. Gratis selamanya, tanpa instal aplikasi — kelola pakan, stok, dan kesehatan udang dari ponsel Anda.",
    ogLocale: "id_ID",
  },
}

function isMarketingLocale(v: string): v is MarketingLocale {
  return (MARKETING_LOCALES as readonly string[]).includes(v)
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>
}): Promise<Metadata> {
  const { lang } = await params
  if (!isMarketingLocale(lang)) return {}
  const seo = SEO[lang]
  return {
    title: seo.title,
    description: seo.description,
    alternates: {
      canonical: `${BASE}/${lang}`,
      languages: HREFLANG,
    },
    openGraph: {
      title: seo.title,
      description: seo.description,
      url: `${BASE}/${lang}`,
      locale: seo.ogLocale,
    },
    twitter: {
      title: seo.title,
      description: seo.description,
    },
  }
}

export default async function LocaleLandingPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  if (!isMarketingLocale(lang)) notFound()
  // Language is applied by the root layout's I18nProvider, which reads the
  // x-locale request header set by the proxy/middleware for these routes.
  return <LandingPage />
}
