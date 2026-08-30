import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CardNewsListView } from "@/components/cardnews/cardnews-list-view"
import { ko, en, vi, id, type Dict, type Locale } from "@/lib/i18n"
import { BASE, hreflangMap, isMarketingLocale } from "@/lib/marketing-locale"
import { visibleCardNewsLocales } from "@/lib/features"

export const revalidate = 300

const DICTS: Record<Locale, Dict> = { ko, en, vi, id }

type Props = { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params
  if (!isMarketingLocale(lang)) return {}
  const c = DICTS[lang as Locale].cardNews
  return {
    title: c.title,
    description: c.subtitle,
    alternates: {
      canonical: `${BASE}/${lang}/cardnews`,
      languages: hreflangMap("/cardnews", visibleCardNewsLocales(["ko", "en", "vi", "id"])),
    },
    openGraph: {
      title: c.title,
      description: c.subtitle,
      url: `${BASE}/${lang}/cardnews`,
      type: "website",
    },
    robots: { index: true, follow: true },
  }
}

export default async function LocaleCardNewsPage({ params }: Props) {
  const { lang } = await params
  if (!isMarketingLocale(lang)) notFound()
  // 사전은 URL의 언어로 고정한다. 쿠키(사용자 설정)를 따르면 /en 주소에서
  // 한국어가 나올 수 있어 언어별 URL을 만든 의미가 사라진다.
  return <CardNewsListView locale={lang} t={DICTS[lang as Locale]} />
}
