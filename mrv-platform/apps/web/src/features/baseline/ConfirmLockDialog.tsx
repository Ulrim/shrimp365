import { useEffect, useRef } from "react";

/*
 * 기준선 잠금 확인 다이얼로그. 접근성: role="dialog" + aria-modal + 라벨,
 * 열릴 때 확인 버튼에 포커스, Esc로 취소.
 * "잠금 후 수정 불가" 경고를 명시(Rule 3 불변성 안내).
 */
export function ConfirmLockDialog({
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
        aria-labelledby="lock-dialog-title"
        aria-describedby="lock-dialog-desc"
        className="flex w-full max-w-md flex-col gap-4 rounded-card border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="lock-dialog-title" className="text-lg font-bold text-fg">
          기준선을 잠그시겠습니까?
        </h2>
        <p id="lock-dialog-desc" className="text-sm text-muted">
          잠금 후에는 <strong className="text-signal-red">수정·삭제가 불가능</strong>합니다
          (불변). 아래 기간의 KPI 스냅샷이 기준선(Before)으로 영구 고정됩니다.
        </p>
        <p className="rounded-md bg-bg px-3 py-2 text-sm text-fg">
          기간: {period.from.slice(0, 10)} ~ {period.to.slice(0, 10)}
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
            className="rounded-md bg-signal-red px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "잠그는 중…" : "기준선 잠금"}
          </button>
        </div>
      </div>
    </div>
  );
}
