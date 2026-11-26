"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/** 이전/다음 이동과 날짜 직접 선택. hrefFor 대신 문자열 틀을 받아 서버 컴포넌트에서 쓸 수 있게 한다. */
export function DateNav({
  basePath,
  query = {},
  date,
  prev,
  next,
  label,
  max,
}: {
  basePath: string;
  /** date 외에 유지할 쿼리 */
  query?: Record<string, string>;
  date: string;
  prev: string;
  next: string;
  label: string;
  max?: string;
}) {
  const router = useRouter();
  const href = (d: string) => `${basePath}?${new URLSearchParams({ ...query, date: d }).toString()}`;
  const arrow = "flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-foreground hover:bg-accent";
  return (
    <div className="no-print flex items-center gap-2">
      <Link href={href(prev)} aria-label="이전" className={arrow}>
        <ChevronLeft className="size-5" />
      </Link>
      <span className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold text-foreground md:flex-none md:px-2">{label}</span>
      <Link href={href(next)} aria-label="다음" className={arrow}>
        <ChevronRight className="size-5" />
      </Link>
      <input
        type="date"
        aria-label="날짜 선택"
        value={date}
        max={max}
        onChange={(e) => e.target.value && router.push(href(e.target.value))}
        className="h-10 w-[9.5rem] shrink-0 rounded-lg border border-border bg-card px-2 text-base text-foreground md:text-sm"
      />
    </div>
  );
}
