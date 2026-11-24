import Link from "next/link";
import { Card } from "@/components/work/ui/card";
import { cn } from "@/lib/utils";

/** 대시보드 상단의 숫자 지표 카드 */
export function StatCard({
  label,
  value,
  unit,
  sub,
  href,
  tone = "default",
  testId,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  href?: string;
  tone?: "default" | "alert" | "warn" | "good";
  testId?: string;
}) {
  const color = { default: "text-foreground", alert: "dw-fg-red", warn: "dw-fg-amber", good: "text-brand-fg" }[tone];
  const body = (
    <Card className={cn("h-full p-4", href && "transition-colors hover:border-brand-a40")}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-2xl font-bold tracking-tight", color)} data-testid={testId}>
        {value}
        {unit && <span className="ml-0.5 text-sm font-semibold text-muted-foreground">{unit}</span>}
      </p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}
