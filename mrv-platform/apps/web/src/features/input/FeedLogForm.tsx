import { useId, useState } from "react";
import { BatchSelect } from "./BatchSelect";
import { useCreateFeedLog } from "@/hooks/useCreateFeedLog";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api-client";
import { nowLocalInputValue, localInputToIsoUtc } from "@/lib/datetime";
import type { FeedLogRequest } from "@/types/api";

/*
 * 급이 입력 폼 (MASTER 화면4, 슬라이스 A 데이터원).
 * 검증: batch 선택 필수, feed_kg > 0, ts 유효.
 * 성공 시 KPI(FCR) 무효화(훅)·성공 메시지. viewer는 비활성 + 안내.
 * 절대 규칙: 프론트에서 KPI 재계산하지 않는다(입력만 전송).
 */
export function FeedLogForm({ siteId }: { siteId: string }) {
  const { canWriteLogs, isViewer } = useAuth();
  const mutation = useCreateFeedLog(siteId);

  const feedKgId = useId();
  const tsId = useId();

  const [batchId, setBatchId] = useState("");
  const [ts, setTs] = useState(() => nowLocalInputValue());
  const [feedKg, setFeedKg] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const disabled = !canWriteLogs || mutation.isPending;

  function validate(): FeedLogRequest | null {
    if (!batchId.trim()) {
      setFieldError("배치를 선택하세요.");
      return null;
    }
    const iso = localInputToIsoUtc(ts);
    if (!iso) {
      setFieldError("급이 시각이 올바르지 않습니다.");
      return null;
    }
    const kg = Number(feedKg);
    if (!Number.isFinite(kg) || kg <= 0) {
      setFieldError("급이량(kg)은 0보다 큰 값이어야 합니다.");
      return null;
    }
    setFieldError(null);
    return { batch_id: batchId.trim(), ts: iso, feed_kg: kg };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const body = validate();
    if (!body) return;
    mutation.mutate(body, {
      onSuccess: () => {
        // 다음 입력을 위해 수량만 초기화(배치/시각은 연속 입력 편의로 유지).
        setFeedKg("");
      },
    });
  }

  const serverError =
    mutation.isError && mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.isError
        ? "급이 기록 저장에 실패했습니다."
        : null;

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="급이 입력 폼"
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5 shadow-sm"
    >
      <h2 className="text-base font-semibold text-fg">급이 입력</h2>

      {isViewer && (
        <p
          role="note"
          className="rounded-md bg-signal-na-bg px-3 py-2 text-xs text-muted"
        >
          읽기 전용 권한(viewer)입니다. 급이 입력은 owner/operator만 가능합니다.
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
          급이 시각 <span className="text-signal-red">*</span>
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
        <label htmlFor={feedKgId} className="text-sm font-medium text-fg">
          급이량 (kg) <span className="text-signal-red">*</span>
        </label>
        <input
          id={feedKgId}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={feedKg}
          disabled={disabled}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? `${feedKgId}-err` : undefined}
          onChange={(e) => setFeedKg(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg disabled:opacity-60"
        />
      </div>

      {fieldError && (
        <p id={`${feedKgId}-err`} role="alert" className="text-sm text-signal-red">
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
          급이 기록이 저장되었습니다.
        </p>
      )}

      <button
        type="submit"
        disabled={disabled}
        className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {mutation.isPending ? "저장 중…" : "급이 기록 저장"}
      </button>
    </form>
  );
}
