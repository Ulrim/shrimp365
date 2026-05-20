import { MetadataRoute } from "next"

const BASE = "https://www.shrimp365.kr"

const LANG_ALTERNATES = {
  "x-default": BASE,
  "ko-KR": BASE,
  "en-US": BASE,
  "en-GB": BASE,
  "vi-VN": BASE,
  "th-TH": BASE,
  "ja-JP": BASE,
}

const GUIDE_ALTERNATES = {
  "x-default": `${BASE}/guide`,
  "ko-KR": `${BASE}/guide`,
  "en-US": `${BASE}/guide`,
  "en-GB": `${BASE}/guide`,
  "vi-VN": `${BASE}/guide`,
  "th-TH": `${BASE}/guide`,
  "ja-JP": `${BASE}/guide`,
}

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE,
      lastModified: new Date("2026-05-20"),
      changeFrequency: "weekly",
      priority: 1.0,
      alternates: { languages: LANG_ALTERNATES },
    },
    {
      url: `${BASE}/guide`,
      lastModified: new Date("2026-05-20"),
      changeFrequency: "monthly",
      priority: 0.9,
      alternates: { languages: GUIDE_ALTERNATES },
    },
    {
      url: `${BASE}/signup`,
      lastModified: new Date("2026-05-01"),
      changeFrequency: "monthly",
      priority: 0.9,
      alternates: {
        languages: {
          "x-default": `${BASE}/signup`,
          "ko-KR": `${BASE}/signup`,
          "en-US": `${BASE}/signup`,
          "en-GB": `${BASE}/signup`,
          "vi-VN": `${BASE}/signup`,
          "th-TH": `${BASE}/signup`,
          "ja-JP": `${BASE}/signup`,
        },
      },
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
      alternates: {
        languages: {
          "x-default": `${BASE}/pricing`,
          "ko-KR": `${BASE}/pricing`,
          "en-US": `${BASE}/pricing`,
          "en-GB": `${BASE}/pricing`,
          "vi-VN": `${BASE}/pricing`,
          "th-TH": `${BASE}/pricing`,
          "ja-JP": `${BASE}/pricing`,
        },
      },
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
