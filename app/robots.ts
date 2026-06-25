import { MetadataRoute } from "next"

const PUBLIC_PATHS = ["/", "/en", "/vi", "/id", "/demo", "/guide", "/login", "/signup", "/pricing", "/privacy", "/terms", "/refund", "/opengraph-image", "/sitemap.xml"]
const PRIVATE_PATHS = ["/home", "/dashboard", "/water-quality", "/journal", "/farms", "/diagnosis", "/production", "/inventory", "/ai-advisor", "/reports", "/admin", "/help", "/record", "/onboarding", "/api/", "/_next/"]

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
      { userAgent: "Yeti", allow: PUBLIC_PATHS, disallow: ["/api/", "/_next/"] },
      // Baidu
      { userAgent: "Baiduspider", allow: PUBLIC_PATHS, disallow: ["/api/", "/_next/"] },
      // Bing
      { userAgent: "bingbot", allow: PUBLIC_PATHS, disallow: ["/api/", "/_next/"] },
      // Yahoo Japan
      { userAgent: "Slurp", allow: PUBLIC_PATHS, disallow: ["/api/", "/_next/"] },
      // AI search crawlers
      { userAgent: "GPTBot", allow: PUBLIC_PATHS, disallow: ["/api/", "/_next/"] },
      { userAgent: "ChatGPT-User", allow: PUBLIC_PATHS, disallow: ["/api/", "/_next/"] },
      { userAgent: "PerplexityBot", allow: PUBLIC_PATHS, disallow: ["/api/", "/_next/"] },
      { userAgent: "ClaudeBot", allow: PUBLIC_PATHS, disallow: ["/api/", "/_next/"] },
      { userAgent: "anthropic-ai", allow: PUBLIC_PATHS, disallow: ["/api/", "/_next/"] },
      { userAgent: "cohere-ai", allow: PUBLIC_PATHS, disallow: ["/api/", "/_next/"] },
      { userAgent: "YouBot", allow: PUBLIC_PATHS, disallow: ["/api/", "/_next/"] },
      { userAgent: "Applebot", allow: PUBLIC_PATHS, disallow: ["/api/", "/_next/"] },
      { userAgent: "Google-Extended", allow: PUBLIC_PATHS, disallow: ["/api/", "/_next/"] },
      { userAgent: "Gemini", allow: PUBLIC_PATHS, disallow: ["/api/", "/_next/"] },
    ],
    sitemap: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.shrimp365.kr"}/sitemap.xml`,
    host: process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.shrimp365.kr",
  }
}
