import { MetadataRoute } from "next"

const PUBLIC_PATHS = ["/", "/guide", "/login", "/signup", "/pricing", "/privacy", "/terms", "/refund", "/opengraph-image", "/sitemap.xml"]
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
      {
        userAgent: "Yeti",
        allow: PUBLIC_PATHS,
        disallow: ["/api/", "/_next/"],
      },
      // Baidu (China — potential gateway to Vietnamese/Thai users via Chinese diaspora)
      {
        userAgent: "Baiduspider",
        allow: PUBLIC_PATHS,
        disallow: ["/api/", "/_next/"],
      },
      // Bing (USA / Europe / Japan)
      {
        userAgent: "bingbot",
        allow: PUBLIC_PATHS,
        disallow: ["/api/", "/_next/"],
      },
      // Yahoo Japan
      {
        userAgent: "Slurp",
        allow: PUBLIC_PATHS,
        disallow: ["/api/", "/_next/"],
      },
    ],
    sitemap: "https://www.shrimp365.kr/sitemap.xml",
    host: "https://www.shrimp365.kr",
  }
}
