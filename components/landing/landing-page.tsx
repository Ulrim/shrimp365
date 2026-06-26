"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n"
import {
  Droplets, BrainCircuit, BookOpen, Package, FlaskConical,
  BarChart3, Building2, CheckCircle2, ArrowRight, ChevronDown,
  Smartphone, Shield, Zap, Star, Play, Bell, Fish, Globe,
  ThermometerSun, Wind, AlertTriangle, TrendingUp, Clock, Menu, X
} from "lucide-react"

// Marketing locale → public URL. Korean lives at the root, others under a prefix.
const LOCALE_FLAGS: Record<Locale, string> = { ko: "🇰🇷", en: "🇺🇸", vi: "🇻🇳", id: "🇮🇩" }
const localeHref = (l: Locale) => (l === "ko" ? "/" : `/${l}`)

function LocaleLinks({ current }: { current: Locale }) {
  return (
    <div className="flex items-center gap-1" aria-label="Language">
      <Globe className="w-3.5 h-3.5 text-muted-foreground mr-0.5" />
      {LOCALES.map(l => (
        <a
          key={l}
          href={localeHref(l)}
          hrefLang={l}
          title={LOCALE_NAMES[l]}
          aria-current={l === current ? "true" : undefined}
          className={`text-base leading-none px-1 rounded transition-opacity ${l === current ? "opacity-100" : "opacity-50 hover:opacity-100"}`}
        >
          {LOCALE_FLAGS[l]}
        </a>
      ))}
    </div>
  )
}

const FEATURE_STYLES = [
  { icon: <Droplets className="w-6 h-6" />, color: "from-ocean-500 to-ocean-600", glow: "bg-ocean-50 border-ocean-100" },
  { icon: <BrainCircuit className="w-6 h-6" />, color: "from-purple-500 to-purple-600", glow: "bg-purple-50 border-purple-100" },
  { icon: <FlaskConical className="w-6 h-6" />, color: "from-rose-500 to-rose-600", glow: "bg-rose-50 border-rose-100" },
  { icon: <BookOpen className="w-6 h-6" />, color: "from-teal-500 to-teal-600", glow: "bg-teal-50 border-teal-100" },
  { icon: <Package className="w-6 h-6" />, color: "from-amber-500 to-amber-600", glow: "bg-amber-50 border-amber-100" },
  { icon: <BarChart3 className="w-6 h-6" />, color: "from-emerald-500 to-emerald-600", glow: "bg-emerald-50 border-emerald-100" },
]

const STEP_ICONS = [
  <Building2 key="farm" className="w-8 h-8 text-ocean-600" />,
  <Droplets key="water" className="w-8 h-8 text-teal-600" />,
  <Bell key="bell" className="w-8 h-8 text-amber-600" />,
  <TrendingUp key="trend" className="w-8 h-8 text-emerald-600" />,
]

// ─── Sub-components ───────────────────────────────────────────────────────────

function NavBar({ onDemoClick }: { onDemoClick: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { t, locale } = useT()
  const l = t.landing
  const navLinks = [
    { href: "#features", label: l.navFeatures },
    { href: "#how-it-works", label: l.navHowItWorks },
    { href: "#pricing", label: l.navPricing },
    { href: "#faq", label: l.navFaq },
  ]
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-md border-b border-border">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-gradient-to-br from-ocean-400 to-teal-500 rounded-lg flex items-center justify-center text-base leading-none">
            🦐
          </div>
          <span className="text-foreground font-bold text-lg">Shrimp365</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
          {navLinks.map(n => (
            <a key={n.href} href={n.href} className="hover:text-foreground transition-colors">{n.label}</a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <LocaleLinks current={locale} />
          <button onClick={onDemoClick} className="text-sm text-ocean-600 hover:text-ocean-700 transition-colors flex items-center gap-1">
            <Play className="w-3.5 h-3.5" /> {l.navDemo}
          </button>
          <Link href="/login" className="text-sm text-foreground hover:text-foreground transition-colors px-4 py-1.5 rounded-lg border border-border hover:bg-muted">
            {t.auth.loginButton}
          </Link>
          <Link href="/signup" className="text-sm bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-400 hover:to-teal-400 text-white px-4 py-1.5 rounded-lg font-medium transition-all">
            {l.navStart}
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button className="md:hidden text-muted-foreground p-2 -mr-2 min-h-[44px] min-w-[44px] flex items-center justify-center" onClick={() => setMobileOpen(v => !v)}>
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-background border-t border-border px-4 py-4 space-y-3">
          {navLinks.map(n => (
            <a key={n.href} href={n.href} onClick={() => setMobileOpen(false)} className="block text-foreground hover:text-foreground py-2.5 min-h-[44px] flex items-center">{n.label}</a>
          ))}
          <div className="flex gap-3 pt-2">
            <Link href="/login" className="flex-1 text-center text-sm text-foreground px-4 py-2 rounded-lg border border-border">{t.auth.loginButton}</Link>
            <Link href="/signup" className="flex-1 text-center text-sm bg-gradient-to-r from-ocean-500 to-teal-500 text-white px-4 py-2 rounded-lg font-medium">{l.navStart}</Link>
          </div>
          <div className="pt-3 border-t border-border"><LocaleLinks current={locale} /></div>
        </div>
      )}
    </nav>
  )
}

function WaterQualityCard() {
  return (
    <div className="bg-card backdrop-blur border border-border rounded-2xl p-4 shadow-2xl w-72">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-foreground">A-1조 수질 현황</span>
        <span className="flex items-center gap-1 text-xs text-emerald-600">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />정상
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "수온", value: "28.3", unit: "°C", ok: true, icon: <ThermometerSun className="w-3.5 h-3.5" /> },
          { label: "DO", value: "7.2", unit: "mg/L", ok: true, icon: <Wind className="w-3.5 h-3.5" /> },
          { label: "pH", value: "8.1", unit: "", ok: true, icon: <Droplets className="w-3.5 h-3.5" /> },
          { label: "암모니아", value: "0.08", unit: "mg/L", ok: true, icon: <AlertTriangle className="w-3.5 h-3.5" /> },
          { label: "탁도", value: "5.2", unit: "NTU", ok: true, icon: <Droplets className="w-3.5 h-3.5" /> },
          { label: "염도", value: "21.0", unit: "ppt", ok: true, icon: <Fish className="w-3.5 h-3.5" /> },
        ].map(item => (
          <div key={item.label} className="bg-emerald-50 border border-emerald-100 rounded-lg p-2">
            <div className="flex items-center gap-1 text-emerald-600 mb-1">{item.icon}<span className="text-[10px]">{item.label}</span></div>
            <p className="text-xs font-bold text-foreground">{item.value}<span className="text-muted-foreground font-normal text-[10px]">{item.unit}</span></p>
          </div>
        ))}
      </div>
      <div className="mt-3 bg-red-50 border border-red-100 rounded-lg p-2.5 flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-medium text-red-600">B-2조 알림</p>
          <p className="text-[10px] text-muted-foreground">DO 3.8 mg/L — 즉시 산소 공급 필요</p>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { t } = useT()
  const l = t.landing
  const [faqOpen, setFaqOpen] = useState<number | null>(null)

  useEffect(() => {
    if (user) router.replace("/home")
  }, [user, router])

  function handleDemo() {
    window.location.href = "/demo"
  }

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <NavBar onDemoClick={handleDemo} />

      {/* ─── Hero ───────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center pt-16 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 -left-32 w-96 h-96 bg-ocean-100 rounded-full md:blur-2xl" />
          <div className="absolute top-1/3 -right-32 w-80 h-80 bg-teal-100 rounded-full md:blur-2xl" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full h-px bg-gradient-to-r from-transparent via-ocean-200 to-transparent" />
        </div>

        <div className="relative max-w-6xl mx-auto px-4 py-20 grid lg:grid-cols-2 gap-16 items-center">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 bg-ocean-50 border border-ocean-100 rounded-full px-4 py-2">
              <Star className="w-3.5 h-3.5 text-ocean-600" />
              <span className="text-sm text-ocean-700 font-medium">{l.heroBadge}</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight">
              {l.heroH1}<br />
              <span className="bg-gradient-to-r from-ocean-500 via-teal-500 to-emerald-500 bg-clip-text text-transparent">
                {l.heroH1Highlight}
              </span>
            </h1>

            <p className="text-lg text-muted-foreground leading-relaxed max-w-lg whitespace-pre-line">
              {l.heroSubtitle}
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/signup"
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-400 hover:to-teal-400 text-white px-7 py-3.5 rounded-xl font-semibold text-base transition-all shadow-lg shadow-ocean-500/25 hover:shadow-ocean-500/40"
              >
                {l.heroCta} <ArrowRight className="w-4 h-4" />
              </Link>
              <button
                onClick={handleDemo}
                className="flex items-center justify-center gap-2 border border-border hover:bg-muted text-muted-foreground hover:text-foreground px-7 py-3.5 rounded-xl font-medium text-base transition-all"
              >
                <Play className="w-4 h-4 text-ocean-600" /> {l.heroDemo}
              </button>
            </div>

            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              {[l.heroBenefit1, l.heroBenefit2, l.heroBenefit3].map(b => (
                <span key={b} className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />{b}
                </span>
              ))}
            </div>
          </div>

          <div className="hidden lg:flex justify-center items-center relative">
            <div className="absolute inset-0 bg-gradient-to-r from-ocean-50 to-teal-50 rounded-3xl blur-2xl" />
            <div className="relative">
              <WaterQualityCard />
              <div className="absolute -top-6 -right-8 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center gap-2 shadow-lg animate-bounce" style={{ animationDuration: "3s" }}>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span className="text-xs text-emerald-700 font-medium">{l.heroAiDone}</span>
              </div>
              <div className="absolute -bottom-5 -left-8 bg-ocean-50 border border-ocean-200 rounded-xl px-3 py-2 flex items-center gap-2 shadow-lg">
                <Bell className="w-4 h-4 text-ocean-600" />
                <span className="text-xs text-ocean-700">{l.heroAlertBadge}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-muted-foreground">
          <span className="text-xs">{l.scrollHint}</span>
          <ChevronDown className="w-4 h-4 animate-bounce" />
        </div>
      </section>

      {/* ─── Stats bar ──────────────────────────────────────────────────────── */}
      <section className="border-y border-border bg-ocean-50">
        <div className="max-w-6xl mx-auto px-4 py-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {l.stats.map(s => (
            <div key={s.label}>
              <p className="text-3xl font-bold bg-gradient-to-r from-ocean-500 to-teal-500 bg-clip-text text-transparent mb-1">{s.value}</p>
              <p className="text-sm text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Features ───────────────────────────────────────────────────────── */}
      <section id="features" className="py-24 bg-background">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-teal-50 border border-teal-100 rounded-full px-4 py-1.5 mb-4">
              <Zap className="w-3.5 h-3.5 text-teal-600" />
              <span className="text-sm text-teal-700">{l.featBadge}</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 whitespace-pre-line">{l.featH2}</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">{l.featSubtitle}</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {l.features.map((f, i) => {
              const style = FEATURE_STYLES[i]
              return (
                <div key={i} className={`group relative border ${style.glow} rounded-2xl p-6 bg-card shadow-sm hover:shadow-md transition-all`}>
                  <div className={`inline-flex w-12 h-12 rounded-xl items-center justify-center mb-4 bg-gradient-to-br ${style.color} shadow-lg`}>
                    <span className="text-white">{style.icon}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">{f.desc}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {f.tags.map(tag => (
                      <span key={tag} className="text-[11px] bg-muted border border-border rounded-full px-2.5 py-0.5 text-muted-foreground">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ─── How it works ───────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-24 bg-muted">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-ocean-50 border border-ocean-100 rounded-full px-4 py-1.5 mb-4">
              <Clock className="w-3.5 h-3.5 text-ocean-600" />
              <span className="text-sm text-ocean-700">{l.howBadge}</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">{l.howH2}</h2>
            <p className="text-muted-foreground">{l.howSubtitle}</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {l.steps.map((step, i) => (
              <div key={i} className="relative">
                {i < l.steps.length - 1 && (
                  <div className="hidden lg:block absolute top-12 left-[calc(100%+0px)] w-full h-px bg-gradient-to-r from-border to-transparent z-10" />
                )}
                <div className="bg-card border border-border rounded-2xl p-6 h-full shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-4xl font-black text-muted leading-none">0{i + 1}</span>
                    <div className="w-12 h-12 bg-ocean-50 rounded-xl flex items-center justify-center">
                      {STEP_ICONS[i]}
                    </div>
                  </div>
                  <h3 className="text-base font-semibold text-foreground mb-2">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">{step.desc}</p>
                  <div className="flex items-start gap-2 bg-muted border border-border rounded-lg p-3">
                    <CheckCircle2 className="w-3.5 h-3.5 text-ocean-600 shrink-0 mt-0.5" />
                    <span className="text-[11px] text-muted-foreground">{step.tip}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Testimonials ───────────────────────────────────────────────────── */}
      <section className="py-24 bg-background">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">{l.testimonialH2}</h2>
            <p className="text-muted-foreground">{l.testimonialSubtitle}</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-5">
            {l.testimonials.map((tm, i) => (
              <div key={i} className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                <div className="flex gap-1 mb-4">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <Star key={j} className="w-4 h-4 text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-foreground text-sm leading-relaxed mb-5">&ldquo;{tm.text}&rdquo;</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-foreground text-sm font-medium">{tm.name}</p>
                    <p className="text-muted-foreground text-xs">{tm.location}</p>
                  </div>
                  <span className="text-xs bg-ocean-50 text-ocean-700 border border-ocean-100 px-2.5 py-1 rounded-full">{tm.plan} {l.testimonialPlanSuffix}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Free & Ad-based section ────────────────────────────────────────── */}
      <section id="pricing" className="py-24 bg-muted">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-full px-4 py-1.5 mb-6">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-sm text-emerald-700">{l.freeBadge}</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">{l.freeH2}</h2>
          <p className="text-muted-foreground mb-10 whitespace-pre-line">{l.freeSubtitle}</p>
          <div className="grid sm:grid-cols-2 gap-4 text-left mb-10">
            {l.freeItems.map(f => (
              <div key={f} className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="text-sm font-medium text-foreground">{f}</span>
              </div>
            ))}
          </div>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold px-8 py-3.5 rounded-xl transition-colors text-lg"
          >
            {l.freeCta} <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* ─── FAQ ────────────────────────────────────────────────────────────── */}
      <section id="faq" className="py-24 bg-background">
        <div className="max-w-3xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">{l.faqH2}</h2>
            <p className="text-muted-foreground">{l.faqSubtitle}</p>
          </div>

          <div className="space-y-3">
            {l.faqs.map((faq, i) => (
              <div key={i} className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <button
                  onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                  className="w-full flex items-center justify-between p-5 text-left hover:bg-muted transition-colors"
                >
                  <span className="text-foreground font-medium pr-4">{faq.q}</span>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${faqOpen === i ? "rotate-180" : ""}`} />
                </button>
                {faqOpen === i && (
                  <div className="px-5 pb-5 text-muted-foreground text-sm leading-relaxed border-t border-border pt-4">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Final CTA ──────────────────────────────────────────────────────── */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-br from-ocean-500 via-ocean-600 to-teal-600" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-white/10 rounded-full md:blur-2xl" />
        </div>
        <div className="relative max-w-3xl mx-auto px-4 text-center">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-6 text-4xl leading-none">
            🦐
          </div>
          <h2 className="text-3xl sm:text-5xl font-bold mb-5 text-white">{l.ctaH2}</h2>
          <p className="text-lg text-white/80 mb-8 whitespace-pre-line">{l.ctaSubtitle}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/signup"
              className="flex items-center justify-center gap-2 bg-white hover:bg-ocean-50 text-ocean-600 px-8 py-4 rounded-xl font-semibold text-lg transition-all shadow-xl"
            >
              {l.ctaStart} <ArrowRight className="w-5 h-5" />
            </Link>
            <button
              onClick={handleDemo}
              className="flex items-center justify-center gap-2 border border-white/30 hover:bg-white/10 text-white px-8 py-4 rounded-xl font-medium text-base transition-all"
            >
              <Play className="w-4 h-4 text-white/80" /> {l.ctaDemo}
            </button>
          </div>
          <p className="text-white/60 text-sm mt-6">
            <Smartphone className="w-3.5 h-3.5 inline mr-1" />{l.ctaMobileHint} &nbsp;·&nbsp;
            <Shield className="w-3.5 h-3.5 inline mr-1" />{l.ctaSecureHint}
          </p>
        </div>
      </section>

      {/* ─── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-muted">
        <div className="max-w-6xl mx-auto px-4 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-gradient-to-br from-ocean-400 to-teal-500 rounded-lg flex items-center justify-center text-sm leading-none">
                🦐
              </div>
              <span className="text-foreground font-bold">Shrimp365</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <Link href="/pricing" className="hover:text-foreground transition-colors">{l.navPricing}</Link>
              <Link href="/terms" className="hover:text-foreground transition-colors">{t.settings.legalTerms}</Link>
              <Link href="/privacy" className="hover:text-foreground transition-colors">{t.settings.legalPrivacy}</Link>
              <Link href="/login" className="hover:text-foreground transition-colors">{t.auth.loginButton}</Link>
            </div>
          </div>
          <div className="border-t border-border mt-8 pt-6 text-center text-xs text-muted-foreground">
            © 2025 Shrimp365. {l.footerDesc}
          </div>
        </div>
      </footer>
    </div>
  )
}
