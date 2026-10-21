/*
 * KPI 카드.
 * 원본: mrv-platform/apps/web/src/features/dashboard/components/KpiCard.tsx
 *
 * 절대 규칙: 산식/집계를 화면에서 재계산하지 않는다. metric 의 value/unit/status 를 그대로 쓴다.
 * 접근성: 신호등은 색만으로 의미를 전달하지 않는다 — 색 + 텍스트 라벨 + 형태(●/■/▲/–)를 함께 낸다.
 *
 * ★ 정의가 잠정인 지표(지금은 OEI)는 카드가 그 사실을 적는다. 판정은 화면이 하지 않고
 *   `lib/mrv/metric-provenance.ts` 에서 온다 — 이 카드는 `/mrv/overview` 와
 *   `/mrv/baseline` 두 화면이 함께 쓰므로, 여기 한 번 적으면 두 곳이 같은 사실을 말한다.
 */

import {
  PROVISIONAL_METRIC_MARK,
  isProvisionalMetric,
  provisionalMetricReason,
} from "@/lib/mrv/metric-provenance"
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

export function KpiCard({
  title,
  metricKey,
  metric,
  configVersion,
  period,
  betterWhen,
}: KpiCardProps) {
  // metric 이 없거나 value 가 없으면 '산출 불가'다 — 0 으로 보여 주지 않는다.
  // `== null` 로 undefined 까지 함께 잡는다. `=== null` 만 보면 값이 없을 때 formatValue 가
  // undefined 를 받아 던지고, 오류 경계가 **화면 전체**를 "Server Error" 로 바꿔 버린다
  // (한 카드의 값 하나 때문에 나머지 지표까지 못 보게 된다).
  const isNa = metric === null || metric.value == null
  const status: KpiMetricStatus = isNa ? "na" : metric.status
  const signal = SIGNAL_PRESENTATION[status]

  // 정의가 잠정인 지표인가. 값을 감추거나 신호등을 끄지 않는다 — 값은 그대로 내고 그것이
  // 무엇인지 적는다(끄는 결정은 사람이 한다).
  const isProvisional = isProvisionalMetric(metricKey)
  // 배지(PROVISIONAL_METRIC_MARK)를 제목 바로 아래 이미 달았으므로 문단에서는
  // 그 네 글자를 떼어 낸 쪽을 쓴다 — 안 그러면 "잠정 지표 — 잠정 지표 …" 가 된다.
  const provisionalNote = provisionalMetricReason(metricKey)

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-mrv-border bg-mrv-surface p-5 shadow-sm"
      aria-label={`${title} KPI 카드`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col items-start gap-1">
          <h3 className="text-sm font-semibold text-mrv-fg">{title}</h3>
          {/* 색이 아니라 글자가 표시다 — 테두리와 배경은 보조다. */}
          {isProvisional && (
            <span className="rounded border border-mrv-amber bg-mrv-amber-bg px-1.5 py-0.5 text-[11px] font-medium text-mrv-fg">
              {PROVISIONAL_METRIC_MARK}
            </span>
          )}
        </div>
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

      {/* 잠정 지표는 "무엇이 미확정인지" 까지 카드 안에서 적는다. 값이 '산출 불가' 여도
          적는다 — 미확정인 것은 정의이지 그 기간의 데이터가 아니다. 12px 본문이라 AA
          기준이 4.5:1 이고, text-mrv-muted on bg-mrv-amber-bg 는 그에 못 미치므로
          같은 상자의 다른 경고와 같은 text-mrv-fg 로 맞춘다. */}
      {provisionalNote !== null && (
        <p className="rounded-md border border-mrv-amber bg-mrv-amber-bg p-2 text-xs leading-relaxed text-mrv-fg">
          {provisionalNote}
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
