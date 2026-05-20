import { MetadataRoute } from "next"

const BASE = "https://www.shrimp365.kr"

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE,
      lastModified: new Date("2026-05-01"),
      changeFrequency: "weekly",
      priority: 1.0,
      alternates: {
        languages: { ko: BASE, en: BASE },
      },
    },
    {
      url: `${BASE}/guide`,
      lastModified: new Date("2026-05-20"),
      changeFrequency: "monthly",
      priority: 0.9,
      alternates: {
        languages: {
          ko: `${BASE}/guide`,
          en: `${BASE}/guide`,
        },
      },
    },
    {
      url: `${BASE}/signup`,
      lastModified: new Date("2026-05-01"),
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${BASE}/login`,
      lastModified: new Date("2026-05-01"),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE}/pricing`,
      lastModified: new Date("2026-05-01"),
      changeFrequency: "weekly",
      priority: 0.8,
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
    {
      url: `${BASE}/refund`,
      lastModified: new Date("2026-01-01"),
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ]
}
