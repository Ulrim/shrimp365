import { useEffect, useRef } from "react";

/*
 * 제어 콘솔 이중확인 다이얼로그(baseline/ConfirmLockDialog.tsx·onboarding/PlanChangeDialog.tsx와
 * 동형 패턴 재사용). 승인/적용 두 시점에서 재사용하는 범용 버전 — title/description/
 * confirmLabel을 호출부가 지정하고, 적용(apply) 시점엔 children으로 result_json 입력 폼을
 * 끼워 넣는다. 접근성: role="dialog" + aria-modal + 라벨, 열릴 때 확인 버튼에 포커스,
 * Esc로 취소(pending 중엔 닫기 불가).
 */
export function ControlActionConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel,
  pending,
  disabled,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
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
        aria-labelledby="control-action-dialog-title"
        aria-describedby="control-action-dialog-desc"
        className="flex w-full max-w-md flex-col gap-4 rounded-card border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="control-action-dialog-title" className="text-lg font-bold text-fg">
          {title}
        </h2>
        <p id="control-action-dialog-desc" className="text-sm text-muted">
          {description}
        </p>
        {children}
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
            disabled={pending || disabled}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
