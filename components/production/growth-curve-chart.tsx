"use client"

// 엔진 1 — 생육 성장곡선.
//
// ── 세 가지 못. 어기면 엔진 설계가 무효가 된다 ────────────────────────────
//  1. **리본을 「신뢰구간」이라고 쓰지 않는다.** 엔진 1 은 예측구간을 돌려주지
//     않는다 — trainMaeG 와 홀드아웃 MAE 뿐이고, **R² 함수를 의도적으로
//     내보내지 않았다**(lib/growth/index.ts 설계 규칙 5). 리본은 ±MAE 이고
//     라벨도 그렇게 쓴다. i18n 키 이름까지 growthBandMae 로 박혀 있다.
//  2. **제외된 점을 숨기지 않는다.** fit.excluded 에 7.5 g 미만으로 빠진 점이
//     들어 있다. 농가가 입력한 샘플이 차트에서 사라지면 「내가 넣은 게 어디
//     갔나」가 된다. 중공 원으로 그리고 왜 빠졌는지 범례에 적는다.
//  3. **x축이 날짜면 예측선을 못 그릴 때가 있다.** 엔진 1 의 시간축은
//     적산수온이고, 엔진 1 은 적산수온을 날짜로 바꾸지 않는다(설계 규칙 4).
//     예측 구간을 날짜축에 올리려면 **미래 수온 전망**이 필요하다. 없으면
//     예측선을 날짜축에 그리지 않고, 그 사실을 한 줄 적는다.
//
// 전망 수온이 있어도 그것은 **예보가 아니라 관측 마지막 구간의 평균**이다.
// 그 사실은 엔진 3 이 harvest_water_temp_outlook_assumed 로 알린다.

import { useMemo, useState } from "react"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { useT } from "@/lib/i18n-context"
import { predictAbw } from "@/lib/growth"
import type { DegreeDayAxis, GompertzFit, GrowthPoint } from "@/lib/growth"

import { fmt, fmtG, shortDate, tpl } from "./format"

const TOOLTIP_STYLE = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  color: "hsl(var(--foreground))",
} as const
const AXIS_TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 11 } as const

export type GrowthAxis = "date" | "cdd"

export type GrowthCurveChartProps = {
  fit: GompertzFit | null
  cddAxis: DegreeDayAxis | null
  growthPoints: readonly GrowthPoint[]
  /** growthPoints 와 평행한 날짜 배열. */
  growthPointDates: readonly string[]
  /** 지금까지의 적산수온. */
  cddNow: number | null
  /** 전망에 쓸 수온(℃). **null 이면 날짜축에 예측선을 그리지 않는다.** */
  outlookWaterTempC: number | null
  /** 앞으로 며칠을 그릴까. */
  horizonDays: number
  /** 사이클의 목표 중량(g). 있으면 기준선으로. */
  targetWeightG?: number | null
  height?: number
}

type Row = {
  x: number
  dateKey: string
  cdd: number
  fitted?: number
  forecast?: number
  bandLow?: number
  bandSpan?: number
}

const DAY_MS = 86_400_000

function addDaysKey(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10)
}

export function GrowthCurveChart({
  fit,
  cddAxis,
  growthPoints,
  growthPointDates,
  cddNow,
  outlookWaterTempC,
  horizonDays,
  targetWeightG,
  height = 220,
}: GrowthCurveChartProps) {
  const { t, locale } = useT()
  const [axis, setAxis] = useState<GrowthAxis>("date")

  // 날짜축에 예측선을 올릴 수 있는가. 수온 전망이 없으면 못 한다.
  const canForecastOnDate = outlookWaterTempC !== null
  const effectiveAxis: GrowthAxis = axis
  const params = fit?.params ?? null
  const maeG = fit?.trainMaeG ?? null

  const excludedIndices = useMemo(
    () => new Set((fit?.excluded ?? []).map(e => e.index)),
    [fit],
  )

  // 적합에 실제로 쓰인 점의 최소 적산수온. 그 아래는 곡선이 **외삽**이므로
  // 적합 구간으로 그리지 않는다.
  const fitMinCdd = useMemo(() => {
    let min: number | null = null
    growthPoints.forEach((p, i) => {
      if (excludedIndices.has(i)) return
      if (min === null || p.cdd < min) min = p.cdd
    })
    return min
  }, [growthPoints, excludedIndices])

  const xOf = (dateKey: string, cdd: number): number =>
    effectiveAxis === "cdd" ? cdd : new Date(`${dateKey}T00:00:00Z`).getTime()

  // ── 곡선 ────────────────────────────────────────────────────────────────
  const rows = useMemo<Row[]>(() => {
    if (params === null || cddAxis === null || cddNow === null) return []
    const out: Row[] = []

    // 적합 구간 — 관측된 날짜마다 한 점. 날짜와 적산수온을 **둘 다** 들고 있다.
    for (const p of cddAxis.points) {
      if (fitMinCdd !== null && p.cdd < fitMinCdd) continue
      const v = predictAbw(params, p.cdd)
      if (!Number.isFinite(v)) continue
      const row: Row = { x: xOf(p.date, p.cdd), dateKey: p.date, cdd: p.cdd, fitted: v }
      if (maeG !== null && maeG > 0) {
        row.bandLow = Math.max(0, v - maeG)
        row.bandSpan = Math.min(v + maeG, params.winfG) - row.bandLow
      }
      out.push(row)
    }

    // 예측 구간 — 날짜축이면 수온 전망이 있어야 한다.
    const lastDate = cddAxis.points.length > 0 ? cddAxis.points[cddAxis.points.length - 1].date : null
    const canDraw = effectiveAxis === "cdd" ? outlookWaterTempC !== null : canForecastOnDate && lastDate !== null
    if (canDraw && outlookWaterTempC !== null && lastDate !== null) {
      // 이어지게 하려고 마지막 적합 점에 forecast 값을 같이 넣는다.
      const tail = out[out.length - 1]
      if (tail !== undefined) tail.forecast = tail.fitted
      for (let d = 1; d <= horizonDays; d++) {
        const cdd = cddNow + d * outlookWaterTempC
        const v = predictAbw(params, cdd)
        if (!Number.isFinite(v)) continue
        const key = addDaysKey(lastDate, d)
        const row: Row = { x: xOf(key, cdd), dateKey: key, cdd, forecast: v }
        if (maeG !== null && maeG > 0) {
          row.bandLow = Math.max(0, v - maeG)
          row.bandSpan = Math.min(v + maeG, params.winfG) - row.bandLow
        }
        out.push(row)
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, cddAxis, cddNow, fitMinCdd, maeG, effectiveAxis, outlookWaterTempC, horizonDays, canForecastOnDate])

  // ── 실측 점 ─────────────────────────────────────────────────────────────
  const observed = useMemo(
    () =>
      growthPoints
        .map((p, i) => ({ p, i }))
        .filter(({ i }) => !excludedIndices.has(i))
        .map(({ p, i }) => ({ x: xOf(growthPointDates[i] ?? "", p.cdd), abwG: p.abwG })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [growthPoints, growthPointDates, excludedIndices, effectiveAxis],
  )

  // 제외된 점 — **숨기지 않는다.** 중공 원으로 그린다.
  const excluded = useMemo(
    () =>
      (fit?.excluded ?? []).map(e => ({
        x: xOf(growthPointDates[e.index] ?? "", e.cdd),
        abwG: e.abwG,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fit, growthPointDates, effectiveAxis],
  )

  const tickFormat = (v: number): string =>
    effectiveAxis === "cdd" ? fmt(v, locale) : shortDate(new Date(v).toISOString().slice(0, 10))

  const aria = [
    t.production.abwChartAria,
    maeG === null ? "" : tpl(t.production.growthBandMae, maeG.toFixed(2)),
    excluded.length > 0 ? tpl(t.production.growthExcludedLegendTpl, excluded.length) : "",
  ].filter(s => s !== "").join(". ")

  const hasData = observed.length > 0 || rows.length > 0

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-foreground">{t.production.abwGrowthCurve}</h4>
        {/* 축 토글. aria-pressed 로 상태를 알린다. */}
        <div className="flex gap-1" role="group" aria-label={`${t.production.growthAxisDate} / ${t.production.growthAxisCdd}`}>
          {(["date", "cdd"] as const).map(a => (
            <button
              key={a}
              type="button"
              aria-pressed={axis === a}
              disabled={a === "cdd" && cddAxis === null}
              onClick={() => setAxis(a)}
              className={`min-h-[44px] rounded-lg border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                axis === a ? "border-ocean-500 bg-ocean-500/10 text-foreground" : "border-border bg-muted text-muted-foreground"
              }`}
            >
              {a === "date" ? t.production.growthAxisDate : t.production.growthAxisCdd}
            </button>
          ))}
        </div>
      </div>

      {hasData ? (
        <div className="rounded-xl bg-muted p-2" role="img" aria-label={aria}>
          <ResponsiveContainer width="100%" height={height}>
            <ComposedChart>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="x"
                type="number"
                domain={["dataMin", "dataMax"]}
                allowDuplicatedCategory={false}
                tick={AXIS_TICK}
                tickFormatter={tickFormat}
                minTickGap={32}
              />
              <YAxis tick={AXIS_TICK} tickFormatter={(v: number) => fmt(v, locale, 1)} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v: unknown) => fmtG(Number(v), locale, 2)}
                labelFormatter={(v: unknown) => tickFormat(Number(v))}
              />
              {/* ±MAE 리본. **「신뢰구간」이 아니다.** 투명 Area 를 깔고 폭을 쌓는
                  표준 처방 — dataKey 에 배열을 주는 방식이 이 버전에서 불안정하다. */}
              <Area data={rows} dataKey="bandLow" stackId="band" stroke="none" fill="none" isAnimationActive={false} legendType="none" />
              <Area data={rows} dataKey="bandSpan" stackId="band" stroke="none" fill="#3b82f6" fillOpacity={0.1} isAnimationActive={false} legendType="none" />
              {targetWeightG != null && Number.isFinite(targetWeightG) && (
                <ReferenceLine y={targetWeightG} stroke="hsl(var(--border))" strokeDasharray="4 4" />
              )}
              <Line data={rows} dataKey="fitted" type="monotone" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              {/* 점선이 「예측」을 색 없이 말한다. */}
              <Line data={rows} dataKey="forecast" type="monotone" stroke="#60a5fa" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls />
              <Scatter data={observed} dataKey="abwG" fill="#2563eb" isAnimationActive={false} />
              <Scatter data={excluded} dataKey="abwG" fill="transparent" stroke="hsl(var(--muted-foreground))" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {/* 범례·주석 — 차트 밖. 색만으로 계열을 구분하지 않는다. */}
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-ocean-600" aria-hidden="true" />
          {t.production.growthObserved}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-ocean-600" aria-hidden="true" />
          {t.production.growthFitted}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-ocean-400" aria-hidden="true" />
          {t.production.growthForecast}
        </li>
        {excluded.length > 0 && (
          <li className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full border border-muted-foreground" aria-hidden="true" />
            {tpl(t.production.growthExcludedLegendTpl, excluded.length)}
          </li>
        )}
        {targetWeightG != null && Number.isFinite(targetWeightG) && (
          <li>{t.production.growthTargetWeight} {fmtG(targetWeightG, locale)}</li>
        )}
      </ul>

      {/* ±MAE 라벨 — **MAE 라고 쓴다.** */}
      {maeG !== null && (
        <p className="text-[11px] text-muted-foreground">{tpl(t.production.growthBandMae, maeG.toFixed(2))}</p>
      )}
      {/* 수온 전망이 없어 날짜축에 예측선을 못 그린 경우. */}
      {axis === "date" && !canForecastOnDate && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">{t.production.growthForecastNeedsTemp}</p>
      )}
      {cddAxis !== null && cddAxis.filledDays > 0 && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          {tpl(t.production.growthFilledDaysTpl, cddAxis.filledDays)}
        </p>
      )}
    </section>
  )
}
