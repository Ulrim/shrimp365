"use client"

/**
 * 확인 대화상자.
 * 원본: ConfirmLockDialog / ConfirmGenerateDialog / ControlActionConfirmDialog
 *       (세 곳이 같은 구조라 하나로 합쳤다).
 *
 * 되돌릴 수 없는 동작(기준선 잠금, 리포트 생성, 제어 승인·적용) 앞에만 세운다.
 * 진행 중에는 Esc 와 바깥 클릭으로 닫히지 않는다 — 요청이 날아간 뒤 화면만 닫히면
 * 사용자는 무엇이 일어났는지 알 수 없다.
 */

import { useEffect, useId, useRef, type ReactNode } from "react"
import { SECONDARY_BUTTON } from "@/components/mrv/ui"

export function ConfirmDialog({
  open,
  title,
  description,
  detail,
  confirmLabel,
  pendingLabel,
  tone = "primary",
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: ReactNode
  detail?: ReactNode
  confirmLabel: string
  pendingLabel?: string
  tone?: "primary" | "danger"
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    if (open) confirmRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, pending, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => {
        if (!pending) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-mrv-border bg-mrv-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-bold text-mrv-fg">
          {title}
        </h2>
        <div id={descId} className="text-sm text-mrv-muted">
          {description}
        </div>
        {detail && (
          <div className="rounded-md bg-mrv-bg px-3 py-2 text-sm text-mrv-fg">{detail}</div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className={SECONDARY_BUTTON}
          >
            취소
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${
              tone === "danger" ? "bg-mrv-red" : "bg-mrv-primary"
            }`}
          >
            {pending ? (pendingLabel ?? "처리 중…") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
