"use client"

import { useEffect } from "react"
import { AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n-context"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { t } = useT()

  useEffect(() => {
    console.error(error.message)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center">
        <AlertCircle className="w-7 h-7 text-red-400" />
      </div>
      <div>
        <p className="text-foreground font-semibold text-lg">{t.error.serverError}</p>
        <p className="text-muted-foreground text-sm mt-1 max-w-sm">
          {t.error.serverErrorMsg}
        </p>
      </div>
      <Button
        onClick={reset}
        className="bg-ocean-500 hover:bg-ocean-600 text-white gap-2"
      >
        <RefreshCw className="w-4 h-4" />
        {t.common.reset}
      </Button>
    </div>
  )
}
