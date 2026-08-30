import Link from "next/link"
import {
  Droplets, BrainCircuit, BookOpen, Package,
  FlaskConical, BarChart3, Building2, Wifi, CheckCircle2, ArrowRight,
} from "lucide-react"
import type { PricingContent } from "@/lib/content/pricing"
import { localePrefix } from "@/lib/marketing-locale"

// 아이콘은 언어와 무관하므로 순서만 맞춰 둔다(문구는 lib/content/pricing.ts).
const ICONS = [Droplets, BrainCircuit, BookOpen, FlaskConical, Package, BarChart3, Building2, Wifi]

export function PricingBody({ p, locale }: { p: PricingContent; locale: string }) {
  const prefix = localePrefix(locale)
  return (
    <>
      <section className="max-w-3xl mx-auto px-4 pt-20 pb-12 text-center">
        <div className="inline-flex items-center gap-2 bg-ocean-50 border border-ocean-100 rounded-full px-4 py-1.5 mb-6">
          <CheckCircle2 className="w-4 h-4 text-ocean-600" aria-hidden="true" />
          <span className="text-sm font-medium text-ocean-700">{p.badge}</span>
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold mb-4 leading-tight">
          {p.h1}<br />
          <span className="text-ocean-600">{p.h1Highlight}</span>
        </h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto whitespace-pre-line">{p.lede}</p>
        <Link
          href="/signup"
          className="inline-flex items-center gap-2 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold px-8 py-3.5 rounded-xl transition-colors text-lg"
        >
          {p.cta}
          <ArrowRight className="w-5 h-5" aria-hidden="true" />
        </Link>
        <p className="mt-3 text-sm text-muted-foreground">{p.ctaNote}</p>
      </section>

      <section className="max-w-4xl mx-auto px-4 pb-16">
        <h2 className="text-center text-xl font-semibold text-foreground mb-8">{p.featuresTitle}</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {p.features.map((f, i) => {
            const Icon = ICONS[i] ?? Droplets
            return (
              <div key={f.label} className="flex gap-4 p-5 rounded-2xl border border-border bg-card">
                <div className="w-10 h-10 rounded-xl bg-ocean-50 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-ocean-600" aria-hidden="true" />
                </div>
                <div>
                  <div className="font-semibold text-foreground mb-0.5">{f.label}</div>
                  <div className="text-sm text-muted-foreground">{f.desc}</div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="bg-muted/40 border-y border-border py-12">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <h2 className="text-xl font-semibold mb-3">{p.whyTitle}</h2>
          <p className="text-muted-foreground leading-relaxed whitespace-pre-line">{p.whyBody}</p>
        </div>
      </section>

      <section className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold mb-4">{p.endTitle}</h2>
        <p className="text-muted-foreground mb-8">{p.endLede}</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center gap-2 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold px-8 py-3.5 rounded-xl transition-colors"
          >
            {p.endCta}
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
          <Link
            href={`${prefix}/guide`}
            className="inline-flex items-center justify-center gap-2 border border-border bg-background hover:bg-accent text-foreground font-semibold px-8 py-3.5 rounded-xl transition-colors"
          >
            {p.endGuide}
          </Link>
        </div>
      </section>
    </>
  )
}
