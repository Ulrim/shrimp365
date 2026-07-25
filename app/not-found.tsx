"use client"

import Link from "next/link"
import { Home, ArrowLeft } from "lucide-react"
import { useT } from "@/lib/i18n-context"
import { BrandMark } from "@/components/ui/brand-mark"

export default function NotFound() {
  const { t } = useT()

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A1220] p-6">
      <div className="text-center max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <BrandMark size={40} icon={20} className="border-white text-white" />
          <span className="text-white text-xl font-bold">Shrimp365</span>
        </div>

        <div className="text-8xl font-bold font-mono text-[#60A5FA] mb-4">
          404
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">{t.error.notFound}</h1>
        <p className="text-slate-400 text-sm mb-8">
          {t.error.notFoundMsg}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/dashboard"
            className="flex items-center justify-center gap-2 bg-ocean-600 hover:bg-ocean-700 text-white font-semibold px-6 py-2.5 rounded-xl transition-all"
          >
            <Home className="w-4 h-4" />
            {t.error.goHome}
          </Link>
          <button
            onClick={() => window.history.back()}
            className="flex items-center justify-center gap-2 border border-white/10 text-slate-300 hover:text-white hover:bg-white/5 px-6 py-2.5 rounded-xl transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            {t.common.back}
          </button>
        </div>
      </div>
    </div>
  )
}
