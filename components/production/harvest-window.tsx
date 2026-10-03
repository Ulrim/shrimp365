"use client"

// 요구 ② — **추천은 점이 아니라 구간이다.**
//
// 엔진 1 의 홀드아웃 MAE 0.895 g 은 출하 크기 20~28 g 에서 3~5% 오차이고, 단가
// 탄력성도 0.63~0.73 밴드다. 「11월 20일에 출하하십시오」라고 점으로 답하면 그
// 답의 신뢰도를 사용자가 알 수 없다. 그래서 **점 마커를 찍지 않는다** —
// `recommended` 는 `ReferenceArea` 로만 그리고 `Line` 의 `dot` 은 false 다.
//
// 구간 안에서 밴드가 겹치면 `recommended.indistinguishableWithinWindow` 가
// true 다. **화면이 그 사실을 문장으로 띄우고 억지로 하루를 고르지 않는다.**
//
// ── 두 모양이고 CSS 로 갈라서는 안 된다 ───────────────────────────────────
//   ≥sm  HarvestWindowBand   ComposedChart
//   <sm  HarvestWindowStrip  차트가 아니다. 가로 1줄 div 리본
// 375px 에서 **범위를 전달하는 데 차트가 필요하지 않다.** 그리고 둘을 다
// 렌더해 놓고 `hidden sm:block` 으로 감추면 recharts 가 폭 0 에서 계산해 차트가
// 사라진다 — 그래서 useIsWide 로 조건부 렌더한다.
//
// 추천 구간에 **해칭**을 깐다(§10 pattern-texture: 색 없이도 구간이 구분돼야
// 한다). 농가의 수동 입력 target_harvest_date 는 `ReferenceLine` 으로
// **병기**한다 — 추천과 다르면 그 사실이 눈에 보여야 한다(계획서 2-3).

import { useState } from "react"
import { CalendarRange, ChevronDown } from "lucide-react"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { useT } from "@/lib/i18n-context"
import type { HarvestWindow } from "@/lib/harvest"

import { ExclusionChip } from "./exclusion-chip"
import { fmt, fmtAmount, fmtAmountTick, fmtG, shortDate, tpl } from "./format"
import { useIsWide } from "./use-is-wide"

const TOOLTIP_STYLE = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  color: "hsl(var(--foreground))",
} as const
const AXIS_TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 11 } as const

export type HarvestWindowViewProps = {
  harvest: HarvestWindow
  /** 농가가 손으로 넣은 목표 출하일. 추천과 **병기**한다. */
  manualTargetDate?: string | null
}

/** 구간 라벨. 날짜가 없으면 **일수로 쓴다 — 날짜를 지어내지 않는다.** */
function windowLabel(h: HarvestWindow, t: ReturnType<typeof useT>["t"]): string | null {
  const r = h.recommended
  if (r === null) return null
  if (r.startDate !== null && r.endDate !== null) {
    return r.startDate === r.endDate ? shortDate(r.startDate) : `${shortDate(r.startDate)} ~ ${shortDate(r.endDate)}`
  }
  return tpl(
    t.production.windowRangeDaysTpl,
    r.startDayOffset === r.endDayOffset ? `${r.startDayOffset}` : `${r.startDayOffset}~${r.endDayOffset}`,
  )
}

export function HarvestWindowView({ harvest, manualTargetDate }: HarvestWindowViewProps) {
  const { t, locale } = useT()
  const wide = useIsWide()
  const [chartOpen, setChartOpen] = useState(false)

  const r = harvest.recommended
  const label = windowLabel(harvest, t)
  const spanDays = r === null ? null : r.endDayOffset - r.startDayOffset + 1

  // 차트용 데이터. 날짜가 없는 후보는 x 에 일수를 쓴다.
  const rows = harvest.candidates.map(c => ({
    x: c.date !== null ? shortDate(c.date) : `${c.dayOffset}${t.engines.unit.day}`,
    dayOffset: c.dayOffset,
    profitKrw: c.operatingProfitKrw,
    bandLow: c.profitBandKrw === null ? null : c.profitBandKrw.low,
    bandSpan: c.profitBandKrw === null ? null : c.profitBandKrw.high - c.profitBandKrw.low,
    abwG: c.abwG,
  }))
  const hasProfit = rows.some(row => row.profitKrw !== null)

  const x1 = r === null ? null : rows.find(row => row.dayOffset === r.startDayOffset)?.x ?? null
  const x2 = r === null ? null : rows.find(row => row.dayOffset === r.endDayOffset)?.x ?? null
  const manualX = manualTargetDate == null ? null : rows.find(row => row.x === shortDate(manualTargetDate))?.x ?? null

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <CalendarRange className="h-4 w-4" aria-hidden="true" />
          {label === null ? t.production.decisionWindowNone : tpl(t.production.decisionWindowTpl, label)}
        </h4>
        {spanDays !== null && (
          <p className="text-xs tabular-nums text-muted-foreground">{tpl(t.production.windowSpanDaysTpl, spanDays)}</p>
        )}
      </div>

      {/* 판정 코드 → 문장. 다섯 코드가 각각 다른 문장이다. */}
      {harvest.decision !== null && (
        <p className="text-sm text-foreground">{t.engines.decision[harvest.decision]}</p>
      )}
      {harvest.failure !== null && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{t.engines.windowFailure[harvest.failure]}</p>
      )}
      {/* 보지 못한 후보 수. hold_beyond_horizon 과 같이 읽어야 하는 수다. */}
      {harvest.unevaluableCandidateCount > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {tpl(t.production.windowUnevaluableTpl, harvest.unevaluableCandidateCount)}
        </p>
      )}

      {/* ── 좁은 화면: 리본. 차트가 아니다 ─────────────────────────────── */}
      {!wide && r !== null && (
        <HarvestWindowStrip harvest={harvest} />
      )}

      {/* ── 넓은 화면: 차트 / 좁은 화면: 토글 뒤에 ────────────────────── */}
      {hasProfit && (wide || chartOpen) && (
        <div className="rounded-xl bg-muted p-2" role="img" aria-label={t.production.windowChartAria}>
          <ResponsiveContainer width="100%" height={wide ? 220 : 180}>
            <ComposedChart data={rows}>
              <defs>
                <pattern id="harvest-hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                  <line x1="0" y1="0" x2="0" y2="6" stroke="#1d4ed8" strokeWidth="2" strokeOpacity="0.28" />
                </pattern>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="x" type="category" tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={32} />
              <YAxis tick={AXIS_TICK} tickFormatter={(v: number) => fmtAmountTick(v, locale, t)} width={56} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v: unknown) => fmtAmount(Number(v), locale, t)}
              />
              {/* 추천 구간 — 해칭. 점 마커가 아니다. */}
              {x1 !== null && x2 !== null && (
                <ReferenceArea x1={x1} x2={x2} fill="url(#harvest-hatch)" />
              )}
              <ReferenceLine y={0} stroke="hsl(var(--foreground))" strokeOpacity={0.4} strokeDasharray="4 4" />
              {/* 농가 수동 입력을 병기한다. */}
              {manualX !== null && (
                <ReferenceLine x={manualX} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 3" />
              )}
              {/* 이익 밴드 — 투명 Area 를 깔고 폭을 쌓는 표준 처방. */}
              <Area dataKey="bandLow" stackId="pb" stroke="none" fill="none" isAnimationActive={false} legendType="none" />
              <Area dataKey="bandSpan" stackId="pb" stroke="none" fill="#3b82f6" fillOpacity={0.1} isAnimationActive={false} legendType="none" />
              <Line dataKey="profitKrw" type="monotone" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
            <span>{t.production.windowBandNote}</span>
            {manualX !== null && <span>{t.production.windowManualTarget} {shortDate(manualTargetDate)}</span>}
          </p>
        </div>
      )}

      {/* 좁은 화면에서는 차트가 토글 뒤다(§5 content-priority). */}
      {!wide && hasProfit && (
        <button
          type="button"
          onClick={() => setChartOpen(v => !v)}
          aria-expanded={chartOpen}
          className="flex min-h-[44px] items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {chartOpen ? t.production.windowHideChart : t.production.windowShowChart}
          <ChevronDown className={`h-3 w-3 transition-transform ${chartOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      )}

      {/* 구간 폭 문장은 **차트 밖에 항상** 쓴다. */}
      {r !== null && r.indistinguishableWithinWindow && (
        <p className="text-xs text-foreground">{t.production.windowIndistinguishable}</p>
      )}

      {/* 밴드 폭이 어디서 왔나. 「신뢰구간」이 아니다. */}
      <p className="text-[11px] text-muted-foreground">
        {harvest.band.sources.map(s => t.engines.bandSource[s]).join(" · ")}
        {" · "}
        {t.engines.bandNotCi}
      </p>

      {/* 엔진 3 이 올린 경고. **여기 안 그리면 실패 사유가 사라진다** —
          예: 냉동 채널을 고르면 후보 전부가 price_unavailable 로 떨어지는데,
          「비교 기준이 없다」만 보이고 「냉동은 기울기 근거가 못 된다」는
          말이 어디에도 안 나온다. 그 말은 후보의 exclusions 에 들어 있고
          window.exclusions 로 올라온다(window.ts 632행). */}
      {harvest.exclusions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {harvest.exclusions.map(e => (
            <ExclusionChip key={`${e.code}|${e.item ?? ""}`} exclusion={e} />
          ))}
        </div>
      )}

      {/* 후보 표 — 차트만으로는 SR 접근이 안 된다(§10 data-table). */}
      <CandidateTable harvest={harvest} />
    </section>
  )
}

/** 좁은 화면용 날짜 리본. **차트가 아니다.** */
function HarvestWindowStrip({ harvest }: { harvest: HarvestWindow }) {
  const { t } = useT()
  const r = harvest.recommended
  if (r === null) return null

  const last = harvest.candidates[harvest.candidates.length - 1]
  const total = Math.max(1, last?.dayOffset ?? r.endDayOffset)
  const leftPct = (r.startDayOffset / total) * 100
  const widthPct = Math.max(4, ((r.endDayOffset - r.startDayOffset) / total) * 100)
  const label = windowLabel(harvest, t)

  return (
    <div className="space-y-1">
      <div className="relative h-5 w-full overflow-hidden rounded-md bg-muted" role="img" aria-label={label ?? ""}>
        <div
          className="absolute inset-y-0 bg-[repeating-linear-gradient(45deg,transparent_0_3px,rgba(29,78,216,0.35)_3px_5px)] border-x border-ocean-600"
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>{harvest.candidates[0]?.date !== null && harvest.candidates[0] !== undefined ? shortDate(harvest.candidates[0].date) : `0${t.engines.unit.day}`}</span>
        <span>{last?.date != null ? shortDate(last.date) : `${total}${t.engines.unit.day}`}</span>
      </div>
    </div>
  )
}

function CandidateTable({ harvest }: { harvest: HarvestWindow }) {
  const { t, locale } = useT()
  const [open, setOpen] = useState(false)
  const r = harvest.recommended

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls="harvest-candidates"
        className="flex min-h-[44px] items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? t.production.marginalHideTable : t.production.marginalShowTable}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div id="harvest-candidates" className="animate-fade-in overflow-x-auto">
          <table className="w-full min-w-[420px] text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className="sticky left-0 bg-card py-1.5 pr-2 text-left font-medium">{t.production.harvestDate}</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">{t.production.avgWeight}</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">{t.production.sizeLadderColPrice}</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">{t.production.profitHeadline}</th>
              </tr>
            </thead>
            <tbody>
              {harvest.candidates.map(c => {
                const inWindow = r !== null && c.dayOffset >= r.startDayOffset && c.dayOffset <= r.endDayOffset
                return (
                  <tr key={c.dayOffset} className={`border-b border-border/50 ${inWindow ? "bg-ocean-500/10" : ""}`}>
                    <th scope="row" className={`sticky left-0 py-1.5 pr-2 text-left font-normal tabular-nums text-foreground ${inWindow ? "bg-ocean-500/10" : "bg-card"}`}>
                      {c.date !== null ? shortDate(c.date) : `${c.dayOffset}${t.engines.unit.day}`}
                    </th>
                    <td className="px-2 py-1.5 text-right tabular-nums text-foreground">{fmtG(c.abwG, locale, 1)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                      {c.priceKrwPerKg === null ? "—" : fmt(c.priceKrwPerKg, locale)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                      {c.operatingProfitKrw === null
                        ? (c.failure === null ? "—" : t.engines.candidateFailure[c.failure])
                        : fmtAmount(c.operatingProfitKrw, locale, t)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
