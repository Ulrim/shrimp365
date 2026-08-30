import Link from "next/link"
import Image from "next/image"
import { Eye, Heart, Layers } from "lucide-react"
import { getCardNewsListServer } from "@/lib/card-news-server"
import { NewCardNewsButton } from "@/components/cardnews/new-cardnews-button"
import { BASE, localePrefix } from "@/lib/marketing-locale"
import type { Dict } from "@/lib/i18n"

function formatDate(iso: string, locale: string) {
  const tag = locale === "ko" ? "ko-KR" : locale === "vi" ? "vi-VN" : locale === "id" ? "id-ID" : "en-US"
  return new Date(iso).toLocaleDateString(tag, { year: "numeric", month: "2-digit", day: "2-digit" })
}

/**
 * 카드뉴스 목록 본문. 한국어(/cardnews)와 언어별 주소(/en/cardnews 등)가
 * 같은 화면을 쓰도록 분리했다. 서버 컴포넌트라 목록 전체가 초기 HTML에 들어간다.
 */
export async function CardNewsListView({ locale, t }: { locale: string; t: Dict }) {
  const posts = await getCardNewsListServer(locale)
  const c = t.cardNews
  const prefix = localePrefix(locale)
  const href = (slug: string) => `${prefix}/cardnews/${encodeURIComponent(slug)}`

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: c.title,
    description: c.subtitle,
    url: `${BASE}${prefix}/cardnews`,
    inLanguage: locale,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: posts.slice(0, 30).map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${BASE}${href(p.slug)}`,
        name: p.title,
      })),
    },
  }

  return (
    <div className="max-w-5xl mx-auto w-full animate-fade-in">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <span className="inline-block text-[11px] font-semibold tracking-wide text-[#1E40AF] border border-[#1E40AF]/30 bg-[#1E40AF]/5 rounded px-2 py-0.5 mb-2">
            {c.badge}
          </span>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{c.title}</h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">{c.subtitle}</p>
        </div>
        <NewCardNewsButton label={c.newPost} />
      </div>

      {posts.length === 0 ? (
        <div className="border border-border rounded-xl bg-card py-16 px-6 text-center">
          <Layers className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" aria-hidden="true" />
          <p className="font-semibold">{c.empty}</p>
          <p className="text-sm text-muted-foreground mt-1">{c.emptyMsg}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {posts.map((p) => {
            const cover = p.cover_url || p.images[0]
            return (
              <li key={p.id} className="border border-border rounded-xl bg-card overflow-hidden hover:border-[#1E40AF]/40 transition-colors">
                <Link href={href(p.slug)} className="block">
                  <div className="relative aspect-square bg-muted">
                    {cover ? (
                      <Image src={cover} alt={p.title} fill sizes="(max-width: 640px) 100vw, 33vw" className="object-cover" unoptimized />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Layers className="w-8 h-8 text-muted-foreground/30" aria-hidden="true" />
                      </div>
                    )}
                    {p.images.length > 1 && (
                      <span className="absolute top-2 right-2 text-[11px] font-semibold bg-black/60 text-white rounded px-1.5 py-0.5 tabular-nums">
                        {p.images.length}{c.cardsUnit}
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    <h2 className="font-bold leading-snug line-clamp-2">{p.title}</h2>
                    {p.summary && (
                      <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">{p.summary}</p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-3 tabular-nums">
                      <time dateTime={p.published_at}>{formatDate(p.published_at, locale)}</time>
                      <span className="flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                        {p.view_count}
                      </span>
                      <span className="flex items-center gap-1">
                        <Heart className="w-3.5 h-3.5" aria-hidden="true" />
                        {p.like_count ?? 0}
                      </span>
                    </div>
                    {p.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {p.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="text-[11px] text-[#1E40AF] bg-[#1E40AF]/5 border border-[#1E40AF]/20 rounded px-1.5 py-0.5">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
