"use client"

import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from "react"
import { ko, en, vi, id, type Dict, type Locale, LOCALES } from "@/lib/i18n"
import { agriDict, type AgriDict } from "@/lib/i18n/agri"

const COOKIE_NAME = "shrimp365_lang"
const STORAGE_KEY = "shrimp365_lang"

const DICTS: Record<Locale, Dict> = { ko, en, vi, id }

interface I18nContextType {
  locale: Locale
  t: Dict
  setLocale: (locale: Locale) => void
}

const I18nContext = createContext<I18nContextType | null>(null)

function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && LOCALES.includes(stored as Locale)) return stored as Locale
  } catch {}
  return null
}

function readCookieLocale(): Locale | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`))
  if (match && LOCALES.includes(match[1] as Locale)) return match[1] as Locale
  return null
}

function writeCookie(locale: Locale) {
  document.cookie = `${COOKIE_NAME}=${locale};path=/;max-age=31536000;SameSite=Lax`
}

export function I18nProvider({
  children,
  defaultLocale,
  urlLocale = null,
}: {
  children: ReactNode
  defaultLocale: Locale
  /**
   * When set (localized marketing URLs like /en, /id), the URL locale is
   * authoritative: it overrides any stored preference so server and client
   * render the same language and crawlers see consistent content.
   */
  urlLocale?: Locale | null
}) {
  // Priority: URL locale (locked) > localStorage > cookie (server-set from IP) > prop default
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (urlLocale) return urlLocale
    return readStoredLocale() ?? readCookieLocale() ?? defaultLocale
  })

  const setLocale = (next: Locale) => {
    setLocaleState(next)
    writeCookie(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch {}
    // Update html lang attribute
    document.documentElement.lang = next
  }

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // On a locale-locked URL, persist the choice so the rest of the app (and
  // future root visits) follow the language the visitor explicitly landed on.
  useEffect(() => {
    if (!urlLocale) return
    setLocaleState(urlLocale)
    writeCookie(urlLocale)
    try { localStorage.setItem(STORAGE_KEY, urlLocale) } catch {}
  }, [urlLocale])

  return (
    <I18nContext.Provider value={{ locale, t: DICTS[locale], setLocale }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useT() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("useT must be used within I18nProvider")
  return ctx
}

/** 농업(스마트팜) 전용 사전(설계서 mode-split.md 6장). 농업 뷰(components/agri/**)와
 *  농업 모드 셸, 온보딩의 농업 유형 분기가 읽는다. 공용 UI 문구(저장·취소·날짜)는
 *  그대로 `useT().t.common` 을 쓴다. 예전의 한국어 오버라이드(agri-ko 병합)는
 *  3단계에서 걷어냈다 — 농업 화면은 더는 새우 사전 위에 덮어쓰지 않는다. */
export function useAgriT(): AgriDict {
  const { locale } = useT()
  return useMemo(() => agriDict(locale), [locale])
}
