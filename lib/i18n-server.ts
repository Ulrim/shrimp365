// 서버 컴포넌트에서 useT() 훅 없이 로케일/사전을 얻기 위한 헬퍼.
// root layout의 로케일 판별 로직(쿠키 → x-locale 헤더 → Accept-Language)과 동일한 우선순위.
import { cookies, headers } from "next/headers"
import { ko, en, vi, id, type Dict, type Locale, LOCALES, headerToLocale } from "@/lib/i18n"

const DICTS: Record<Locale, Dict> = { ko, en, vi, id }

export async function getServerLocale(): Promise<Locale> {
  const cookieStore = await cookies()
  const stored = cookieStore.get("shrimp365_lang")?.value
  if (stored && LOCALES.includes(stored as Locale)) return stored as Locale

  const headerStore = await headers()
  const xLocale = headerStore.get("x-locale")
  if (xLocale && LOCALES.includes(xLocale as Locale)) return xLocale as Locale

  return headerToLocale(headerStore.get("accept-language"))
}

export async function getServerDict(): Promise<{ locale: Locale; t: Dict }> {
  const locale = await getServerLocale()
  return { locale, t: DICTS[locale] }
}
