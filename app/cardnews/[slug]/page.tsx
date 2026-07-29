import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { notFound } from "next/navigation"
import { ArrowLeft, ArrowRight, Eye, Heart } from "lucide-react"
import { getCardNewsServer, getRelatedCardNewsServer } from "@/lib/card-news-server"
import { getServerDict } from "@/lib/i18n-server"
import { CardDeck } from "@/components/cardnews/card-deck"
import { CardNewsViewPing } from "@/components/cardnews/view-ping"
import { LikeButton } from "@/components/ui/like-button"

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.shrimp365.kr"
const LOCALE_TAG: Record<string, string> = { ko: "ko-KR", en: "en-US", vi: "vi-VN", id: "id-ID" }

export const revalidate = 300

type Props = { params: Promise<{ slug: string }> }

function excerpt(text: string, max = 155): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const decoded = decodeURIComponent(slug)
  const { locale } = await getServerDict()
  const post = await getCardNewsServer(decoded, locale)

  if (!post) {
    return { title: "카드뉴스를 찾을 수 없습니다", robots: { index: false, follow: false } }
  }

  const url = `${BASE}/cardnews/${encodeURIComponent(post.slug)}`
  const description = post.summary || excerpt(post.body) || "Shrimp365 카드뉴스"
  const cover = post.cover_url || post.images[0]

  // hreflang은 넣지 않는다. 카드뉴스는 언어별 URL이 따로 있는 구조가 아니라
  // 하나의 URL이 방문자 언어에 따라 다른 내용을 내보내는 방식(dynamic serving)이라,
  // 모든 언어를 같은 주소로 가리키는 hreflang은 검색엔진에 잘못된 신호를 준다.

  return {
    title: post.title,
    description,
    keywords: post.tags.length ? post.tags : undefined,
    alternates: { canonical: url },
    openGraph: {
      title: post.title,
      description,
      url,
      type: "article",
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
  const { t, locale } = await getServerDict()
  const post = await getCardNewsServer(decoded, locale)
  if (!post) notFound()

  const c = t.cardNews
  const related = await getRelatedCardNewsServer(post)
  const url = `${BASE}/cardnews/${encodeURIComponent(post.slug)}`
  const cover = post.cover_url || post.images[0]
  const tag = LOCALE_TAG[locale] ?? "ko-KR"

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: post.title,
      description: post.summary || excerpt(post.body),
      image: post.images.length ? post.images : cover ? [cover] : undefined,
      datePublished: post.published_at,
      dateModified: post.updated_at,
      inLanguage: post.locale,
      keywords: post.tags.join(", ") || undefined,
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      interactionStatistic: [
        {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/ViewAction",
          userInteractionCount: post.view_count,
        },
        {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/LikeAction",
          userInteractionCount: post.like_count ?? 0,
        },
      ],
      author: { "@type": "Organization", name: "Shrimp365", url: BASE },
      publisher: {
        "@type": "Organization",
        name: "CULIVER INC.",
        url: BASE,
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Shrimp365", item: BASE },
        { "@type": "ListItem", position: 2, name: c.title, item: `${BASE}/cardnews` },
        { "@type": "ListItem", position: 3, name: post.title, item: url },
      ],
    },
  ]

  return (
    <div className="max-w-2xl mx-auto w-full animate-fade-in">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <CardNewsViewPing id={post.id} />

      <nav aria-label="breadcrumb" className="mb-4">
        <Link href="/cardnews" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground min-h-[44px]">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          {c.backToList}
        </Link>
      </nav>

      <article>
        <header className="mb-5">
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight tracking-tight">{post.title}</h1>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-3 tabular-nums">
            <time dateTime={post.published_at}>
              {new Date(post.published_at).toLocaleDateString(tag, { year: "numeric", month: "2-digit", day: "2-digit" })}
            </time>
            <span className="flex items-center gap-1">
              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              {post.view_count}
            </span>
            <span className="flex items-center gap-1">
              <Heart className="w-3.5 h-3.5" aria-hidden="true" />
              {post.like_count ?? 0}
            </span>
            {post.images.length > 0 && <span>{post.images.length}{c.cardsUnit}</span>}
          </div>
          {post.summary && (
            <p className="text-[15px] text-muted-foreground mt-4 leading-relaxed">{post.summary}</p>
          )}
        </header>

        <CardDeck
          images={post.images}
          title={post.title}
          labels={{ prev: c.prev, next: c.next, cardIndex: c.cardIndex, saveImage: c.saveImage }}
        />

        {/* 본문 — 이미지 속 글자는 검색엔진이 읽지 못하므로 텍스트 본문이 실제 SEO 자산이다. */}
        {post.body && (
          <div className="mt-8 text-[15px] leading-[1.85] whitespace-pre-line text-foreground">
            {post.body}
          </div>
        )}

        <div className="mt-8 flex justify-center">
          <LikeButton kind="cardnews" id={post.id} initialCount={post.like_count ?? 0} />
        </div>

        {post.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 mt-8">
            {post.tags.map((tg) => (
              <li key={tg} className="text-xs text-[#1E40AF] bg-[#1E40AF]/5 border border-[#1E40AF]/20 rounded px-2 py-1">
                #{tg}
              </li>
            ))}
          </ul>
        )}
      </article>

      {/* 서비스 전환 CTA */}
      <aside className="mt-10 border border-[#1E40AF]/25 bg-[#1E40AF]/[0.04] rounded-xl p-5 sm:p-6">
        <h2 className="font-bold text-lg">{c.ctaTitle}</h2>
        <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{c.ctaDesc}</p>
        <Link
          href="/signup"
          className="mt-4 inline-flex items-center gap-1.5 bg-[#1E40AF] hover:bg-[#3B82F6] text-white text-sm font-semibold px-5 min-h-[44px] rounded-lg transition-colors"
        >
          {c.ctaButton}
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </aside>

      {related.length > 0 && (
        <section className="mt-10">
          <h2 className="font-bold mb-3">{c.related}</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {related.map((r) => {
              const rc = r.cover_url || r.images[0]
              return (
                <li key={r.id} className="border border-border rounded-xl bg-card overflow-hidden hover:border-[#1E40AF]/40 transition-colors">
                  <Link href={`/cardnews/${encodeURIComponent(r.slug)}`} className="block">
                    <div className="relative aspect-square bg-muted">
                      {rc && <Image src={rc} alt={r.title} fill sizes="200px" className="object-cover" unoptimized />}
                    </div>
                    <p className="p-3 text-sm font-semibold leading-snug line-clamp-2">{r.title}</p>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
