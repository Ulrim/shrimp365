"use client"

import { BrandMark } from "@/components/ui/brand-mark"
import type { GuideContent } from "@/lib/content/guide"
import Link from "next/link"
import { useState } from "react"
import { ArrowRight, ChevronDown, ChevronUp, Download } from "lucide-react"

const ACCENT_CLASSES: Record<string, { badge: string; icon: string; tip: string; pill: string }> = {
  ocean:   { badge: "bg-ocean-50 border-ocean-200 text-ocean-700", icon: "bg-ocean-100 text-ocean-600", tip: "bg-ocean-50 border-ocean-200 text-ocean-700", pill: "bg-ocean-50 hover:bg-ocean-100 border-ocean-200 text-ocean-700" },
  teal:    { badge: "bg-teal-50 border-teal-200 text-teal-700", icon: "bg-teal-100 text-teal-600", tip: "bg-teal-50 border-teal-200 text-teal-700", pill: "bg-teal-50 hover:bg-teal-100 border-teal-200 text-teal-700" },
  blue:    { badge: "bg-blue-50 border-blue-200 text-blue-700", icon: "bg-blue-100 text-blue-600", tip: "bg-blue-50 border-blue-200 text-blue-700", pill: "bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-700" },
  emerald: { badge: "bg-emerald-50 border-emerald-200 text-emerald-700", icon: "bg-emerald-100 text-emerald-600", tip: "bg-emerald-50 border-emerald-200 text-emerald-700", pill: "bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-700" },
  purple:  { badge: "bg-purple-50 border-purple-200 text-purple-700", icon: "bg-purple-100 text-purple-600", tip: "bg-purple-50 border-purple-200 text-purple-700", pill: "bg-purple-50 hover:bg-purple-100 border-purple-200 text-purple-700" },
  amber:   { badge: "bg-amber-50 border-amber-200 text-amber-700", icon: "bg-amber-100 text-amber-600", tip: "bg-amber-50 border-amber-200 text-amber-700", pill: "bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-700" },
  rose:    { badge: "bg-rose-50 border-rose-200 text-rose-700", icon: "bg-rose-100 text-rose-600", tip: "bg-rose-50 border-rose-200 text-rose-700", pill: "bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700" },
}

export function GuideBody({ g }: { g: GuideContent }) {
  const STEPS = g.steps
  const FAQS = g.faqs
  const [activeStep, setActiveStep] = useState<string>("start")
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-4 py-10 sm:py-14">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-ocean-50 border border-ocean-200 text-ocean-600 text-sm px-4 py-1.5 rounded-full mb-5">
            {g.badge}
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold mb-4 text-foreground leading-tight">
            {g.h1}<br />
            <span className="text-ocean-600">{g.h1Highlight}</span>
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg max-w-2xl mx-auto">
            {g.lede}
          </p>
        </div>

        {/* Quick nav pills */}
        <div className="flex flex-wrap gap-2 justify-center mb-10">
          {STEPS.map((s) => {
            const ac = ACCENT_CLASSES[s.accent]
            return (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={() => setActiveStep(s.id)}
                className={`flex items-center gap-1.5 text-xs border rounded-full px-3 py-1.5 transition-all min-h-[44px] ${ac.pill}`}
                aria-label={`${g.goToStep} ${s.step}: ${s.title}`}
              >
                <span aria-hidden="true">{s.icon}</span>
                <span className="hidden sm:inline">{s.title}</span>
                <span className="sm:hidden font-semibold">{s.step}</span>
              </a>
            )
          })}
        </div>

        {/* Steps */}
        <div className="space-y-4 mb-16">
          {STEPS.map((s, idx) => {
            const ac = ACCENT_CLASSES[s.accent]
            const isOpen = activeStep === s.id
            return (
              <div
                key={s.id}
                id={s.id}
                className="rounded-2xl border border-border bg-card overflow-hidden scroll-mt-20 shadow-sm"
              >
                {/* Header */}
                <button
                  className="w-full flex items-center gap-4 p-4 sm:p-5 text-left hover:bg-muted/40 transition-colors min-h-[44px]"
                  onClick={() => setActiveStep(isOpen ? "" : s.id)}
                  aria-expanded={isOpen}
                  aria-controls={`step-body-${s.id}`}
                >
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 ${ac.icon}`} aria-hidden="true">
                    {s.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ac.badge}`}>STEP {s.step}</span>
                    </div>
                    <h2 className="text-base font-bold text-foreground truncate">{s.title}</h2>
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{s.desc}</p>
                  </div>
                  <div className="shrink-0 text-muted-foreground" aria-hidden="true">
                    {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </div>
                </button>

                {/* Body */}
                {isOpen && (
                  <div id={`step-body-${s.id}`} className="px-4 sm:px-5 pb-5 border-t border-border pt-4">
                    <p className="text-muted-foreground text-sm mb-4">{s.desc}</p>

                    <ol className="space-y-3 mb-5">
                      {s.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${ac.icon}`}>
                            {i + 1}
                          </span>
                          <span className="text-sm text-foreground leading-relaxed">
                            <span className="mr-1.5" aria-hidden="true">{item.icon}</span>
                            {item.text}
                          </span>
                        </li>
                      ))}
                    </ol>

                    <div className={`rounded-xl p-3 flex gap-3 border ${ac.tip}`} role="note">
                      <span className="text-lg shrink-0" aria-hidden="true">💡</span>
                      <p className="text-sm leading-relaxed">{s.tip}</p>
                    </div>

                    {idx < STEPS.length - 1 && (
                      <button
                        onClick={() => setActiveStep(STEPS[idx + 1].id)}
                        className="mt-4 flex items-center gap-1.5 text-sm text-ocean-600 hover:text-ocean-700 font-medium transition-colors min-h-[44px]"
                        aria-label={`${g.nextStep}: ${STEPS[idx + 1].title}`}
                      >
                        {g.nextStep}: {STEPS[idx + 1].title}
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Daily workflow summary */}
        <div className="mb-16 bg-ocean-50 border border-ocean-200 rounded-2xl p-6 sm:p-8">
          <h2 className="text-xl font-bold text-foreground mb-2 text-center">{g.routineTitle}</h2>
          <p className="text-sm text-muted-foreground text-center mb-6">{g.routineSub}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {g.routine.map((item) => (

              <div key={item.step} className="bg-card rounded-xl border border-border p-4 text-center shadow-sm">
                <div className="text-3xl mb-2" aria-hidden="true">{item.icon}</div>
                <div className="text-xs text-ocean-600 font-semibold mb-1">{item.step}</div>
                <div className="font-bold text-foreground text-sm mb-1">{item.title}</div>
                <div className="text-xs text-muted-foreground whitespace-pre-line">{item.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-center text-foreground mb-8">{g.faqTitle}</h2>
          <div className="space-y-3">
            {FAQS.map((faq, i) => (
              <div key={i} className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                <button
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-muted/40 transition-colors min-h-[44px]"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                  aria-controls={`faq-answer-${i}`}
                >
                  <span className="font-medium text-foreground text-sm leading-snug">{faq.q}</span>
                  {openFaq === i
                    ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                    : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />}
                </button>
                {openFaq === i && (
                  <div id={`faq-answer-${i}`} className="px-5 pb-4 text-sm text-muted-foreground border-t border-border pt-3 leading-relaxed" role="region" aria-label={faq.q}>
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center bg-ocean-50 border border-ocean-200 rounded-2xl p-8 sm:p-12">
          <div className="flex justify-center mb-4"><BrandMark size={56} icon={28} /></div>
          <h2 className="text-2xl font-bold mb-3 text-foreground">{g.ctaTitle}</h2>
          <p className="text-muted-foreground mb-6">
            {g.ctaDesc}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold px-8 py-3 rounded-xl transition-all min-h-[44px]"
              aria-label={g.ctaStart}
            >
              {g.ctaStart} <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
            <a
              href="/api/guide"
              download="Shrimp365_사용설명서.pdf"
              className="inline-flex items-center justify-center gap-2 border border-border hover:bg-muted text-foreground px-8 py-3 rounded-xl transition-all text-sm font-medium min-h-[44px]"
              aria-label={g.ctaPdf}
            >
              <Download className="w-4 h-4" aria-hidden="true" /> {g.ctaPdf}
            </a>
          </div>
        </div>

      </div>
    </div>
  )
}
