import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 페이지 머리 — Farm365 의 AgriPageHeader 와 같은 자리·같은 글자 크기.
 * 제목 왼쪽, 액션 오른쪽. 640px 미만에서는 액션이 제목 아래로 내려온다.
 * 액션은 인쇄에서 빠진다(제목까지 빼려면 호출부에서 `<div className="no-print">` 로 감싼다).
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between lg:mb-6">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="no-print flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** 실적(막대)과 계획(세로선)을 함께 보여 주는 진행 막대 */
export function ProgressBar({
  value,
  planned,
  tone = "brand",
  className,
}: {
  value: number;
  planned?: number | null;
  tone?: "brand" | "red" | "gray";
  className?: string;
}) {
  const clamp = (n: number) => Math.min(100, Math.max(0, n));
  const fill = { brand: "bg-brand", red: "bg-red-500", gray: "bg-muted-foreground" }[tone];
  return (
    <div
      className={cn("relative h-2 w-full rounded-full bg-border", className)}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cn("h-full rounded-full", fill)} style={{ width: `${clamp(value)}%` }} />
      {planned != null && (
        <div
          className="absolute -top-0.5 h-3 w-0.5 rounded bg-foreground"
          style={{ left: `calc(${clamp(planned)}% - 1px)` }}
          title={`계획 ${planned}%`}
        />
      )}
    </div>
  );
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "-";
  return `${Number(Number(value).toFixed(1))}%`;
}

export function DefinitionList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-sm">
      {items.map((item) => (
        <React.Fragment key={item.label}>
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 whitespace-pre-wrap break-words text-foreground">{item.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
