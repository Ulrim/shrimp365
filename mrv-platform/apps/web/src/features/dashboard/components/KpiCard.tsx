import type { KpiCardProps, KpiMetricStatus } from "@/types/api";

/*
 * KPI 카드 (스프린트 0 첫 산출물).
 * 절대 규칙: 산식/집계를 프론트에서 재계산하지 않는다. metric.value / unit / status를 그대로 표시.
 * 접근성: 신호등은 색만으로 의미를 전달하지 않는다 — 색 + 텍스트 라벨 + 아이콘(●/■/▲/–)을 함께 렌더.
 */

interface SignalPresentation {
  label: string;
  icon: string; // 색맹 사용자를 위한 형태 구분(색과 독립)
  textClass: string;
  bgClass: string;
}

const SIGNAL_PRESENTATION: Record<KpiMetricStatus, SignalPresentation> = {
  green: {
    label: "정상",
    icon: "●",
    textClass: "text-signal-green",
    bgClass: "bg-signal-green-bg",
  },
  amber: {
    label: "주의",
    icon: "▲",
    textClass: "text-signal-amber",
    bgClass: "bg-signal-amber-bg",
  },
  red: {
    label: "경고",
    icon: "■",
    textClass: "text-signal-red",
    bgClass: "bg-signal-red-bg",
  },
  na: {
    label: "산출 불가",
    icon: "–",
    textClass: "text-signal-na",
    bgClass: "bg-signal-na-bg",
  },
};

function formatValue(value: number): string {
  // 표시 서식만 담당(반올림은 표시용 소수 2자리). 산식 재계산이 아님.
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatPeriod(from: string, to: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString("ko-KR", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
  };
  return `${fmt(from)} ~ ${fmt(to)}`;
}

export function KpiCard({
  title,
  metric,
  configVersion,
  period,
  betterWhen,
}: KpiCardProps) {
  // metric===null 또는 value===null → "산출 불가"(na)로 취급.
  const isNa = metric === null || metric.value === null;
  const status: KpiMetricStatus = isNa ? "na" : metric.status;
  const signal = SIGNAL_PRESENTATION[status];

  return (
    <section
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5 shadow-sm"
      aria-label={`${title} KPI 카드`}
    >
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${signal.bgClass} ${signal.textClass}`}
          role="status"
        >
          <span aria-hidden="true">{signal.icon}</span>
          <span>{signal.label}</span>
        </span>
      </header>

      <div className="flex items-baseline gap-2">
        {isNa ? (
          <p className="text-2xl font-bold text-signal-na">산출 불가</p>
        ) : (
          <>
            <p className="text-3xl font-bold tabular-nums text-fg">
              {formatValue(metric!.value as number)}
            </p>
            <span className="text-sm font-medium text-muted">{metric!.unit}</span>
          </>
        )}
      </div>

      {betterWhen && (
        <p className="text-xs text-muted">
          {betterWhen === "lower"
            ? "낮을수록 좋은 지표"
            : "높을수록 좋은 지표"}
        </p>
      )}

      {isNa && (
        <p className="text-xs text-muted">
          해당 기간에 산출 조건을 만족하지 못했습니다(예: 생산량 변화 부족).
        </p>
      )}

      <footer className="mt-1 flex flex-col gap-0.5 border-t border-border pt-2 text-[11px] leading-tight text-muted">
        {/* 증빙: 어떤 산식 버전으로 산출됐는지 + 대상 기간 */}
        <span>산식 버전 {configVersion}</span>
        <span>{formatPeriod(period.from, period.to)}</span>
      </footer>
    </section>
  );
}
