"use client"

import Link from "next/link"
import { BrainCircuit, Sparkles, ArrowLeft } from "lucide-react"
import { useT } from "@/lib/i18n-context"

export default function AIAdvisorPage() {
  const { t } = useT()

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center animate-fade-in">
      <div className="relative mb-6">
        <div className="w-20 h-20 bg-gradient-to-br from-ocean-500 to-teal-500 rounded-3xl flex items-center justify-center shadow-lg">
          <BrainCircuit className="w-10 h-10 text-white" />
        </div>
        <span className="absolute -top-2 -right-2 flex items-center gap-1 bg-amber-100 text-amber-700 border border-amber-200 text-[11px] font-bold px-2 py-0.5 rounded-full">
          <Sparkles className="w-3 h-3" />
          {t.common.comingSoon}
        </span>
      </div>

      <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-2">
        {t.nav.aiAdvisor}
        <span className="ml-2 text-base font-medium text-amber-600">({t.common.comingSoon})</span>
      </h1>
      <p className="text-sm text-muted-foreground max-w-md leading-relaxed mb-8">
        {t.common.comingSoonMsg}
      </p>

      <Link
        href="/home"
        className="inline-flex items-center gap-2 min-h-[44px] px-6 py-2.5 rounded-xl bg-ocean-500 hover:bg-ocean-600 text-white text-sm font-medium transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {t.nav.home}
      </Link>
    </div>
  )
}
