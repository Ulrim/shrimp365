"use client"

// 농업 화면 공통 로딩·로드 에러 블록 — 수아 시안 mode-split-ui.md 4-1·4-2.
//
// 홈·측정 폼·일지 폼·대시보드가 같은 스피너와 같은 에러 블록을 쓴다. 문구는 농업
// 사전(common)이라 4개 언어에서 농업 어휘로 나온다. 다시 시도는 호출한 뷰가 retry
// 카운터를 올려 effect 를 다시 돌린다(홈 뷰 패턴).
import { AlertTriangle } from "lucide-react"
import { useAgriT } from "@/lib/i18n-context"

export function AgriSpinner({ label }: { label?: string }) {
  const { common } = useAgriT()
  return (
    <div className="flex items-center justify-center min-h-[60vh]" role="status" aria-label={label ?? common.loading}>
      <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" aria-hidden="true" />
    </div>
  )
}

export function AgriLoadError({ onRetry, title, message }: { onRetry: () => void; title?: string; message?: string }) {
  const { common } = useAgriT()
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4 text-center" role="alert">
      <AlertTriangle className="w-10 h-10 text-amber-500" aria-hidden="true" />
      <p className="text-foreground font-semibold text-lg">{title ?? common.loadErrorTitle}</p>
      <p className="text-muted-foreground text-sm">{message ?? common.loadErrorMsg}</p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-[44px] px-6 py-2 rounded-xl bg-brand text-white font-medium hover:bg-brand-hover transition-colors duration-200"
      >
        {common.retry}
      </button>
    </div>
  )
}
