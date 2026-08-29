/*
 * KPI 카드.
 * 원본: mrv-platform/apps/web/src/features/dashboard/components/KpiCard.tsx
 *
 * 절대 규칙: 산식/집계를 화면에서 재계산하지 않는다. metric 의 value/unit/status 를 그대로 쓴다.
 * 접근성: 신호등은 색만으로 의미를 전달하지 않는다 — 색 + 텍스트 라벨 + 형태(●/■/▲/–)를 함께 낸다.
 */

import type { KpiCardProps, KpiMetricStatus } from "@/lib/mrv/api-types"

type SignalPresentation = {
  label: string
  /** 색을 구분하기 어려운 사용자를 위한 형태 표시(색과 독립적으로 읽힌다). */
  icon: string
  textClass: string
  bgClass: string
}

const SIGNAL_PRESENTATION: Record<KpiMetricStatus, SignalPresentation> = {
  green: { label: "정상", icon: "●", textClass: "text-mrv-green", bgClass: "bg-mrv-green-bg" },
  amber: { label: "주의", icon: "▲", textClass: "text-mrv-amber", bgClass: "bg-mrv-amber-bg" },
  red: { label: "경고", icon: "■", textClass: "text-mrv-red", bgClass: "bg-mrv-red-bg" },
  na: { label: "산출 불가", icon: "–", textClass: "text-mrv-na", bgClass: "bg-mrv-na-bg" },
}

/** 표시 서식만 담당한다(반올림은 표시용 소수 2자리). 산식 재계산이 아니다. */
function formatValue(value: number): string {
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

function formatPeriod(from: string, to: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })
  }
  return `${fmt(from)} ~ ${fmt(to)}`
}

export function KpiCard({ title, metric, configVersion, period, betterWhen }: KpiCardProps) {
  // metric 이 없거나 value 가 null 이면 '산출 불가'다 — 0 으로 보여 주지 않는다.
  const isNa = metric === null || metric.value === null
  const status: KpiMetricStatus = isNa ? "na" : metric.status
  const signal = SIGNAL_PRESENTATION[status]

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-mrv-border bg-mrv-surface p-5 shadow-sm"
      aria-label={`${title} KPI 카드`}
    >
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-mrv-fg">{title}</h3>
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
          <p className="text-2xl font-bold text-mrv-na">산출 불가</p>
        ) : (
          <>
            <p className="text-3xl font-bold tabular-nums text-mrv-fg">
              {formatValue(metric.value as number)}
            </p>
            <span className="text-sm font-medium text-mrv-muted">{metric.unit}</span>
          </>
        )}
      </div>

      {betterWhen && (
        <p className="text-xs text-mrv-muted">
          {betterWhen === "lower" ? "낮을수록 좋은 지표" : "높을수록 좋은 지표"}
        </p>
      )}

      {isNa && (
        <p className="text-xs text-mrv-muted">
          해당 기간에 산출 조건을 만족하지 못했습니다(예: 생산량 변화 부족).
        </p>
      )}

      {/* 증빙: 어떤 산식 버전으로, 어느 기간을 계산했는지 카드마다 붙는다. */}
      <footer className="mt-1 flex flex-col gap-0.5 border-t border-mrv-border pt-2 text-[11px] leading-tight text-mrv-muted">
        <span>산식 버전 {configVersion}</span>
        <span>{formatPeriod(period.from, period.to)}</span>
      </footer>
    </section>
  )
}
