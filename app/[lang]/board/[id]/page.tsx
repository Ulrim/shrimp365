import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { getPostServer, getCommentsServer } from "@/lib/board-server"
import { PostArticle } from "@/components/board/post-article"
import { ko, en, vi, id as idDict, type Dict, type Locale } from "@/lib/i18n"
import { BASE, isMarketingLocale, HREFLANG_TAG } from "@/lib/marketing-locale"

const DICTS: Record<Locale, Dict> = { ko, en, vi, id: idDict }

function excerpt(content: string, max = 150): string {
  const flat = content.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

type Props = { params: Promise<{ lang: string; id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, id } = await params
  if (!isMarketingLocale(lang)) return {}
  const post = await getPostServer(id)
  // 다른 언어로 쓰인 글은 이 주소로 노출하지 않는다.
  if (!post || post.locale !== lang) {
    return { title: "Not found", robots: { index: false, follow: false } }
  }

  const description = excerpt(post.content) || DICTS[lang as Locale].board.subtitle
  const url = `${BASE}/${lang}/board/${id}`

  return {
    title: post.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: post.title,
      description,
      url,
      type: "article",
      locale: (HREFLANG_TAG[lang] ?? "en-US").replace("-", "_"),
      images: post.image_url ? [{ url: post.image_url }] : undefined,
    },
    twitter: {
      card: post.image_url ? "summary_large_image" : "summary",
      title: post.title,
      description,
      images: post.image_url ? [post.image_url] : undefined,
    },
  }
}

export default async function LocalePostDetailPage({ params }: Props) {
  const { lang, id } = await params
  if (!isMarketingLocale(lang)) notFound()

  const [post, comments] = await Promise.all([getPostServer(id), getCommentsServer(id)])
  // 언어가 다르면 404 — 같은 글이 여러 언어 주소로 중복 노출되지 않게 한다.
  if (!post || post.locale !== lang) notFound()

  const b = DICTS[lang as Locale].board

  return (
    <div className="max-w-2xl mx-auto w-full animate-fade-in">
      <Link
        href={`/${lang}/board`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 min-h-[44px]"
      >
        <ArrowLeft className="w-4 h-4" />
        {b.back}
      </Link>
      <PostArticle post={post} initialComments={comments} />
    </div>
  )
}
