"use client"

import { useEffect } from "react"
import { AlertCircle, RefreshCw } from "lucide-react"
import { useT } from "@/lib/i18n-context"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { t } = useT()

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html>
      <body className="bg-slate-950 flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4 text-center p-6">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center">
            <AlertCircle className="w-7 h-7 text-red-400" />
          </div>
          <div>
            <p className="text-white font-semibold text-lg">{t.error.serverError}</p>
            <p className="text-slate-400 text-sm mt-1">{t.error.serverErrorMsg}</p>
          </div>
          <button
            onClick={reset}
            className="flex items-center gap-2 px-4 py-2 bg-ocean-500 hover:bg-ocean-600 text-white rounded-xl text-sm font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            {t.common.reset}
          </button>
        </div>
      </body>
    </html>
  )
}
