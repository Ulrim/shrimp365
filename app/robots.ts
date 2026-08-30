import { MetadataRoute } from "next"

import { SHOW_BOARD, showCardNews } from "@/lib/features"

// 카드뉴스는 언어마다 주소가 다르다 — 한국어는 루트("/cardnews"),
// 나머지는 접두사가 붙는다("/en/cardnews"). 그래서 언어별로 갈라 놓아야
// 한국어판만 크롤을 막고 영어·베트남어·인도네시아어는 열어 둘 수 있다.
const CARDNEWS_PATHS = [
  { locale: "ko", path: "/cardnews" },
  { locale: "en", path: "/en/cardnews" },
  { locale: "vi", path: "/vi/cardnews" },
  { locale: "id", path: "/id/cardnews" },
]
const SHOWN_CARDNEWS = CARDNEWS_PATHS.filter(c => showCardNews(c.locale)).map(c => c.path)
const HIDDEN_CARDNEWS = CARDNEWS_PATHS.filter(c => !showCardNews(c.locale)).map(c => c.path)

// 감춘 섹션은 공개 목록에서 빼고 크롤도 막는다(색인에 남지 않게).
const HIDDEN_PATHS = [...(SHOW_BOARD ? [] : ["/board"]), ...HIDDEN_CARDNEWS]
const PUBLIC_PATHS = ["/", "/en", "/vi", "/id", "/demo", "/board", ...SHOWN_CARDNEWS, "/guide", "/login", "/signup", "/pricing", "/privacy", "/terms", "/opengraph-image", "/sitemap.xml"]
  .filter(p => !HIDDEN_PATHS.includes(p))
const PRIVATE_PATHS = [...HIDDEN_PATHS, "/home", "/daumlabs", "/dashboard", "/water-quality", "/journal", "/farms", "/diagnosis", "/production", "/inventory", "/ai-advisor", "/reports", "/admin", "/help", "/record", "/onboarding", "/api/", "/_next/"]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Default — all bots
      {
        userAgent: "*",
        allow: PUBLIC_PATHS,
        disallow: PRIVATE_PATHS,
        crawlDelay: 1,
      },
      // Naver (Korea)
      { userAgent: "Yeti", allow: PUBLIC_PATHS, disallow: [...HIDDEN_PATHS, "/api/", "/_next/"] },
      // Baidu
      { userAgent: "Baiduspider", allow: PUBLIC_PATHS, disallow: [...HIDDEN_PATHS, "/api/", "/_next/"] },
      // Bing
      { userAgent: "bingbot", allow: PUBLIC_PATHS, disallow: [...HIDDEN_PATHS, "/api/", "/_next/"] },
      // Yahoo Japan
      { userAgent: "Slurp", allow: PUBLIC_PATHS, disallow: [...HIDDEN_PATHS, "/api/", "/_next/"] },
      // AI search crawlers
      { userAgent: "GPTBot", allow: PUBLIC_PATHS, disallow: [...HIDDEN_PATHS, "/api/", "/_next/"] },
      { userAgent: "ChatGPT-User", allow: PUBLIC_PATHS, disallow: [...HIDDEN_PATHS, "/api/", "/_next/"] },
      { userAgent: "PerplexityBot", allow: PUBLIC_PATHS, disallow: [...HIDDEN_PATHS, "/api/", "/_next/"] },
      { userAgent: "ClaudeBot", allow: PUBLIC_PATHS, disallow: [...HIDDEN_PATHS, "/api/", "/_next/"] },
      { userAgent: "anthropic-ai", allow: PUBLIC_PATHS, disallow: [...HIDDEN_PATHS, "/api/", "/_next/"] },
      { userAgent: "cohere-ai", allow: PUBLIC_PATHS, disallow: [...HIDDEN_PATHS, "/api/", "/_next/"] },
      { userAgent: "YouBot", allow: PUBLIC_PATHS, disallow: [...HIDDEN_PATHS, "/api/", "/_next/"] },
      { userAgent: "Applebot", allow: PUBLIC_PATHS, disallow: [...HIDDEN_PATHS, "/api/", "/_next/"] },
      { userAgent: "Google-Extended", allow: PUBLIC_PATHS, disallow: [...HIDDEN_PATHS, "/api/", "/_next/"] },
      { userAgent: "Gemini", allow: PUBLIC_PATHS, disallow: [...HIDDEN_PATHS, "/api/", "/_next/"] },
    ],
    sitemap: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.shrimp365.kr"}/sitemap.xml`,
    host: process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.shrimp365.kr",
  }
}
