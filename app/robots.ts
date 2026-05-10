import { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login", "/signup", "/pricing", "/privacy", "/terms", "/refund"],
        disallow: ["/dashboard", "/water-quality", "/journal", "/farms", "/diagnosis", "/production", "/inventory", "/ai-advisor", "/reports", "/onboarding", "/api/"],
      },
    ],
    sitemap: "https://www.shrimp365.kr/sitemap.xml",
  }
}
