import { useEffect, useRef } from "react";
import type { Plan } from "@/types/api";

/*
 * 플랜 변경 확인 다이얼로그(ConfirmLockDialog/ConfirmGenerateDialog 패턴 재사용).
 * 접근성: role="dialog" + aria-modal + 라벨, 열릴 때 확인 버튼에 포커스, Esc로 취소.
 * 결제 연동은 범위 밖(phase-3 7.4절) — 이 확인은 "이미 결제/영업 확인이 끝났다"는 것을
 * owner가 재확인하는 절차다.
 */
export function PlanChangeDialog({
  open,
  targetPlan,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  targetPlan: Plan | null;
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

  if (!open || !targetPlan) return null;

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
        aria-labelledby="plan-change-dialog-title"
        aria-describedby="plan-change-dialog-desc"
        className="flex w-full max-w-md flex-col gap-4 rounded-card border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="plan-change-dialog-title" className="text-lg font-bold text-fg">
          요금제를 {targetPlan}(으)로 변경하시겠습니까?
        </h2>
        <p id="plan-change-dialog-desc" className="text-sm text-muted">
          이 작업은 결제/영업 확인이 완료된 뒤에만 수행해야 합니다(자동 청구 없음). 변경 즉시
          조직 전체에 반영됩니다.
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
            {pending ? "변경 중…" : "변경 확인"}
          </button>
        </div>
      </div>
    </div>
  );
}
