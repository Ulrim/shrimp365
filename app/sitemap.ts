import { MetadataRoute } from "next"

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.shrimp365.kr"

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

export default function sitemap(): MetadataRoute.Sitemap {
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
    {
      url: `${BASE}/refund`,
      lastModified: new Date("2026-01-01"),
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ]
}
