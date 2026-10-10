"use client"

/**
 * 감사 로그 뷰어 (ENTERPRISE).
 * 원본: mrv-platform/apps/web/src/features/audit-log/AuditLogPage.tsx
 *
 * 기준선 잠금, 수기 입력, 알림 확인, 제어 승인·적용, 플랜 변경 — 모든 변경이 여기 남는다.
 * 읽기 전용이라 역할 제한을 두지 않는다: 누가 무엇을 바꿨는지 투명하게 보는 것이 목적이므로
 * viewer 도 볼 수 있어야 한다.
 */

import { useState } from "react"
import { ApiError, apiFetch, useApiQuery } from "@/lib/mrv/client"
import { useMrvSession } from "@/lib/mrv/ui/session"
import { formatIsoLocal } from "@/lib/mrv/ui/datetime"
import {
  CenteredMessage,
  INPUT_CLASS,
  LoadError,
  PageHeader,
  SECONDARY_BUTTON,
} from "@/components/mrv/ui"
import type { AuditLogListResponse } from "@/lib/mrv/api-types"

const PAGE_SIZE = 50

export default function AuditLogPage() {
  const { isEnterprise, isLoading: sessionLoading } = useMrvSession()

  const [entity, setEntity] = useState("")
  const [action, setAction] = useState("")
  const [offset, setOffset] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)

  const query = useApiQuery<AuditLogListResponse>(
    (signal) =>
      apiFetch<AuditLogListResponse>("/audit-logs", {
        query: {
          entity: entity || undefined,
          action: action || undefined,
          limit: PAGE_SIZE,
          offset,
        },
        signal,
      }),
    [entity, action, offset],
    { enabled: isEnterprise },
  )

  const header = (
    <PageHeader
      title="감사 로그"
      description="모든 제어·설정 변경 이력 — 누가 언제 무엇을 바꿨는지"
    />
  )

  if (sessionLoading) return null

  if (!isEnterprise) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
        {header}
        <CenteredMessage>감사 로그는 ENTERPRISE 요금제에서 이용할 수 있습니다.</CenteredMessage>
      </div>
    )
  }

  const isUnauthorized = query.error instanceof ApiError && query.error.isUnauthorized
  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      {header}

      <section className="flex flex-wrap items-end gap-3 rounded-xl border border-mrv-border bg-mrv-surface p-4">
        <label className="flex flex-col gap-1 text-sm text-mrv-fg">
          대상(entity)
          <input
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value)
              setOffset(0)
            }}
            placeholder="예: baselines"
            className={`${INPUT_CLASS} py-2`}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-mrv-fg">
          동작(action)
          <input
            value={action}
            onChange={(e) => {
              setAction(e.target.value)
              setOffset(0)
            }}
            placeholder="예: lock"
            className={`${INPUT_CLASS} py-2`}
          />
        </label>
      </section>

      {query.isLoading && (
        <div
          role="status"
          aria-label="감사 로그 불러오는 중"
          className="h-40 animate-pulse rounded-xl border border-mrv-border bg-mrv-surface"
        />
      )}

      {query.isError && !query.isLoading && (
        <LoadError
          message="감사 로그를 불러오지 못했습니다."
          isUnauthorized={isUnauthorized}
          onRetry={query.refetch}
        />
      )}

      {!query.isLoading && !query.isError && items.length === 0 && (
        <CenteredMessage>조건에 맞는 감사 로그가 없습니다.</CenteredMessage>
      )}

      {items.length > 0 && (
        <>
          <ul className="flex flex-col gap-2">
            {items.map((log) => (
              <li
                key={log.id}
                className="flex flex-col gap-2 rounded-xl border border-mrv-border bg-mrv-surface p-4 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-mrv-fg">
                    {log.entity} · {log.action}
                  </span>
                  <span className="break-all text-xs text-mrv-muted">{log.entity_id}</span>
                  <span className="ml-auto text-xs text-mrv-muted">
                    {log.actor_id} · {formatIsoLocal(log.ts)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                  className="self-start text-xs text-mrv-primary hover:underline"
                >
                  {expanded === log.id ? "변경 내용 접기" : "변경 내용 보기"}
                </button>
                {expanded === log.id && (
                  <pre className="overflow-auto rounded-md bg-mrv-bg p-3 text-[11px] leading-relaxed text-mrv-fg">
                    {JSON.stringify(log.diff, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between gap-2 text-sm text-mrv-muted">
            <span>
              {offset + 1}–{Math.min(offset + items.length, total)} / 총 {total}건
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className={SECONDARY_BUTTON}
              >
                이전
              </button>
              <button
                type="button"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className={SECONDARY_BUTTON}
              >
                다음
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
