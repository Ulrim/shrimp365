import { MetadataRoute } from "next"
import { getAllCardNewsServer } from "@/lib/card-news-server"

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.shrimp365.kr"

// 카드뉴스가 추가되면 사이트맵도 따라 갱신되어야 하므로 정적 고정하지 않는다.
export const revalidate = 300

// Distinct, server-rendered URL per language (Korean = root). Only languages
// that are actually rendered are advertised — no false hreflang signals.
const LANDING_ALTERNATES = {
  "x-default": BASE,
  "ko-KR": BASE,
  "en-US": `${BASE}/en`,
  "en-GB": `${BASE}/en`,
  "vi-VN": `${BASE}/vi`,
  "id-ID": `${BASE}/id`,
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // 게시된 카드뉴스를 개별 URL로 등록 — 색인 대상이 되는 실제 콘텐츠.
  // 같은 slug의 다국어판은 URL이 하나뿐(방문자 언어에 따라 내용이 달라짐)이므로
  // slug 기준으로 합쳐 중복 URL이 사이트맵에 들어가지 않게 한다.
  const cardNews = await getAllCardNewsServer()
  const latestBySlug = new Map<string, string>()
  for (const p of cardNews) {
    const prev = latestBySlug.get(p.slug)
    if (!prev || p.updated_at > prev) latestBySlug.set(p.slug, p.updated_at)
  }
  const cardNewsEntries: MetadataRoute.Sitemap = [...latestBySlug].map(([slug, updatedAt]) => ({
    url: `${BASE}/cardnews/${encodeURIComponent(slug)}`,
    lastModified: new Date(updatedAt),
    changeFrequency: "monthly",
    priority: 0.7,
  }))

  return [
    // Landing — Korean (root) + cross-referenced language versions
    {
      url: BASE,
      lastModified: new Date("2026-06-25"),
      changeFrequency: "weekly",
      priority: 1.0,
      alternates: { languages: LANDING_ALTERNATES },
    },
    {
      url: `${BASE}/en`,
      lastModified: new Date("2026-06-25"),
      changeFrequency: "weekly",
      priority: 0.9,
      alternates: { languages: LANDING_ALTERNATES },
    },
    {
      url: `${BASE}/vi`,
      lastModified: new Date("2026-06-25"),
      changeFrequency: "weekly",
      priority: 0.9,
      alternates: { languages: LANDING_ALTERNATES },
    },
    {
      url: `${BASE}/id`,
      lastModified: new Date("2026-06-25"),
      changeFrequency: "weekly",
      priority: 0.9,
      alternates: { languages: LANDING_ALTERNATES },
    },
    // Public demo (no login required)
    {
      url: `${BASE}/demo`,
      lastModified: new Date("2026-06-25"),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    // Community board — public read (login only for posting)
    {
      url: `${BASE}/board`,
      lastModified: new Date("2026-07-24"),
      changeFrequency: "daily",
      priority: 0.7,
    },
    // Card news archive — public content hub (highest SEO value after landing)
    {
      url: `${BASE}/cardnews`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    ...cardNewsEntries,
    // Korean-only content pages (not yet translated → no language alternates)
    {
      url: `${BASE}/guide`,
      lastModified: new Date("2026-05-20"),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE}/pricing`,
      lastModified: new Date("2026-06-25"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${BASE}/signup`,
      lastModified: new Date("2026-05-01"),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE}/login`,
      lastModified: new Date("2026-05-01"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${BASE}/privacy`,
      lastModified: new Date("2026-01-01"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE}/terms`,
      lastModified: new Date("2026-01-01"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ]
}
