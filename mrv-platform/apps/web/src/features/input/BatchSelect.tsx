import { useId } from "react";
import { useSiteBatches } from "@/hooks/useSiteBatches";
import { ApiError } from "@/lib/api-client";

/*
 * 배치(입식 사이클) 선택기. 급이/폐사 입력 폼에서 공유.
 * 로딩/에러/빈 상태를 명시적으로 처리한다.
 * 목록 조회가 불가(에러/빈)하면 배치 ID 직접 입력으로 폴백해 입력이 막히지 않게 한다.
 */
export function BatchSelect({
  siteId,
  value,
  onChange,
  disabled,
}: {
  siteId: string;
  value: string;
  onChange: (batchId: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const { data, isLoading, isError, error } = useSiteBatches(siteId);

  const isUnauthorized = error instanceof ApiError && error.isUnauthorized;
  const batches = data ?? [];
  const useManualFallback = !isLoading && (isError || batches.length === 0);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-fg">
        배치 <span className="text-signal-red">*</span>
      </label>

      {isLoading && (
        <div
          role="status"
          className="h-10 animate-pulse rounded-md border border-border bg-surface"
          aria-label="배치 목록 불러오는 중"
        />
      )}

      {!isLoading && !useManualFallback && (
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg disabled:opacity-60"
        >
          <option value="">배치를 선택하세요</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.id} · {b.species} · 입식 {b.stocked_count.toLocaleString("ko-KR")}
              마리{b.closed_at ? " (종료)" : ""}
            </option>
          ))}
        </select>
      )}

      {useManualFallback && (
        <>
          <input
            id={id}
            type="text"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder="배치 ID 직접 입력"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg disabled:opacity-60"
          />
          <p className="text-xs text-muted">
            {isUnauthorized
              ? "인증이 만료되어 배치 목록을 불러오지 못했습니다. 배치 ID를 직접 입력하세요."
              : isError
                ? "배치 목록을 불러오지 못했습니다. 배치 ID를 직접 입력하세요."
                : "등록된 배치가 없습니다. 배치 ID를 직접 입력하세요."}
          </p>
        </>
      )}
    </div>
  );
}
