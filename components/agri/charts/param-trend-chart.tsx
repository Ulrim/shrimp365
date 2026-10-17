"use client"

// 단일 항목 추세 차트 — 양액 관리 6탭이 전부 이 하나로 그린다(시안 5-6).
//
// y 값은 호출부가 `agriScaled` 로 환산해 넘긴다(EC 는 mS/cm). 레시피·기준 밴드도
// 같은 단위로 받는다. 기준선 규칙:
//   레시피 있음(EC·pH)      → 밴드 + 목표선(라벨) + 상·하한 점선 2줄. 2×tol 은 그리지 않는다.
//   레시피 없음 + 표준 있음 → 표준 밴드 + 상·하한 점선(한쪽이 null 이면 그 선만). 목표선 없음.
//   둘 다 없음(EC·유량·차압) → 선 0개. 전역 EC 기준선은 긋지 않는다.
import Link from "next/link"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine,
} from "recharts"
import type { AgriParam, AgriParamKey } from "@/lib/agri-params"
import { agriScaled } from "@/lib/agri-params"
import type { AgriStandard } from "@/lib/agri-standards"
import type { WaterQualityReading } from "@/types"
import {
  BAND_COLOR, GRID_STROKE, TICK_FILL, CHART_HEIGHT, sizing,
  tooltipContentStyle, tooltipLabelStyle, tooltipItemStyle, timeLabel, spansMultipleDays,
} from "./chart-theme"

export interface TrendPoint {
  time: string
  value: number | null
}

/** 측정 목록 → 한 항목의 차트 점. 미측정은 null 로 두어 선이 끊기게 한다(0 으로 처지지 않게). */
export function buildTrendData(readings: WaterQualityReading[], key: AgriParamKey, locale: string): TrendPoint[] {
  const multiDay = spansMultipleDays(readings[0]?.recorded_at, readings[readings.length - 1]?.recorded_at)
  return readings.map(r => ({
    time: timeLabel(new Date(r.recorded_at), multiDay, locale),
    value: agriScaled(key, r[key] as number | null | undefined),
  }))
}

/** 화면 단위로 환산된 레시피 목표·허용 오차. */
export interface TrendRecipe {
  target: number
  tol: number
}

interface ParamTrendChartProps {
  data: TrendPoint[]
  param: AgriParam
  /** 항목 이름(사전). 툴팁 이름으로 쓴다. */
  label: string
  recipe?: TrendRecipe | null
  /** 레시피가 없을 때 그릴 표준 밴드(pH·온도·DO). EC·유량·차압은 넘기지 않는다. */
  standard?: AgriStandard | null
  /** 목표선 라벨("목표 1.80"). recipe 와 함께 넘긴다. */
  targetLabel?: string
  /** 전체화면 — 부모 높이를 채운다. */
  fill?: boolean
  /** 전광판 — 글자·선을 키운다. */
  big?: boolean
  height?: number
}

export function ParamTrendChart({
  data, param, label, recipe = null, standard = null, targetLabel, fill = false, big = false, height = CHART_HEIGHT,
}: ParamTrendChartProps) {
  const s = sizing(big)
  const yVals = data.map(d => d.value).filter((v): v is number => v != null && Number.isFinite(v))
  const unitSuffix = param.unit ? ` ${param.unit}` : ""

  // Y 도메인은 그리는 기준선만 따라간다. 안 그리는 선까지 넣으면 축이 늘어나
  // 실제 변동이 평평하게 뭉개진다.
  let yDomain: [number | string, number | string] = ["auto", "auto"]
  if (recipe) {
    const pad = recipe.tol * 2.5
    yDomain = [Math.min(recipe.target - pad, ...yVals), Math.max(recipe.target + pad, ...yVals)]
  } else if (standard) {
    const bounds = [standard.min, standard.max].filter((v): v is number => v != null)
    if (bounds.length) {
      const lo = Math.min(...bounds, ...yVals)
      const hi = Math.max(...bounds, ...yVals)
      const pad = (hi - lo) * 0.1 || 1
      yDomain = [lo - pad, hi + pad]
    }
  }

  const refLabel = (value: string) => ({ value, fill: BAND_COLOR, fontSize: s.refLabel, position: "insideTopRight" as const })

  return (
    <ResponsiveContainer width="100%" height={fill ? "100%" : height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
        <XAxis dataKey="time" tick={{ fill: TICK_FILL, fontSize: s.tick }} tickLine={false} axisLine={false}
          interval="preserveStartEnd" minTickGap={s.minTickGap} />
        <YAxis domain={yDomain} tick={{ fill: TICK_FILL, fontSize: s.tick }} tickLine={false} axisLine={false}
          width={s.yWidth} tickFormatter={(v: number) => Number(v).toFixed(param.digits)} />
        <Tooltip
          contentStyle={tooltipContentStyle(big)} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle}
          formatter={(v) => [`${Number(v).toFixed(param.digits)}${unitSuffix}`, label]}
        />

        {/* 레시피 — 밴드 + 목표선 + 상·하한 점선 */}
        {recipe && <ReferenceArea y1={recipe.target - recipe.tol} y2={recipe.target + recipe.tol}
          fill={BAND_COLOR} fillOpacity={0.08} stroke="none" ifOverflow="extendDomain" />}
        {recipe && <ReferenceLine y={recipe.target} stroke={BAND_COLOR} strokeDasharray="6 3" strokeOpacity={0.9}
          label={targetLabel ? refLabel(targetLabel) : undefined} />}
        {recipe && <ReferenceLine y={recipe.target + recipe.tol} stroke={BAND_COLOR} strokeDasharray="4 4" strokeOpacity={0.5} />}
        {recipe && <ReferenceLine y={recipe.target - recipe.tol} stroke={BAND_COLOR} strokeDasharray="4 4" strokeOpacity={0.5} />}

        {/* 표준 밴드(레시피 없을 때) — 같은 emerald 문법, 목표선 없음 */}
        {!recipe && standard && standard.min != null && standard.max != null && (
          <ReferenceArea y1={standard.min} y2={standard.max} fill={BAND_COLOR} fillOpacity={0.08} stroke="none" ifOverflow="extendDomain" />
        )}
        {!recipe && standard && standard.max != null && (
          <ReferenceLine y={standard.max} stroke={BAND_COLOR} strokeDasharray="4 4" strokeOpacity={0.5} />
        )}
        {!recipe && standard && standard.min != null && (
          <ReferenceLine y={standard.min} stroke={BAND_COLOR} strokeDasharray="4 4" strokeOpacity={0.5} />
        )}

        <Line type="monotone" dataKey="value" name={label} stroke={param.color} strokeWidth={s.stroke}
          dot={false} connectNulls activeDot={{ r: s.activeDot }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

interface TrendEmptyProps {
  param: AgriParam
  title: string
  ctaLabel?: string
  ctaHref?: string
  fill?: boolean
  height?: number
}

/** 해당 기간 데이터 0 — 차트 높이를 그대로 지켜 레이아웃이 튀지 않게 한다. */
export function TrendEmpty({ param, title, ctaLabel, ctaHref, fill = false, height = CHART_HEIGHT }: TrendEmptyProps) {
  const Icon = param.icon
  return (
    <div role="status" className={fill ? "h-full flex flex-col items-center justify-center gap-2" : "flex flex-col items-center justify-center gap-2"}
      style={fill ? undefined : { height }}>
      <Icon className="w-8 h-8 text-muted-foreground/30" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{title}</p>
      {ctaLabel && ctaHref && (
        <Link href={ctaHref} className="text-xs font-medium text-brand-fg hover:underline min-h-[44px] inline-flex items-center px-2">
          {ctaLabel}
        </Link>
      )}
    </div>
  )
}
