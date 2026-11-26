import * as React from "react";
import { cn } from "@/lib/utils";

/** 인쇄용 문서 틀. 화면에서는 카드, 인쇄 시에는 테두리 없는 A4 문서로 보인다. */
export function Doc({ children }: { children: React.ReactNode }) {
  return (
    <article className="dw-paper print-plain rounded-xl border border-border p-4 shadow-xs md:p-8">{children}</article>
  );
}

export function DocTitle({ title, meta }: { title: string; meta: { label: string; value: React.ReactNode }[] }) {
  return (
    <header className="mb-5 border-b-2 border-foreground pb-3">
      <p className="text-xs font-semibold tracking-[0.2em] text-brand-fg">CULIVER</p>
      <h1 className="mt-1 text-xl font-bold text-foreground md:text-2xl">{title}</h1>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {meta.map((m) => (
          <div key={m.label} className="flex gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">{m.label}</dt>
            <dd className="min-w-0 font-medium text-foreground">{m.value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

export function DocSection({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("mt-6 first:mt-0", className)}>
      <h2 className="mb-2 border-l-4 border-brand pl-2 text-[15px] font-bold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** 넓은 표는 페이지가 아니라 표 영역 안에서 가로로 스크롤된다. */
export function DocTable({ head, children, minWidth = 560 }: { head: React.ReactNode[]; children: React.ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full border-collapse text-sm print:!min-w-0 print:text-[11px]" style={{ minWidth }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className="border border-border bg-muted px-2 py-1.5 text-left font-semibold text-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border border-border px-2 py-1.5 align-top text-foreground", className)} {...props} />;
}

export function StatGrid({ stats }: { stats: { label: string; value: React.ReactNode; sub?: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="avoid-break rounded-lg border border-border px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">{s.label}</dt>
          <dd className="mt-0.5 text-lg font-bold text-foreground">{s.value}</dd>
          {s.sub && <dd className="text-xs text-muted-foreground">{s.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

export function NoteList({ rows, empty }: { rows: { key: string; head: string; text: string }[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((r) => (
        <li key={r.key} className="avoid-break flex gap-2">
          <span className="w-28 shrink-0 text-muted-foreground">{r.head}</span>
          <span className="min-w-0 whitespace-pre-wrap break-words text-foreground">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}
