"use client"

import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from "react"
import { ko, en, vi, id, type Dict, type Locale, LOCALES } from "@/lib/i18n"
import type { DictOverride } from "@/lib/i18n/types"
import { agriKo } from "@/lib/i18n/agri-ko"

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

/** 2단(섹션 → 키) 얕은 병합. Dict 는 2단 구조라 이것으로 충분하다.
 *  온보딩의 페이지 로컬 치환(농업 유형 선택 직후)도 이 헬퍼를 재사용한다. */
export function mergeDict(base: Dict, override: DictOverride): Dict {
  const out: Record<string, unknown> = { ...base }
  for (const [section, part] of Object.entries(override)) {
    if (!part) continue
    out[section] = { ...(out[section] as Record<string, unknown>), ...part }
  }
  return out as unknown as Dict
}

/** 농업 UI 모드에서만 한국어 사전 위에 agri-ko 를 덮어 다시 제공한다.
 *
 *  - enabled 가 아니면(새우·혼합 계정) 자식을 그대로 돌려준다 — merge 자체를
 *    하지 않으므로 새우 모드 동작 무변화.
 *  - 영어·베트남어·인니어는 농업 오버라이드 사전이 아직 없어(설계서 4-2 후속)
 *    기존 라벨 그대로 둔다. */
export function AgriDictOverride({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("AgriDictOverride must be used within I18nProvider")
  const { locale, t, setLocale } = ctx
  const merged = useMemo<I18nContextType>(
    () => ({ locale, setLocale, t: locale === "ko" ? mergeDict(t, agriKo) : t }),
    [locale, t, setLocale],
  )
  if (!enabled || locale !== "ko") return <>{children}</>
  return <I18nContext.Provider value={merged}>{children}</I18nContext.Provider>
}
