import Link from "next/link"
import Image from "next/image"
import { Eye, Layers } from "lucide-react"
import { getCardNewsListServer } from "@/lib/card-news-server"
import { getServerDict } from "@/lib/i18n-server"
import { NewCardNewsButton } from "@/components/cardnews/new-cardnews-button"

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.shrimp365.kr"

// 새 글 등록 시 /api/cardnews가 revalidatePath로 갱신하지만,
// 그와 별개로 5분마다 재생성해 캐시가 오래 굳지 않도록 한다.
export const revalidate = 300

function formatDate(iso: string, locale: string) {
  const tag = locale === "ko" ? "ko-KR" : locale === "vi" ? "vi-VN" : locale === "id" ? "id-ID" : "en-US"
  return new Date(iso).toLocaleDateString(tag, { year: "numeric", month: "2-digit", day: "2-digit" })
}

// 서버 컴포넌트 — 목록 전체가 초기 HTML에 포함되어 크롤러가 JS 없이 색인한다.
export default async function CardNewsPage() {
  const { t, locale } = await getServerDict()
  const posts = await getCardNewsListServer(locale)
  const c = t.cardNews

  // 목록 구조화 데이터 — 검색결과에 항목 리스트로 인식되도록.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: c.title,
    description: c.subtitle,
    url: `${BASE}/cardnews`,
    inLanguage: locale,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: posts.slice(0, 30).map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${BASE}/cardnews/${encodeURIComponent(p.slug)}`,
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
                <Link href={`/cardnews/${encodeURIComponent(p.slug)}`} className="block">
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
