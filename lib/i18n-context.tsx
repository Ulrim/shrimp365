"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import { ko, en, vi, type Dict, type Locale, LOCALES } from "@/lib/i18n"

const COOKIE_NAME = "shrimp365_lang"
const STORAGE_KEY = "shrimp365_lang"

const DICTS: Record<Locale, Dict> = { ko, en, vi }

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
}: {
  children: ReactNode
  defaultLocale: Locale
}) {
  // Priority: localStorage > cookie (server-set from IP) > prop default
  const [locale, setLocaleState] = useState<Locale>(() => {
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
