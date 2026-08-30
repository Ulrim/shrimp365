import type { Locale } from "@/lib/i18n"

/** 한국어는 루트("/")에서 서비스하고, 나머지는 접두사 경로를 갖는다.
 *  검색엔진이 언어별로 따로 색인할 수 있도록 하는 것이 목적이다. */
export const MARKETING_LOCALES = ["en", "vi", "id"] as const
export type MarketingLocale = (typeof MARKETING_LOCALES)[number]

export const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.shrimp365.kr"

export function isMarketingLocale(v: string): v is MarketingLocale {
  return (MARKETING_LOCALES as readonly string[]).includes(v)
}

/** 해당 언어의 경로 접두사. 한국어는 접두사가 없다. */
export function localePrefix(locale: string): string {
  return isMarketingLocale(locale) ? `/${locale}` : ""
}

export const HREFLANG_TAG: Record<string, string> = {
  ko: "ko-KR",
  en: "en-US",
  vi: "vi-VN",
  id: "id-ID",
}

/** 실제로 존재하는 언어판만 hreflang으로 연결한다.
 *  없는 언어를 넣으면 검색엔진이 잘못된 대체 페이지를 제시하게 된다. */
export function hreflangMap(path: string, locales: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of locales) {
    const tag = HREFLANG_TAG[l]
    if (tag) out[tag] = `${BASE}${localePrefix(l)}${path}`
  }
  // x-default는 한국어(루트)가 있을 때만. 없으면 영어를 기본으로 둔다.
  if (locales.includes("ko")) out["x-default"] = `${BASE}${path}`
  else if (locales.includes("en")) out["x-default"] = `${BASE}/en${path}`
  return out
}

/** 언어별 URL을 제공하는 공개 경로. 이 목록에 있는 경로에서만
 *  언어 전환이 주소 이동으로 동작한다(없는 주소로 보내면 404가 난다). */
export const LOCALIZED_PATHS = ["/", "/cardnews", "/board", "/guide", "/pricing", "/terms", "/privacy"]

export function hasLocalizedUrl(pathname: string): boolean {
  const p = stripLocalePrefix(pathname).path
  return LOCALIZED_PATHS.some((base) => (base === "/" ? p === "/" : p === base || p.startsWith(base + "/")))
}

/** 경로에서 언어 접두사를 떼어 낸다. */
export function stripLocalePrefix(pathname: string): { locale: Locale; path: string } {
  const seg = pathname.split("/")[1]
  if (isMarketingLocale(seg)) {
    const rest = pathname.slice(seg.length + 1)
    return { locale: seg as Locale, path: rest === "" ? "/" : rest }
  }
  return { locale: "ko", path: pathname || "/" }
}

/** 언어를 바꿨을 때 이동할 주소. */
export function localizedHref(pathname: string, locale: string): string {
  const { path } = stripLocalePrefix(pathname)
  const prefix = localePrefix(locale)
  return path === "/" ? prefix || "/" : `${prefix}${path}`
}
