"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Globe, Menu, X } from "lucide-react"
import { useT } from "@/lib/i18n-context"
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n"
import { hasLocalizedUrl, localizedHref, localePrefix, stripLocalePrefix } from "@/lib/marketing-locale"

const LOCALE_FLAGS: Record<Locale, string> = { ko: "🇰🇷", en: "🇺🇸", vi: "🇻🇳", id: "🇮🇩" }

const DropMark = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.5c4 4.5 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2-6.5 6-11Z" />
  </svg>
)

function LangSelect({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useT()
  const pathname = usePathname()
  const router = useRouter()

  // 카드뉴스처럼 언어별 주소가 있는 경로에서는 주소까지 옮긴다.
  // 그렇지 않으면 /en/cardnews 에서 언어를 바꿔도 주소가 그대로 남아
  // 검색엔진이 보는 주소와 실제 언어가 어긋난다.
  function change(next: Locale) {
    setLocale(next)
    if (hasLocalizedUrl(pathname)) router.push(localizedHref(pathname, next))
  }

  return (
    <label className={`relative inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground cursor-pointer ${className}`}>
      <Globe className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t.lang.select}</span>
      <select
        value={locale}
        onChange={(e) => change(e.target.value as Locale)}
        aria-label={t.lang.select}
        className="bg-transparent outline-none cursor-pointer appearance-none pr-1 text-inherit"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} className="bg-card text-foreground">
            {LOCALE_FLAGS[l]} {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  )
}

/** 비로그인 방문자용 공개 푸터 — 헤더와 같은 링크를 한 번 더 노출해
 *  스크롤을 끝까지 내린 방문자에게도 이동 경로를 준다. */
export function PublicFooter({ maxWidth = "max-w-5xl" }: { maxWidth?: string }) {
  const { t, locale } = useT()
  const prefix = localePrefix(locale)
  const links = [
    { href: prefix || "/", label: t.nav.home },
    { href: `${prefix}/cardnews`, label: t.cardNews.title },
    { href: `${prefix}/board`, label: t.board.title },
    { href: `${prefix}/guide`, label: t.nav.guide },
    { href: `${prefix}/pricing`, label: t.landing.navPricing },
    { href: `${prefix}/terms`, label: t.settings.legalTerms },
    { href: `${prefix}/privacy`, label: t.settings.legalPrivacy },
  ]
  return (
    <footer className="border-t border-border mt-12">
      <div className={`${maxWidth} mx-auto px-4 py-6 text-sm text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2`}>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="hover:text-foreground transition-colors">
            {l.label}
          </Link>
        ))}
        <span className="ml-auto">© {new Date().getFullYear()} CULIVER INC.</span>
      </div>
    </footer>
  )
}

/**
 * 비로그인 방문자용 공개 헤더 — 카드뉴스·게시판이 함께 쓴다.
 * 대시보드 셸(사이드바)이 없는 화면이라 여기에 메뉴와 언어 전환이 없으면
 * 방문자가 다른 페이지로 갈 방법도, 언어를 바꿀 방법도 없다.
 */
export function PublicHeader({ maxWidth = "max-w-5xl" }: { maxWidth?: string }) {
  const { t, locale } = useT()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // 메뉴가 열려 있는 동안 뒤 배경이 스크롤되지 않게 한다.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [open])

  // 언어별 주소가 있는 경로(홈·카드뉴스)는 접두사를 유지해 같은 언어 안에서 이동한다.
  const prefix = localePrefix(locale)
  const links = [
    { href: prefix || "/", label: t.nav.home },
    { href: `${prefix}/cardnews`, label: t.cardNews.title },
    { href: `${prefix}/board`, label: t.board.title },
    { href: `${prefix}/guide`, label: t.nav.guide },
    { href: `${prefix}/pricing`, label: t.landing.navPricing },
  ]

  const isActive = (href: string) => {
    const a = stripLocalePrefix(href).path
    const b = stripLocalePrefix(pathname).path
    return a === "/" ? b === "/" : b === a || b.startsWith(a + "/")
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/85 backdrop-blur-md">
      <div className={`${maxWidth} mx-auto px-4 h-14 flex items-center gap-3`}>
        <Link href={prefix || "/"} className="flex items-center gap-2 font-bold tracking-tight shrink-0">
          <span className="w-7 h-7 border-[1.5px] border-[#1E40AF] text-[#1E40AF] rounded-lg flex items-center justify-center">
            <DropMark />
          </span>
          Shrimp365
        </Link>

        {/* 데스크톱 메뉴 */}
        <nav className="hidden md:flex items-center gap-1 ml-2" aria-label={t.common.menu}>
          {links.slice(1).map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                isActive(l.href) ? "text-[#1E40AF] font-semibold bg-[#1E40AF]/5" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <LangSelect className="hidden sm:inline-flex" />
          <Link
            href="/login"
            className="hidden sm:inline-flex items-center text-sm text-foreground px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
          >
            {t.auth.loginButton}
          </Link>
          <Link
            href="/signup"
            className="hidden sm:inline-flex items-center bg-[#1E40AF] hover:bg-[#3B82F6] text-white text-sm px-3 py-1.5 rounded-lg font-semibold transition-colors"
          >
            {t.common.signup}
          </Link>

          {/* 모바일 메뉴 버튼 */}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t.common.menu}
            aria-expanded={open}
            className="md:hidden inline-flex items-center justify-center w-11 h-11 -mr-2 rounded-lg text-foreground hover:bg-muted transition-colors"
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 모바일 메뉴 패널 */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40">
          <button
            type="button"
            aria-label={t.common.close}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute right-0 top-0 h-full w-[82%] max-w-xs bg-card border-l border-border p-4 flex flex-col gap-1 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold">{t.common.menu}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t.common.close}
                className="inline-flex items-center justify-center w-11 h-11 rounded-lg hover:bg-muted transition-colors"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                aria-current={isActive(l.href) ? "page" : undefined}
                className={`px-3 min-h-[44px] flex items-center rounded-lg text-sm transition-colors ${
                  isActive(l.href) ? "text-[#1E40AF] font-semibold bg-[#1E40AF]/5" : "text-foreground hover:bg-muted"
                }`}
              >
                {l.label}
              </Link>
            ))}

            <div className="border-t border-border mt-3 pt-3">
              <LangSelect className="px-3 min-h-[44px]" />
            </div>

            <div className="border-t border-border mt-3 pt-3 flex flex-col gap-2">
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="px-3 min-h-[44px] flex items-center justify-center rounded-lg border border-border text-sm hover:bg-muted transition-colors"
              >
                {t.auth.loginButton}
              </Link>
              <Link
                href="/signup"
                onClick={() => setOpen(false)}
                className="px-3 min-h-[44px] flex items-center justify-center rounded-lg bg-[#1E40AF] hover:bg-[#3B82F6] text-white text-sm font-semibold transition-colors"
              >
                {t.common.signup}
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
