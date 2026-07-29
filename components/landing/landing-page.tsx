"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n"
import { OPS_CSS } from "./ops-theme"
import {
  Droplets, BrainCircuit, BookOpen, Package, FlaskConical, BarChart3,
  CheckCircle2, ChevronDown, Menu, X, Globe, AlertTriangle, Activity, TrendingUp, Bell, Building2,
} from "lucide-react"

// Marketing locale → public URL. Korean lives at the root, others under a prefix.
const LOCALE_FLAGS: Record<Locale, string> = { ko: "🇰🇷", en: "🇺🇸", vi: "🇻🇳", id: "🇮🇩" }
const localeHref = (l: Locale) => (l === "ko" ? "/" : `/${l}`)

const FEATURE_ICONS = [
  <Droplets key="0" className="w-[19px] h-[19px]" />,
  <BrainCircuit key="1" className="w-[19px] h-[19px]" />,
  <FlaskConical key="2" className="w-[19px] h-[19px]" />,
  <BookOpen key="3" className="w-[19px] h-[19px]" />,
  <Package key="4" className="w-[19px] h-[19px]" />,
  <BarChart3 key="5" className="w-[19px] h-[19px]" />,
]
const STEP_ICONS = [
  <Building2 key="0" className="w-4 h-4" />,
  <Droplets key="1" className="w-4 h-4" />,
  <Bell key="2" className="w-4 h-4" />,
  <TrendingUp key="3" className="w-4 h-4" />,
]

function LocaleChips({ current }: { current: Locale }) {
  return (
    <div className="s365-chips" aria-label="Language">
      <Globe className="w-3.5 h-3.5" style={{ opacity: 0.6, marginRight: 2 }} />
      {LOCALES.map(l => (
        <a key={l} href={localeHref(l)} hrefLang={l} title={LOCALE_NAMES[l]} aria-current={l === current ? "true" : undefined}>
          {l.toUpperCase()}
        </a>
      ))}
    </div>
  )
}

const DropMark = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.5c4 4.5 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2-6.5 6-11Z" />
  </svg>
)

// ─── Live console (hero visual) ───────────────────────────────────────────────
function LiveConsole() {
  const cells = [
    { k: "수온", v: "28.3", u: "°C", s: "ok" },
    { k: "pH", v: "8.1", u: "", s: "ok" },
    { k: "DO", v: "7.2", u: "㎎/L", s: "ok" },
    { k: "암모니아", v: "0.34", u: "㎎/L", s: "warn" },
    { k: "염도", v: "21.0", u: "ppt", s: "ok" },
    { k: "탁도", v: "5.2", u: "NTU", s: "ok" },
  ]
  return (
    <div className="s365-console" aria-label="실시간 수질 현황 예시">
      <div className="s365-con-head">
        <Activity className="w-[15px] h-[15px]" style={{ color: "var(--s-blue)" }} />
        <span className="s365-con-t mono">A-1조 · 실시간 수질</span>
        <span className="s365-live mono"><span className="s365-dot" /> LIVE</span>
      </div>
      <div className="s365-grid6">
        {cells.map(c => (
          <div key={c.k} className={`s365-cell ${c.s}`}>
            <div className="s365-k mono">{c.k}</div>
            <div className="s365-v mono">{c.v}{c.u && <small>{c.u}</small>}</div>
          </div>
        ))}
      </div>
      <div className="s365-con-alert">
        <AlertTriangle className="w-[17px] h-[17px]" style={{ color: "var(--s-crit)", flex: "0 0 auto" }} />
        <span className="s365-msg"><b className="mono">B-2조</b> DO 3.8㎎/L — 즉시 산소 공급 필요</span>
        <span className="s365-time mono">방금</span>
      </div>
      <div className="s365-spark">
        <div className="s365-cap mono">DO 추이 · 최근 24시간</div>
        <svg viewBox="0 0 320 56" width="100%" height="56" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="42" x2="320" y2="42" stroke="var(--s-hair)" strokeWidth="1" />
          <polyline fill="none" stroke="var(--s-blue2)" strokeWidth="2" strokeLinejoin="round"
            points="0,30 27,24 53,28 80,18 107,22 133,14 160,20 187,12 213,26 240,34 267,30 293,22 320,16" />
          <polygon fill="var(--s-blue2)" opacity="0.10"
            points="0,30 27,24 53,28 80,18 107,22 133,14 160,20 187,12 213,26 240,34 267,30 293,22 320,16 320,56 0,56" />
          <circle cx="320" cy="16" r="3.5" fill="var(--s-blue2)" />
        </svg>
      </div>
    </div>
  )
}

// ─── NavBar ────────────────────────────────────────────────────────────────────
function NavBar({ onDemoClick }: { onDemoClick: () => void }) {
  const [open, setOpen] = useState(false)
  const { t, locale } = useT()
  const l = t.landing
  // 페이지 내 앵커(#)와 실제 페이지(/)를 함께 노출한다. 실제 페이지 링크가
  // 랜딩에만 없으면 방문자가 카드뉴스·게시판의 존재를 알 방법이 없다.
  const links = [
    { href: "#features", label: l.navFeatures },
    { href: "#how-it-works", label: l.navHowItWorks },
    { href: "#pricing", label: l.navPricing },
    { href: "#faq", label: l.navFaq },
  ]
  const pages = [
    { href: "/cardnews", label: t.cardNews.title },
    { href: "/board", label: t.board.title },
  ]
  return (
    <header className="s365-header">
      <div className="s365-wrap s365-nav">
        <Link href="/" className="s365-brand">
          <span className="s365-mark"><DropMark /></span> Shrimp365
        </Link>
        <nav className="s365-links">
          {links.map(n => <a key={n.href} href={n.href}>{n.label}</a>)}
          {pages.map(n => <Link key={n.href} href={n.href}>{n.label}</Link>)}
        </nav>
        <div className="s365-navright">
          <LocaleChips current={locale} />
          <Link href="/login" className="s365-btn ghost s365-hide-sm">{t.auth.loginButton}</Link>
          <Link href="/signup" className="s365-btn primary">{l.navStart}</Link>
          <button className="s365-burger" aria-label="menu" onClick={() => setOpen(v => !v)}>
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="s365-mobile">
          {links.map(n => <a key={n.href} href={n.href} onClick={() => setOpen(false)}>{n.label}</a>)}
          {pages.map(n => <Link key={n.href} href={n.href} onClick={() => setOpen(false)}>{n.label}</Link>)}
          <Link href="/guide" onClick={() => setOpen(false)}>{t.nav.guide}</Link>
          <button onClick={() => { setOpen(false); onDemoClick() }} className="s365-mobile-demo">{l.navDemo}</button>
          <div className="s365-mobile-row">
            <Link href="/login" className="s365-btn ghost" style={{ flex: 1, justifyContent: "center" }}>{t.auth.loginButton}</Link>
            <Link href="/signup" className="s365-btn primary" style={{ flex: 1, justifyContent: "center" }}>{l.navStart}</Link>
          </div>
        </div>
      )}
    </header>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { t } = useT()
  const l = t.landing
  const [faqOpen, setFaqOpen] = useState<number | null>(null)

  useEffect(() => { if (user) router.replace("/home") }, [user, router])
  const handleDemo = () => { window.location.href = "/demo" }

  return (
    <div className="s365">
      <style>{OPS_CSS}</style>
      <NavBar onDemoClick={handleDemo} />

      {/* Hero */}
      <main>
        <div className="s365-wrap s365-hero">
          <div>
            <span className="s365-eyebrow mono">{l.heroBadge}</span>
            <h1 className="s365-h1">{l.heroH1}<br /><b>{l.heroH1Highlight}</b></h1>
            <p className="s365-lede">{l.heroSubtitle}</p>
            <div className="s365-cta-row">
              <Link href="/signup" className="s365-btn primary lg">{l.heroCta} →</Link>
              <button onClick={handleDemo} className="s365-btn ghost lg">{l.heroDemo}</button>
            </div>
            <div className="s365-trust mono">
              {[l.heroBenefit1, l.heroBenefit2, l.heroBenefit3].map(b => (
                <span key={b}><span className="s365-dot ok" /> {b}</span>
              ))}
            </div>
          </div>
          <LiveConsole />
        </div>

        {/* Stats strip */}
        <div className="s365-strip">
          <div className="s365-wrap s365-stats">
            {l.stats.map(s => (
              <div key={s.label} className="s365-stat">
                <div className="s365-n mono">{s.value}</div>
                <div className="s365-l">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Features */}
        <section className="s365-blk" id="features">
          <div className="s365-wrap">
            <div className="s365-sec-head">
              <span className="s365-eyebrow mono">{l.featBadge}</span>
              <h2 className="s365-h2">{l.featH2}</h2>
              <p>{l.featSubtitle}</p>
            </div>
            <div className="s365-feat">
              {l.features.map((f, i) => (
                <div key={i} className="s365-card">
                  <div className="s365-cic">{FEATURE_ICONS[i] ?? FEATURE_ICONS[0]}</div>
                  <h3>{f.title}</h3>
                  <p>{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="s365-blk s365-panelbg" id="how-it-works">
          <div className="s365-wrap">
            <div className="s365-sec-head">
              <span className="s365-eyebrow mono">{l.howBadge}</span>
              <h2 className="s365-h2">{l.howH2}</h2>
              <p>{l.howSubtitle}</p>
            </div>
            <div className="s365-steps">
              {l.steps.map((s, i) => (
                <div key={i} className="s365-step">
                  <div className="s365-stepnum mono">
                    {String(i + 1).padStart(2, "0")} <span className="s365-stepic">{STEP_ICONS[i]}</span>
                  </div>
                  <h3>{s.title}</h3>
                  <p>{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Testimonials */}
        <section className="s365-blk">
          <div className="s365-wrap">
            <div className="s365-sec-head">
              <h2 className="s365-h2">{l.testimonialH2}</h2>
              <p>{l.testimonialSubtitle}</p>
            </div>
            <div className="s365-tgrid">
              {l.testimonials.map((tm, i) => (
                <div key={i} className="s365-tcard">
                  <p className="s365-quote">&ldquo;{tm.text}&rdquo;</p>
                  <div className="s365-trow">
                    <div>
                      <div className="s365-tname">{tm.name}</div>
                      <div className="s365-tloc mono">{tm.location}</div>
                    </div>
                    <span className="s365-tbadge mono">{tm.plan} {l.testimonialPlanSuffix}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Free */}
        <section className="s365-blk" id="pricing">
          <div className="s365-wrap">
            <div className="s365-free">
              <span className="s365-eyebrow mono">{l.freeBadge}</span>
              <h2 className="s365-h2" style={{ marginTop: 8 }}>{l.freeH2}</h2>
              <p className="s365-freesub">{l.freeSubtitle}</p>
              <div className="s365-freelist">
                {l.freeItems.map(f => (
                  <div key={f} className="s365-fitem">
                    <CheckCircle2 className="w-[17px] h-[17px]" style={{ color: "var(--s-good)", flex: "0 0 auto" }} /> {f}
                  </div>
                ))}
              </div>
              <Link href="/signup" className="s365-btn amber lg">{l.freeCta} →</Link>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="s365-blk s365-panelbg" id="faq">
          <div className="s365-wrap s365-faqwrap">
            <div className="s365-sec-head" style={{ textAlign: "center", margin: "0 auto 30px" }}>
              <h2 className="s365-h2">{l.faqH2}</h2>
              <p>{l.faqSubtitle}</p>
            </div>
            <div className="s365-faqs">
              {l.faqs.map((faq, i) => (
                <div key={i} className="s365-faq">
                  <button onClick={() => setFaqOpen(faqOpen === i ? null : i)} aria-expanded={faqOpen === i}>
                    <span>{faq.q}</span>
                    <ChevronDown className="w-4 h-4" style={{ transform: faqOpen === i ? "rotate(180deg)" : "none", transition: "transform .16s ease", flex: "0 0 auto" }} />
                  </button>
                  {faqOpen === i && <div className="s365-faqa">{faq.a}</div>}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="s365-blk">
          <div className="s365-wrap">
            <div className="s365-finalcta">
              <h2 className="s365-h2" style={{ color: "#fff" }}>{l.ctaH2}</h2>
              <p className="s365-ctasub">{l.ctaSubtitle}</p>
              <div className="s365-cta-row" style={{ justifyContent: "center" }}>
                <Link href="/signup" className="s365-btn oncolor lg">{l.ctaStart} →</Link>
                <button onClick={handleDemo} className="s365-btn oncolor-ghost lg">{l.ctaDemo}</button>
              </div>
              <p className="s365-ctahint mono">{l.ctaMobileHint} · {l.ctaSecureHint}</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="s365-footer">
        <div className="s365-wrap s365-foot">
          <div className="s365-brand" style={{ fontSize: 15 }}>
            <span className="s365-mark"><DropMark size={13} /></span> Shrimp365
          </div>
          <div className="s365-footlinks">
            <Link href="/pricing">{l.navPricing}</Link>
            {/* 공개 콘텐츠 허브 — 랜딩에서 크롤 경로를 열어 준다 */}
            <Link href="/cardnews">{t.cardNews.title}</Link>
            <Link href="/board">{t.board.title}</Link>
            <Link href="/guide">{t.nav.guide}</Link>
            <Link href="/terms">{t.settings.legalTerms}</Link>
            <Link href="/privacy">{t.settings.legalPrivacy}</Link>
            <Link href="/login">{t.auth.loginButton}</Link>
          </div>
          <div className="mono s365-copy">© {new Date().getFullYear()} Shrimp365 · {l.footerDesc}</div>
        </div>
      </footer>
    </div>
  )
}

