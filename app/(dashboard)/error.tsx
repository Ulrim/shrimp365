"use client"

import { useEffect } from "react"
import { AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center">
        <AlertCircle className="w-7 h-7 text-red-400" />
      </div>
      <div>
        <p className="text-white font-semibold text-lg">페이지 로드 중 오류가 발생했습니다</p>
        <p className="text-slate-400 text-sm mt-1 max-w-sm">
          일시적인 오류입니다. 잠시 후 다시 시도해주세요.
        </p>
      </div>
      <Button
        onClick={reset}
        className="bg-ocean-500 hover:bg-ocean-600 text-white gap-2"
      >
        <RefreshCw className="w-4 h-4" />
        다시 시도
      </Button>
    </div>
  )
}
