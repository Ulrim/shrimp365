"use client"

import { AlertTriangle } from "lucide-react"
import { useT } from "@/lib/i18n-context"

export default function BoardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useT()
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center max-w-2xl mx-auto" role="alert">
      <AlertTriangle className="w-10 h-10 text-amber-500" aria-hidden="true" />
      <p className="text-muted-foreground text-sm">{t.board.loadError}</p>
      <button
        onClick={() => reset()}
        className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg border border-border text-sm hover:bg-muted transition-colors"
      >
        {t.homeHub.retry}
      </button>
    </div>
  )
}
