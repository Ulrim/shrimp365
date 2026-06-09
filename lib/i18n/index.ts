export type { Dict } from "./types"
export { ko } from "./ko"
export { en } from "./en"
export { vi } from "./vi"
export { id } from "./id"

export type Locale = "ko" | "en" | "vi" | "id"

export const LOCALES: Locale[] = ["ko", "en", "vi", "id"]

export const LOCALE_NAMES: Record<Locale, string> = {
  ko: "한국어",
  en: "English",
  vi: "Tiếng Việt",
  id: "Bahasa Indonesia",
}

// Map country codes to default locale
export function countryToLocale(country: string | undefined): Locale {
  if (!country) return "en"
  const upper = country.toUpperCase()
  if (upper === "KR") return "ko"
  if (upper === "VN") return "vi"
  if (upper === "ID") return "id"
  return "en"
}

// Parse Accept-Language header to a supported locale
export function headerToLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return "en"
  const langs = acceptLanguage
    .split(",")
    .map(l => l.split(";")[0].trim().toLowerCase().slice(0, 2))
  if (langs.includes("ko")) return "ko"
  if (langs.includes("vi")) return "vi"
  if (langs.includes("id")) return "id"
  return "en"
}
