"use client"

import Link from "next/link"
import { useT } from "@/lib/i18n-context"
import { Droplets, BookOpen, ArrowLeft } from "lucide-react"

export default function RecordPage() {
  const { t } = useT()

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] py-10 px-4">
      <div className="w-full max-w-lg space-y-8">
        <div className="flex items-center gap-3">
          <Link href="/home" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold text-foreground">{t.record.chooseTitle}</h1>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            href="/record/water-quality"
            className="group flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-ocean-200 bg-ocean-50 hover:bg-ocean-100 hover:border-ocean-400 transition-all duration-200 py-12 px-6 text-center shadow-sm hover:shadow-md"
          >
            <div className="w-14 h-14 rounded-2xl bg-ocean-500 flex items-center justify-center text-white group-hover:scale-110 transition-transform">
              <Droplets className="w-7 h-7" />
            </div>
            <div>
              <p className="text-xl font-bold text-ocean-700">{t.record.waterQuality}</p>
              <p className="text-sm text-ocean-500 mt-1">pH, DO, 온도 등</p>
            </div>
          </Link>

          <Link
            href="/record/journal"
            className="group flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-400 transition-all duration-200 py-12 px-6 text-center shadow-sm hover:shadow-md"
          >
            <div className="w-14 h-14 rounded-2xl bg-emerald-500 flex items-center justify-center text-white group-hover:scale-110 transition-transform">
              <BookOpen className="w-7 h-7" />
            </div>
            <div>
              <p className="text-xl font-bold text-emerald-700">{t.record.journal}</p>
              <p className="text-sm text-emerald-500 mt-1">급이, 폐사, 환수 등</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
