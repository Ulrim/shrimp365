import { useId, useState } from "react";
import { BatchSelect } from "./BatchSelect";
import { useCreateMortalityLog } from "@/hooks/useCreateMortalityLog";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api-client";
import { nowLocalInputValue, localInputToIsoUtc } from "@/lib/datetime";
import type { MortalityLogRequest } from "@/types/api";

/*
 * 폐사 입력 폼 (MASTER 화면4, 슬라이스 B 데이터원).
 * 검증: batch 선택 필수, dead_count >= 0 정수, ts 유효, cause_note 선택.
 * 성공 시 KPI(폐사율) 무효화(훅)·성공 메시지. viewer는 비활성 + 안내.
 */
export function MortalityLogForm({ siteId }: { siteId: string }) {
  const { canWriteLogs, isViewer } = useAuth();
  const mutation = useCreateMortalityLog(siteId);

  const deadId = useId();
  const tsId = useId();
  const noteId = useId();

  const [batchId, setBatchId] = useState("");
  const [ts, setTs] = useState(() => nowLocalInputValue());
  const [deadCount, setDeadCount] = useState("");
  const [causeNote, setCauseNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const disabled = !canWriteLogs || mutation.isPending;

  function validate(): MortalityLogRequest | null {
    if (!batchId.trim()) {
      setFieldError("배치를 선택하세요.");
      return null;
    }
    const iso = localInputToIsoUtc(ts);
    if (!iso) {
      setFieldError("폐사 기록 시각이 올바르지 않습니다.");
      return null;
    }
    const count = Number(deadCount);
    if (!Number.isInteger(count) || count < 0) {
      setFieldError("폐사 개체수는 0 이상의 정수여야 합니다.");
      return null;
    }
    setFieldError(null);
    const body: MortalityLogRequest = {
      batch_id: batchId.trim(),
      ts: iso,
      dead_count: count,
    };
    const note = causeNote.trim();
    if (note) body.cause_note = note;
    return body;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const body = validate();
    if (!body) return;
    mutation.mutate(body, {
      onSuccess: () => {
        setDeadCount("");
        setCauseNote("");
      },
    });
  }

  const serverError =
    mutation.isError && mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.isError
        ? "폐사 기록 저장에 실패했습니다."
        : null;

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="폐사 입력 폼"
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-fg">폐사 입력</h2>

      {isViewer && (
        <p
          role="note"
          className="rounded-md bg-signal-na-bg px-3 py-2 text-xs text-muted"
        >
          읽기 전용 권한(viewer)입니다. 폐사 입력은 owner/operator만 가능합니다.
        </p>
      )}

      <BatchSelect
        siteId={siteId}
        value={batchId}
        onChange={setBatchId}
        disabled={disabled}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={tsId} className="text-sm font-medium text-fg">
          기록 시각 <span className="text-signal-red">*</span>
        </label>
        <input
          id={tsId}
          type="datetime-local"
          value={ts}
          disabled={disabled}
          onChange={(e) => setTs(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg disabled:opacity-60"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={deadId} className="text-sm font-medium text-fg">
          폐사 개체수 <span className="text-signal-red">*</span>
        </label>
        <input
          id={deadId}
          type="number"
          inputMode="numeric"
          step="1"
          min="0"
          value={deadCount}
          disabled={disabled}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? `${deadId}-err` : undefined}
          onChange={(e) => setDeadCount(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg disabled:opacity-60"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={noteId} className="text-sm font-medium text-fg">
          원인 메모 (선택)
        </label>
        <textarea
          id={noteId}
          value={causeNote}
          disabled={disabled}
          rows={2}
          onChange={(e) => setCauseNote(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg disabled:opacity-60"
        />
      </div>

      {fieldError && (
        <p id={`${deadId}-err`} role="alert" className="text-sm text-signal-red">
          {fieldError}
        </p>
      )}
      {serverError && (
        <p role="alert" className="text-sm text-signal-red">
          {serverError}
        </p>
      )}
      {mutation.isSuccess && (
        <p role="status" className="text-sm text-signal-green">
          폐사 기록이 저장되었습니다.
        </p>
      )}

      <button
        type="submit"
        disabled={disabled}
        className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {mutation.isPending ? "저장 중…" : "폐사 기록 저장"}
      </button>
    </form>
  );
}
