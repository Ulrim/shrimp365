import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { PublicHeader, PublicFooter } from "@/components/layout/public-header"
import { TermsBody } from "@/components/legal/terms-body"
import { ko, en, vi, id, type Dict, type Locale } from "@/lib/i18n"
import { BASE, hreflangMap, isMarketingLocale } from "@/lib/marketing-locale"

const DICTS: Record<Locale, Dict> = { ko, en, vi, id }

type Props = { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params
  if (!isMarketingLocale(lang)) return {}
  const title = DICTS[lang as Locale].settings.legalTerms
  return {
    title,
    alternates: {
      canonical: `${BASE}/${lang}/terms`,
      languages: hreflangMap("/terms", ["ko", "en", "vi", "id"]),
    },
    robots: { index: true, follow: true },
  }
}

export default async function LocaleTermsPage({ params }: Props) {
  const { lang } = await params
  if (!isMarketingLocale(lang)) notFound()
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader maxWidth="max-w-3xl" />
      <TermsBody lang={lang} />
      <PublicFooter maxWidth="max-w-3xl" />
    </div>
  )
}
