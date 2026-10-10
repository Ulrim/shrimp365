import { useEffect, useRef } from "react";

/*
 * MRV 리포트 생성 확인 다이얼로그(BaselineLockPage의 ConfirmLockDialog 패턴 재사용).
 * 접근성: role="dialog" + aria-modal + 라벨, 열릴 때 확인 버튼에 포커스, Esc로 취소.
 */
export function ConfirmGenerateDialog({
  open,
  period,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  period: { from: string; to: string };
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => {
        if (!pending) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mrv-generate-dialog-title"
        aria-describedby="mrv-generate-dialog-desc"
        className="flex w-full max-w-md flex-col gap-4 rounded-card border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="mrv-generate-dialog-title" className="text-lg font-bold text-fg">
          MRV 리포트를 생성하시겠습니까?
        </h2>
        <p id="mrv-generate-dialog-desc" className="text-sm text-muted">
          아래 기간(After)을 기준으로 잠긴 기준선(Before)과 비교한 감축량 리포트를 생성합니다.
          생성된 리포트는 이력에 계속 남습니다(append-only).
        </p>
        <p className="rounded-md bg-bg px-3 py-2 text-sm text-fg">
          After 기간: {period.from.slice(0, 10)} ~ {period.to.slice(0, 10)}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-border px-4 py-2 text-sm text-fg hover:bg-bg disabled:opacity-50"
          >
            취소
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "생성 중…" : "리포트 생성"}
          </button>
        </div>
      </div>
    </div>
  );
}
