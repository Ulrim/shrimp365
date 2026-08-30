import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { PublicHeader, PublicFooter } from "@/components/layout/public-header"
import { GuideBody } from "@/components/guide/guide-body"
import { GUIDE } from "@/lib/content/guide"
import type { Locale } from "@/lib/i18n"
import { BASE, hreflangMap, isMarketingLocale } from "@/lib/marketing-locale"

type Props = { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params
  if (!isMarketingLocale(lang)) return {}
  const g = GUIDE[lang as Locale]
  return {
    title: `${g.h1} ${g.h1Highlight}`,
    description: g.lede,
    alternates: {
      canonical: `${BASE}/${lang}/guide`,
      languages: hreflangMap("/guide", ["ko", "en", "vi", "id"]),
    },
    openGraph: { title: g.h1Highlight, description: g.lede, url: `${BASE}/${lang}/guide`, type: "website" },
    robots: { index: true, follow: true },
  }
}

export default async function LocaleGuidePage({ params }: Props) {
  const { lang } = await params
  if (!isMarketingLocale(lang)) notFound()
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader maxWidth="max-w-4xl" />
      <GuideBody g={GUIDE[lang as Locale]} />
      <PublicFooter maxWidth="max-w-4xl" />
    </div>
  )
}
