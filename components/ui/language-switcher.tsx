"use client"

import { Globe } from "lucide-react"
import { useT } from "@/lib/i18n-context"
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n"

const LOCALE_FLAGS: Record<Locale, string> = {
  ko: "🇰🇷",
  en: "🇺🇸",
  vi: "🇻🇳",
}

interface LanguageSwitcherProps {
  collapsed?: boolean
}

export function LanguageSwitcher({ collapsed = false }: LanguageSwitcherProps) {
  const { locale, setLocale, t } = useT()

  return (
    <div className="relative flex items-center gap-2 px-2 py-1.5">
      <Globe className="w-4 h-4 text-slate-400 shrink-0" />
      {!collapsed && (
        <select
          value={locale}
          onChange={e => setLocale(e.target.value as Locale)}
          title={t.lang.select}
          className="flex-1 bg-transparent text-xs text-slate-400 hover:text-white cursor-pointer outline-none appearance-none"
          style={{ WebkitAppearance: "none" }}
        >
          {LOCALES.map(l => (
            <option key={l} value={l} className="bg-slate-800 text-slate-300">
              {LOCALE_FLAGS[l]} {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
      )}
      {collapsed && (
        <select
          value={locale}
          onChange={e => setLocale(e.target.value as Locale)}
          title={t.lang.select}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        >
          {LOCALES.map(l => (
            <option key={l} value={l} className="bg-slate-800 text-slate-300">
              {LOCALE_FLAGS[l]} {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
      )}
      {collapsed && (
        <span className="text-xs pointer-events-none">{LOCALE_FLAGS[locale]}</span>
      )}
    </div>
  )
}
