import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { BoardListView } from "@/components/board/board-list-view"
import { ko, en, vi, id, type Dict, type Locale } from "@/lib/i18n"
import { BASE, hreflangMap, isMarketingLocale } from "@/lib/marketing-locale"

const DICTS: Record<Locale, Dict> = { ko, en, vi, id }

type Props = { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params
  if (!isMarketingLocale(lang)) return {}
  const b = DICTS[lang as Locale].board
  return {
    title: b.title,
    description: b.subtitle,
    alternates: {
      canonical: `${BASE}/${lang}/board`,
      languages: hreflangMap("/board", ["ko", "en", "vi", "id"]),
    },
    openGraph: { title: b.title, description: b.subtitle, url: `${BASE}/${lang}/board`, type: "website" },
    robots: { index: true, follow: true },
  }
}

export default async function LocaleBoardPage({ params }: Props) {
  const { lang } = await params
  if (!isMarketingLocale(lang)) notFound()
  // 사전은 URL의 언어로 고정한다(쿠키를 따르면 /en 주소에서 한국어가 나온다).
  return <BoardListView locale={lang} t={DICTS[lang as Locale]} />
}
