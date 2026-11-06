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
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descId = useId()

  /**
   * 열릴 때 초점을 어디에 두는가.
   *
   * `tone="danger"` 에서는 **취소**에 둔다. 여기 오는 동작은 되돌릴 수 없고(장비 키 폐기가
   * 처음 그 자리다 — 끊은 키를 되살리는 창구는 없다), 대화상자가 뜨자마자 Enter·Space 가
   * 눌리면 확인이 그대로 실행된다. 키보드로 버튼을 눌러 이 대화상자를 연 사람은 그 키를
   * 아직 떼지 않았을 수 있고, 화면 낭독으로 읽는 사람은 문구를 다 듣기 전에 초점이 놓인
   * 버튼을 누른다. 초점이 취소에 있으면 그 오입력은 **아무 일도 일어나지 않는 쪽**으로
   * 떨어진다.
   *
   * 되돌릴 수 있는 동작(`tone="primary"` — 리포트 생성 등)은 확인에 둔다. 매번 Tab 을
   * 요구하면 자주 쓰는 흐름이 느려지고, 틀렸을 때 다시 하면 되는 동작이다.
   */
  useEffect(() => {
    if (!open) return
    if (tone === "danger") cancelRef.current?.focus()
    else confirmRef.current?.focus()
  }, [open, tone])

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
            ref={cancelRef}
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
