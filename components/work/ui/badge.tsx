import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/work/constants";

// 상태색은 app/globals.css 의 dw-tone-* 가 라이트·다크·인쇄 문서 값을 함께 가진다
// (docs/plans/dailywork-merge-ui.md 3장). 여기서 색 이름을 직접 적지 않는다.
const tones: Record<Tone, string> = {
  gray: "dw-tone-gray",
  green: "dw-tone-green",
  blue: "dw-tone-blue",
  amber: "dw-tone-amber",
  red: "dw-tone-red",
  purple: "dw-tone-purple",
};

export function Badge({
  tone = "gray",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "dw-ring inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge<K extends string>({
  map,
  value,
}: {
  map: Record<K, { label: string; tone: Tone }>;
  value: K;
}) {
  const entry = map[value];
  return <Badge tone={entry?.tone ?? "gray"}>{entry?.label ?? value}</Badge>;
}
