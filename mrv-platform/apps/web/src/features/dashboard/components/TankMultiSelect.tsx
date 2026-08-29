import { useMemo } from "react";
import { useSiteBatches } from "@/hooks/useSiteBatches";
import { ApiError } from "@/lib/api-client";

/*
 * 수조별 비교(4.3절 tankIds 다중 선택) 체크박스 UI.
 * 전용 tanks 목록 API가 없으므로 배치(useSiteBatches)에서 tank_id를 추출해 재사용한다
 * (배치는 항상 특정 수조에 속하므로 사이트 내 수조 집합의 근사치로 충분 — 과설계 금지).
 * 로딩/에러/빈 상태를 명시적으로 처리한다.
 */
export function TankMultiSelect({
  siteId,
  value,
  onChange,
}: {
  siteId: string;
  value: string[];
  onChange: (tankIds: string[]) => void;
}) {
  const { data, isLoading, isError, error } = useSiteBatches(siteId);
  const isUnauthorized = error instanceof ApiError && error.isUnauthorized;

  const tankIds = useMemo(() => {
    const set = new Set<string>();
    for (const b of data ?? []) set.add(b.tank_id);
    return Array.from(set).sort();
  }, [data]);

  function toggle(tankId: string) {
    if (value.includes(tankId)) {
      onChange(value.filter((id) => id !== tankId));
    } else {
      onChange([...value, tankId]);
    }
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-fg">수조별 비교</legend>

      {isLoading && (
        <div
          role="status"
          className="h-9 w-full animate-pulse rounded-md border border-border bg-surface"
          aria-label="수조 목록 불러오는 중"
        />
      )}

      {!isLoading && isError && (
        <p className="text-xs text-signal-red" role="alert">
          {isUnauthorized
            ? "인증이 만료되어 수조 목록을 불러오지 못했습니다."
            : "수조 목록을 불러오지 못했습니다."}
        </p>
      )}

      {!isLoading && !isError && tankIds.length === 0 && (
        <p className="text-xs text-muted">등록된 수조가 없습니다.</p>
      )}

      {!isLoading && !isError && tankIds.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {tankIds.map((tankId) => (
            <label
              key={tankId}
              className="flex items-center gap-1.5 text-sm text-fg"
            >
              <input
                type="checkbox"
                checked={value.includes(tankId)}
                onChange={() => toggle(tankId)}
                className="h-4 w-4 rounded border-border"
              />
              {tankId}
            </label>
          ))}
        </div>
      )}

      {value.length === 0 && !isLoading && (
        <p className="text-xs text-muted">
          선택 없음 = 사이트 전체 전력 시계열을 표시합니다.
        </p>
      )}
    </fieldset>
  );
}
