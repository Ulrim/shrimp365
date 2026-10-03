"use client"

// 요구 ④ — **생존율이 손익을 지배한다는 것.**
//
// 세로 순서가 중요하다. **문장이 차트보다 위다** — 수조 옆에서 폰으로 보는
// 농가가 필요한 것은 「지금 44.8% → 손익분기 74.0% · 29.2%p 부족」 한 줄이고,
// 차트는 그 한 줄을 뒷받침하는 그림이다. 순서를 뒤집으면 핵심이 스크롤 밖으로
// 밀린다.
//
// ── 못 세 개 ──────────────────────────────────────────────────────────────
//  1. **손익분기가 1 을 넘으면 그대로 112% 로 쓴다.** 100% 로 자르지 않는다 —
//     엔진이 1 을 안 자르는 이유가 「입식한 전부가 살아도 적자」라는 신호를
//     지우지 않으려는 것이다(sensitivity.ts 136~140행).
//  2. **고정 가정 4줄을 반드시 쓴다.** 엔진 주석이 못을 박았다: 금액만 보고
//     「생존율만 고치면 된다」로 읽지 않도록. 특히 평균 개체중은 큰 출하분과
//     소형 반출이 섞인 값이다.
//  3. **녹/적을 쓰지 않는다.** 흑자/적자를 색으로 가르지 않고 **0선과 음영**
//     으로 가른다(§10 color-guidance). 부족 구간은 amber 음영 + 바깥 텍스트.

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { useT } from "@/lib/i18n-context"
import type { BreakEvenFailure, SurvivalSensitivity as Sensitivity } from "@/lib/profitability"

import { fmt, fmtAmount, fmtAmountTick, fmtG, fmtPct, fmtPctPoint, signColorClass, signGlyph, tpl } from "./format"

const TOOLTIP_STYLE = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  color: "hsl(var(--foreground))",
} as const

const AXIS_TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 11 } as const

export type SurvivalSensitivityProps = {
  sensitivity: Sensitivity | null
  /** 못 돌린 이유. **「입식 마리수 없음」으로 뭉개지 않는다.** */
  failure?: BreakEvenFailure | null
  /** 차트 높이. 모바일 180 / 데스크톱 220(설계서 5절). */
  height?: number
}

export function SurvivalSensitivityPanel({ sensitivity, failure = null, height = 220 }: SurvivalSensitivityProps) {
  const { t, locale } = useT()

  if (sensitivity === null) {
    return (
      <section className="space-y-2">
        <h4 className="text-sm font-medium text-foreground">{t.production.sensitivityTitle}</h4>
        <p className="text-xs text-muted-foreground">{t.engines.breakEvenFailure[failure ?? "no_stocked_count"]}</p>
      </section>
    )
  }

  const { rows, referenceSurvivalRate, breakEven, assumptions } = sensitivity
  const breakEvenRate = breakEven.survivalRate
  const gap =
    referenceSurvivalRate !== null && breakEvenRate !== null ? breakEvenRate - referenceSurvivalRate : null

  // 차트용 배열만 따로 정렬한다. **엔진의 rows 를 정렬하지 않는다** — 엔진이
  // 호출자의 비교 순서를 지키려고 일부러 정렬하지 않는다(sensitivity.ts
  // 165~167행). 표는 엔진 순서를 그대로 쓴다.
  const chartRows = [...rows]
    .sort((a, b) => a.survivalRate - b.survivalRate)
    .map(r => ({
      survivalPct: r.survivalRate * 100,
      profitKrw: r.operatingProfitKrw,
      isReference: r.isReference,
    }))
  const referencePoints = chartRows.filter(r => r.isReference && r.profitKrw !== null)

  const refPct = referenceSurvivalRate === null ? null : referenceSurvivalRate * 100
  const bePct = breakEvenRate === null ? null : breakEvenRate * 100

  return (
    <section className="space-y-3">
      <h4 className="text-sm font-medium text-foreground">{t.production.sensitivityTitle}</h4>

      {/* ① 거리 한 줄 — 차트보다 위다. */}
      {breakEven.failure !== null ? (
        <p className="text-sm text-muted-foreground">{t.engines.breakEvenFailure[breakEven.failure]}</p>
      ) : (
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-base">
          <span className="tabular-nums text-foreground">
            {tpl(t.production.sensitivityDistanceTpl, fmtPct(referenceSurvivalRate, locale))}
          </span>
          <span className="text-muted-foreground" aria-hidden="true">→</span>
          <span className="tabular-nums text-foreground">
            {t.production.sensitivityBreakEven} {fmtPct(breakEvenRate, locale)}
          </span>
          {gap !== null && gap > 0 && (
            <span className="tabular-nums text-amber-700 dark:text-amber-400">
              {tpl(t.production.sensitivityGapTpl, fmtPctPoint(gap, locale))}
            </span>
          )}
        </p>
      )}
      {/* 1 을 넘으면 그 사실을 문장으로. 100% 로 자르지 않는다. */}
      {breakEvenRate !== null && breakEvenRate > 1 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{t.production.sensitivityBreakEvenAboveOne}</p>
      )}

      {/* ② 차트 */}
      {chartRows.length > 0 && (
        <div className="rounded-xl bg-muted p-2" role="img" aria-label={t.production.sensitivityChartAria}>
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart data={chartRows}>
              {/* 부족 구간 해칭 — **색만으로 구간을 말하지 않는다**(§10
                  pattern-texture). 평평한 amber 12% 는 다크모드에서 배경과
                  대비 1.3:1 로, 비텍스트 최소 3:1(WCAG 1.4.11)에 한참 못 미친다.
                  이 면적이 요구 ④ 의 핵심 그래픽(「메워야 하는 거리」)이라
                  안 보이면 그 요구가 통째로 사라진다. */}
              <defs>
                <pattern id="shortfall-hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                  <rect width="6" height="6" fill="#f59e0b" fillOpacity="0.14" />
                  {/* **색을 테마별로 가른다.** amber-500(#f59e0b)은 흰 배경에
                      불투명으로 깔아도 1.8:1 이라 3:1 을 넘을 수 없고,
                      amber-600 도 라이트에서 2.91:1 로 턱밑이었다(실측).
                      currentColor + 다크 분기로 양쪽 다 넘긴다. */}
                  <line
                    x1="0" y1="0" x2="0" y2="6"
                    stroke="currentColor"
                    className="text-amber-700 dark:text-amber-400"
                    strokeWidth="2"
                  />
                </pattern>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="survivalPct"
                type="number"
                domain={["dataMin", "dataMax"]}
                tick={AXIS_TICK}
                tickFormatter={(v: number) => `${v}%`}
              />
              <YAxis tick={AXIS_TICK} tickFormatter={(v: number) => fmtAmountTick(v, locale, t)} width={56} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v: unknown) => [fmtAmount(Number(v), locale, t), t.production.sensitivityColProfit]}
                labelFormatter={(v: unknown) => `${t.production.sensitivityColSurvival} ${String(v)}%`}
              />
              {/* 부족 구간 — 「메워야 하는 거리」가 면적으로 보인다. */}
              {refPct !== null && bePct !== null && bePct > refPct && (
                <ReferenceArea x1={refPct} x2={bePct} fill="url(#shortfall-hatch)" />
              )}
              {/* 0선 = 손익분기. 색이 아니라 선으로 가른다. */}
              <ReferenceLine y={0} stroke="hsl(var(--foreground))" strokeOpacity={0.4} strokeDasharray="4 4" />
              {bePct !== null && (
                <ReferenceLine x={bePct} stroke="#1d4ed8" strokeWidth={1.5} />
              )}
              {refPct !== null && (
                <ReferenceLine x={refPct} stroke="hsl(var(--foreground))" strokeOpacity={0.5} strokeDasharray="2 3" />
              )}
              <Line
                type="monotone"
                dataKey="profitKrw"
                stroke="#2563eb"
                strokeWidth={2}
                dot={{ r: 3, fill: "#2563eb" }}
                isAnimationActive={false}
                connectNulls
              />
              {/* 실측 한 점 강조 */}
              <Scatter data={referencePoints} dataKey="profitKrw" fill="#1d4ed8" isAnimationActive={false} shape="square" />
            </ComposedChart>
          </ResponsiveContainer>
          {/* 차트 밖 라벨 — 색·선만으로 구분하지 않는다. */}
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {refPct !== null && <span>{t.production.sensitivityActual} {fmtPct(referenceSurvivalRate, locale)}</span>}
            {bePct !== null && <span>{t.production.sensitivityBreakEven} {fmtPct(breakEvenRate, locale)}</span>}
            {refPct !== null && bePct !== null && bePct > refPct && (
              <span className="text-amber-700 dark:text-amber-400">
                {tpl(t.production.sensitivityGapTpl, fmtPctPoint(gap, locale))}
              </span>
            )}
          </p>
        </div>
      )}

      {/* ③ 고정 가정 4줄 — 엔진 주석이 요구한 것. */}
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <p className="text-xs font-medium text-foreground">{t.production.sensitivityHeldFixed}</p>
        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
          <Fixed label={t.production.sensitivityMeanWeight} value={fmtG(assumptions.meanHarvestWeightG, locale, 2)} />
          <Fixed
            label={t.production.sensitivityFeedHeldFixed}
            value={assumptions.feedKgHeldFixed === null ? "—" : `${fmt(assumptions.feedKgHeldFixed, locale, 1)}${t.engines.unit.kg}`}
          />
          <Fixed label={t.production.sensitivityCostHeldFixed} value={fmtAmount(assumptions.costHeldFixedKrw, locale, t)} />
          <Fixed
            label={t.production.sensitivityPriceHeldFixed}
            value={assumptions.priceKrwPerKg === null ? "—" : `${fmt(assumptions.priceKrwPerKg, locale)}${t.engines.unit.krw_per_kg}`}
          />
        </dl>
        {/* 평균 개체중이 섞인 값이라는 사실을 그 줄에 붙인다. */}
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {t.production.sensitivityMixedWeight}
        </p>
      </div>

      {/* ④ 행 표 — 실측 행만 다른 모양이다. 같으면 표 전체가 예측으로 읽힌다. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-xs">
          <caption className="sr-only">{t.production.sensitivityChartAria}</caption>
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th scope="col" className="sticky left-0 bg-card py-1.5 pr-2 text-left font-medium">
                {t.production.sensitivityColSurvival}
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">{t.production.sensitivityColRevenue}</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">{t.production.sensitivityColProfit}</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">{t.production.sensitivityColCostPerKg}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr
                key={r.survivalRate}
                className={`border-b border-border/50 ${r.isReference ? "bg-ocean-500/10" : ""}`}
              >
                <th scope="row" className={`sticky left-0 py-1.5 pr-2 text-left font-normal tabular-nums ${r.isReference ? "bg-ocean-500/10" : "bg-card"}`}>
                  {fmtPct(r.survivalRate, locale)}
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {r.isReference ? t.production.sensitivityActual : t.production.sensitivityAssumed}
                  </span>
                </th>
                <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                  {fmtAmount(r.revenueKrw, locale, t)}
                </td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${signColorClass(r.operatingProfitKrw)}`}>
                  <span aria-hidden="true">{signGlyph(r.operatingProfitKrw)}</span>
                  {fmtAmount(r.operatingProfitKrw, locale, t, { abs: true })}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                  {r.costPerKgKrw === null ? "—" : fmt(r.costPerKgKrw, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Fixed({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums text-foreground">{value}</dd>
    </>
  )
}
