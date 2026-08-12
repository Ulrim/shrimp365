import { MetadataRoute } from "next"
import { SHOW_BOARD, SHOW_CARDNEWS } from "@/lib/features"
import { getAllCardNewsServer } from "@/lib/card-news-server"
import { hreflangMap, localePrefix, MARKETING_LOCALES } from "@/lib/marketing-locale"

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
  // 카드뉴스는 언어별로 독립된 URL을 갖는다(한국어는 루트, 나머지는 /en·/vi·/id).
  // 각 URL을 사이트맵에 올리고, 같은 글의 다른 언어판을 hreflang으로 묶어
  // 검색엔진이 방문자 언어에 맞는 페이지를 고르게 한다.
  const cardNews = await getAllCardNewsServer()
  const localesBySlug = new Map<string, Set<string>>()
  const updatedBySlugLocale = new Map<string, string>()
  for (const p of cardNews) {
    if (!localesBySlug.has(p.slug)) localesBySlug.set(p.slug, new Set())
    localesBySlug.get(p.slug)!.add(p.locale)
    updatedBySlugLocale.set(`${p.slug}|${p.locale}`, p.updated_at)
  }

  const cardNewsEntries: MetadataRoute.Sitemap = []
  for (const [slug, locales] of localesBySlug) {
    const path = `/cardnews/${encodeURIComponent(slug)}`
    const languages = hreflangMap(path, [...locales])
    for (const locale of locales) {
      cardNewsEntries.push({
        url: `${BASE}${localePrefix(locale)}${path}`,
        lastModified: new Date(updatedBySlugLocale.get(`${slug}|${locale}`) ?? Date.now()),
        changeFrequency: "monthly",
        priority: 0.7,
        alternates: { languages },
      })
    }
  }

  // 언어별 카드뉴스 목록 페이지
  const cardNewsIndexLocales = new Set(cardNews.map((p) => p.locale))
  const cardNewsIndexEntries: MetadataRoute.Sitemap = [...cardNewsIndexLocales].map((locale) => ({
    url: `${BASE}${localePrefix(locale)}/cardnews`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.9,
    alternates: { languages: hreflangMap("/cardnews", [...cardNewsIndexLocales]) },
  }))

  // 정적 공개 페이지 — 4개 언어 모두 실제 주소가 있으므로 언어별로 등록한다.
  const ALL_LOCALES = ["ko", ...MARKETING_LOCALES]
  const localizedPage = (
    path: string,
    lastModified: Date,
    changeFrequency: "daily" | "weekly" | "monthly" | "yearly",
    priority: number,
  ): MetadataRoute.Sitemap =>
    ALL_LOCALES.map((l) => ({
      url: `${BASE}${localePrefix(l)}${path}`,
      lastModified,
      changeFrequency,
      priority,
      alternates: { languages: hreflangMap(path, ALL_LOCALES) },
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
    ...(SHOW_BOARD ? localizedPage("/board", new Date("2026-07-24"), "daily", 0.7) : []),
    // Card news — 언어별 목록 + 글 (랜딩 다음으로 SEO 가치가 큰 공개 콘텐츠)
    ...(SHOW_CARDNEWS ? cardNewsIndexEntries : []),
    ...(SHOW_CARDNEWS ? cardNewsEntries : []),
    // 4개 언어 모두 제공되는 콘텐츠 페이지
    ...localizedPage("/guide", new Date("2026-07-29"), "monthly", 0.8),
    ...localizedPage("/pricing", new Date("2026-07-29"), "monthly", 0.6),
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
    ...localizedPage("/privacy", new Date("2026-01-01"), "yearly", 0.3),
    ...localizedPage("/terms", new Date("2026-01-01"), "yearly", 0.3),
  ]
}
