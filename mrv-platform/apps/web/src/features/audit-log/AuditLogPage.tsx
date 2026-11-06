import { useId, useState } from "react";
import { useAuditLogs } from "@/hooks/useAuditLogs";
import { ApiError } from "@/lib/api-client";
import { formatIsoLocal } from "@/lib/datetime";
import type { AuditLogEntry } from "@/types/api";

/*
 * 감사 로그 뷰어(MASTER 화면14, phase-3 5절, ENTERPRISE). GET /audit-logs 응답을 그대로
 * 나열한다 — 신규 산식/판정 없음(순수 조회). 읽기 전용 특성 그대로 반영: 버튼류(쓰기 액션)
 * 자체가 없으므로 viewer도 이 화면 전체를 문제없이 사용할 수 있다(별도 게이팅 불요).
 * entity/action 필터는 백엔드가 화이트리스트 없이 문자열 그대로 매칭(5절) — FE도 자유 입력.
 */

function dayToIsoUtc(day: string, endOfDay = false): string | null {
  if (!day) return null;
  const iso = `${day}T${endOfDay ? "23:59:59" : "00:00:00"}Z`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

export function AuditLogPage() {
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [appliedFilters, setAppliedFilters] = useState<{
    entity?: string;
    action?: string;
    from?: string;
    to?: string;
  }>({});

  const listQuery = useAuditLogs(appliedFilters);
  const apiError = listQuery.error instanceof ApiError ? listQuery.error : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAppliedFilters({
      entity: entity.trim() || undefined,
      action: action.trim() || undefined,
      from: dayToIsoUtc(from) ?? undefined,
      to: dayToIsoUtc(to, true) ?? undefined,
    });
  }

  const entityId = useId();
  const actionId = useId();
  const fromId = useId();
  const toId = useId();

  return (
    <PageShell>
      <form
        onSubmit={handleSubmit}
        aria-label="감사 로그 필터"
        className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-5"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={entityId} className="text-xs font-medium text-fg">
            entity
          </label>
          <input
            id={entityId}
            type="text"
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            placeholder="예: baselines"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={actionId} className="text-xs font-medium text-fg">
            action
          </label>
          <input
            id={actionId}
            type="text"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="예: lock"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={fromId} className="text-xs font-medium text-fg">
            시작일
          </label>
          <input
            id={fromId}
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={toId} className="text-xs font-medium text-fg">
            종료일
          </label>
          <input
            id={toId}
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
          />
        </div>
        <button
          type="submit"
          className="rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-bg"
        >
          검색
        </button>
      </form>

      {listQuery.isLoading && (
        <div
          role="status"
          aria-label="감사 로그 불러오는 중"
          className="h-40 animate-pulse rounded-card border border-border bg-surface"
        />
      )}

      {apiError?.status === 403 && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-card border border-border bg-surface p-5 text-sm"
        >
          <p className="font-semibold text-fg">감사 로그를 사용할 수 없습니다</p>
          <p className="text-muted">
            감사 로그는 ENTERPRISE 요금제에서 제공됩니다. 요금제를 업그레이드하면 이용할 수
            있습니다.
          </p>
        </div>
      )}
      {apiError?.isUnauthorized && (
        <p role="alert" className="text-sm text-signal-red">
          인증이 만료되었습니다. 다시 로그인해 주세요.
        </p>
      )}
      {listQuery.isError && !apiError && (
        <p role="alert" className="text-sm text-signal-red">
          감사 로그를 불러오지 못했습니다.
        </p>
      )}

      {listQuery.data && listQuery.data.items.length === 0 && (
        <p
          role="status"
          className="rounded-card border border-border bg-surface p-6 text-sm text-muted"
        >
          조건에 해당하는 감사 로그가 없습니다.
        </p>
      )}

      {listQuery.data && listQuery.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-4 py-2">entity</th>
                <th className="px-4 py-2">action</th>
                <th className="px-4 py-2">actor</th>
                <th className="px-4 py-2">시각</th>
                <th className="px-4 py-2">diff</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.items.map((entry) => (
                <AuditLogRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}

function AuditLogRow({ entry }: { entry: AuditLogEntry }) {
  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="px-4 py-2 text-fg">
        {entry.entity}
        <span className="block text-xs text-muted">{entry.entity_id}</span>
      </td>
      <td className="px-4 py-2 text-fg">{entry.action}</td>
      <td className="px-4 py-2 text-muted">{entry.actor_id}</td>
      <td className="px-4 py-2 text-muted">{formatIsoLocal(entry.ts)}</td>
      <td className="px-4 py-2">
        {entry.diff ? (
          <details>
            <summary className="cursor-pointer text-xs text-primary">diff 보기</summary>
            <pre className="mt-1 max-w-xs overflow-x-auto whitespace-pre-wrap rounded-md bg-bg p-2 text-xs text-fg">
              {JSON.stringify(entry.diff, null, 2)}
            </pre>
          </details>
        ) : (
          <span className="text-xs text-muted">-</span>
        )}
      </td>
    </tr>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-fg">감사 로그</h1>
        <p className="text-sm text-muted">
          조직 전체의 제어/설정 변경 이력(읽기 전용, ENTERPRISE)
        </p>
      </header>
      {children}
    </div>
  );
}
