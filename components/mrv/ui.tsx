/**
 * MRV 화면이 공유하는 작은 표시 조각들.
 * 원본 여러 페이지에 같은 모양으로 반복되던 로딩/에러/빈 상태 박스와 배지를 모았다.
 */

import type { ReactNode } from "react"

/** 카드 한 장 크기의 안내 박스(로딩·에러·빈 상태 공용). */
export function CenteredMessage({
  tone = "muted",
  role,
  children,
}: {
  tone?: "muted" | "error"
  role?: string
  children: ReactNode
}) {
  return (
    <div
      role={role}
      className={`flex min-h-[8rem] items-center justify-center rounded-xl border border-mrv-border bg-mrv-surface p-8 text-center text-sm ${
        tone === "error" ? "text-mrv-red" : "text-mrv-muted"
      }`}
    >
      {children}
    </div>
  )
}

/** 조회 실패 안내 + 재시도. 인증 만료는 문구를 달리해 사용자가 원인을 알게 한다. */
export function LoadError({
  message = "데이터를 불러오지 못했습니다.",
  isUnauthorized = false,
  onRetry,
}: {
  message?: string
  isUnauthorized?: boolean
  onRetry?: () => void
}) {
  return (
    <CenteredMessage tone="error" role="alert">
      <div className="flex flex-col items-center gap-2">
        <p>{isUnauthorized ? "인증이 만료되었습니다. 다시 로그인해 주세요." : message}</p>
        {!isUnauthorized && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-mrv-border px-3 py-1 text-mrv-fg hover:bg-mrv-bg"
          >
            다시 시도
          </button>
        )}
      </div>
    </CenteredMessage>
  )
}

/** 화면 상단 제목 + 부제. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-mrv-fg">{title}</h1>
        {description && <p className="text-sm text-mrv-muted">{description}</p>}
      </div>
      {actions}
    </header>
  )
}

/** 표준 카드 컨테이너. */
export function Card({
  children,
  className = "",
  ...rest
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={`rounded-xl border border-mrv-border bg-mrv-surface p-5 shadow-sm ${className}`}
      {...rest}
    >
      {children}
    </section>
  )
}

/** 상태·등급 배지. */
export function Badge({
  children,
  className = "",
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  )
}

/** 표시용 숫자 서식. null 은 '산출 불가' — 0 으로 위장하지 않는다. */
export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "산출 불가"
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })
}

/** 기본 버튼 스타일(주 동작). */
export const PRIMARY_BUTTON =
  "rounded-md bg-mrv-primary px-4 py-2 text-sm font-medium text-white " +
  "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"

/** 보조 버튼 스타일. */
export const SECONDARY_BUTTON =
  "rounded-md border border-mrv-border bg-mrv-surface px-4 py-2 text-sm font-medium " +
  "text-mrv-fg hover:bg-mrv-bg disabled:cursor-not-allowed disabled:opacity-50"

/** 입력 요소 공통 스타일. */
export const INPUT_CLASS =
  "rounded-md border border-mrv-border bg-mrv-surface px-2 py-1.5 text-sm text-mrv-fg"
