import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getCardNewsServer, getCardNewsLocalesServer } from "@/lib/card-news-server"
import { ko } from "@/lib/i18n"
import { CardNewsDetailView, excerpt } from "@/components/cardnews/cardnews-detail-view"
import { BASE, hreflangMap } from "@/lib/marketing-locale"

export const revalidate = 300

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const decoded = decodeURIComponent(slug)
  const post = await getCardNewsServer(decoded, "ko")

  if (!post || post.locale !== "ko") {
    return { title: "카드뉴스를 찾을 수 없습니다", robots: { index: false, follow: false } }
  }

  const url = `${BASE}/cardnews/${encodeURIComponent(post.slug)}`
  const description = post.summary || excerpt(post.body) || "Shrimp365 카드뉴스"
  const cover = post.cover_url || post.images[0]
  // 실제로 등록된 언어판만 hreflang으로 연결한다.
  const locales = await getCardNewsLocalesServer(post.slug)

  return {
    title: post.title,
    description,
    keywords: post.tags.length ? post.tags : undefined,
    alternates: {
      canonical: url,
      languages: locales.length > 1 ? hreflangMap(`/cardnews/${encodeURIComponent(post.slug)}`, locales) : undefined,
    },
    openGraph: {
      title: post.title,
      description,
      url,
      type: "article",
      locale: "ko_KR",
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

export default async function CardNewsDetailPage({ params }: Props) {
  const { slug } = await params
  const decoded = decodeURIComponent(slug)
  const post = await getCardNewsServer(decoded, "ko")
  // 한국어판이 없으면 404 — 다른 언어 내용을 한국어 주소로 내보내지 않는다.
  if (!post || post.locale !== "ko") notFound()

  return <CardNewsDetailView post={post} locale="ko" t={ko} />
}
