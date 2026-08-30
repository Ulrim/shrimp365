import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { PublicHeader, PublicFooter } from "@/components/layout/public-header"
import { PricingBody } from "@/components/pricing/pricing-body"
import { PRICING } from "@/lib/content/pricing"
import type { Locale } from "@/lib/i18n"
import { BASE, hreflangMap, isMarketingLocale } from "@/lib/marketing-locale"

type Props = { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params
  if (!isMarketingLocale(lang)) return {}
  const p = PRICING[lang as Locale]
  const title = `${p.h1} ${p.h1Highlight}`
  return {
    title,
    description: p.lede.replace(/\n/g, " "),
    alternates: {
      canonical: `${BASE}/${lang}/pricing`,
      languages: hreflangMap("/pricing", ["ko", "en", "vi", "id"]),
    },
    openGraph: { title, description: p.lede.replace(/\n/g, " "), url: `${BASE}/${lang}/pricing`, type: "website" },
    robots: { index: true, follow: true },
  }
}

export default async function LocalePricingPage({ params }: Props) {
  const { lang } = await params
  if (!isMarketingLocale(lang)) notFound()
  return (
    <main className="min-h-screen bg-background text-foreground">
      <PublicHeader maxWidth="max-w-3xl" />
      <PricingBody p={PRICING[lang as Locale]} locale={lang} />
      <PublicFooter maxWidth="max-w-3xl" />
    </main>
  )
}
