import { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/guide",
          "/login",
          "/signup",
          "/pricing",
          "/privacy",
          "/terms",
          "/refund",
          "/opengraph-image",
          "/sitemap.xml",
        ],
        disallow: [
          "/home",
          "/dashboard",
          "/water-quality",
          "/journal",
          "/farms",
          "/diagnosis",
          "/production",
          "/inventory",
          "/ai-advisor",
          "/reports",
          "/admin",
          "/help",
          "/record",
          "/onboarding",
          "/api/",
          "/_next/",
        ],
        crawlDelay: 1,
      },
      // Naver bot
      {
        userAgent: "Yeti",
        allow: [
          "/",
          "/guide",
          "/login",
          "/signup",
          "/pricing",
          "/privacy",
          "/terms",
          "/refund",
        ],
        disallow: ["/api/", "/_next/"],
      },
    ],
    sitemap: "https://www.shrimp365.kr/sitemap.xml",
    host: "https://www.shrimp365.kr",
  }
}
