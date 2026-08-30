import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getCardNewsServer, getCardNewsLocalesServer } from "@/lib/card-news-server"
import { CardNewsDetailView, excerpt } from "@/components/cardnews/cardnews-detail-view"
import { ko, en, vi, id, type Dict, type Locale } from "@/lib/i18n"
import { BASE, hreflangMap, isMarketingLocale, HREFLANG_TAG } from "@/lib/marketing-locale"
import { visibleCardNewsLocales } from "@/lib/features"

export const revalidate = 300

const DICTS: Record<Locale, Dict> = { ko, en, vi, id }

type Props = { params: Promise<{ lang: string; slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = await params
  if (!isMarketingLocale(lang)) return {}
  const decoded = decodeURIComponent(slug)
  const post = await getCardNewsServer(decoded, lang)
  if (!post || post.locale !== lang) {
    return { title: "Not found", robots: { index: false, follow: false } }
  }

  const path = `/cardnews/${encodeURIComponent(post.slug)}`
  const url = `${BASE}/${lang}${path}`
  const description = post.summary || excerpt(post.body)
  const cover = post.cover_url || post.images[0]
  const locales = await getCardNewsLocalesServer(post.slug)

  return {
    title: post.title,
    description,
    keywords: post.tags.length ? post.tags : undefined,
    alternates: {
      canonical: url,
      languages: visibleCardNewsLocales(locales).length > 1 ? hreflangMap(path, visibleCardNewsLocales(locales)) : undefined,
    },
    openGraph: {
      title: post.title,
      description,
      url,
      type: "article",
      locale: (HREFLANG_TAG[lang] ?? "en-US").replace("-", "_"),
      publishedTime: post.published_at,
      modifiedTime: post.updated_at,
      images: cover ? [{ url: cover, width: 1080, height: 1080, alt: post.title }] : undefined,
    },
    twitter: {
      card: cover ? "summary_large_image" : "summary",
      title: post.title,
      description,
      images: cover ? [cover] : undefined,
    },
  }
}

export default async function LocaleCardNewsDetailPage({ params }: Props) {
  const { lang, slug } = await params
  if (!isMarketingLocale(lang)) notFound()
  const decoded = decodeURIComponent(slug)
  const post = await getCardNewsServer(decoded, lang)
  // 해당 언어판이 없으면 404. 다른 언어 내용을 이 주소로 내보내면
  // 검색엔진이 중복 콘텐츠로 판단하고, 방문자도 엉뚱한 언어를 보게 된다.
  if (!post || post.locale !== lang) notFound()

  return <CardNewsDetailView post={post} locale={lang} t={DICTS[lang as Locale]} />
}
