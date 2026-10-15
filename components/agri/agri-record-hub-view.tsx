"use client"

// 기록 허브 `/daumlabs/record` — 수아 시안 mode-split-ui.md 5-2.
// 측정 기록 / 영농 일지 2택. 데이터 로딩이 없어 로딩·에러·빈 상태도 없다.
import Link from "next/link"
import { useAgriT } from "@/lib/i18n-context"
import { ClipboardList, BookOpen, ArrowLeft } from "lucide-react"

export function AgriRecordHubView() {
  const { record } = useAgriT()

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] py-10 px-4">
      <div className="w-full max-w-lg space-y-8">
        <div className="flex items-center gap-3">
          <Link
            href="/daumlabs/home"
            aria-label={record.backToHomeAria}
            className="text-muted-foreground hover:text-foreground transition-colors duration-200 p-2 -ml-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          </Link>
          <h1 className="text-2xl font-bold text-foreground">{record.chooseTitle}</h1>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            href="/daumlabs/record/water-quality"
            aria-label={`${record.measureTitle} - ${record.measureSub}`}
            className="group flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-brand/25 bg-brand/5 hover:bg-brand/10 hover:border-brand/50 transition-colors duration-200 py-10 sm:py-12 px-6 text-center shadow-sm hover:shadow-md min-h-[44px]"
          >
            <div className="w-14 h-14 rounded-2xl bg-brand flex items-center justify-center text-white" aria-hidden="true">
              <ClipboardList className="w-7 h-7" />
            </div>
            <div>
              <p className="text-xl font-bold text-brand-fg">{record.measureTitle}</p>
              <p className="text-sm text-brand-fg/80 mt-1">{record.measureSub}</p>
            </div>
          </Link>

          <Link
            href="/daumlabs/record/journal"
            aria-label={`${record.journalTitle} - ${record.journalSub}`}
            className="group flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-400 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/15 transition-colors duration-200 py-10 sm:py-12 px-6 text-center shadow-sm hover:shadow-md min-h-[44px]"
          >
            <div className="w-14 h-14 rounded-2xl bg-emerald-500 flex items-center justify-center text-white" aria-hidden="true">
              <BookOpen className="w-7 h-7" />
            </div>
            <div>
              <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{record.journalTitle}</p>
              <p className="text-sm text-emerald-600 dark:text-emerald-400/80 mt-1">{record.journalSub}</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
