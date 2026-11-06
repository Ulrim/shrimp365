// 농업 차트 공통 스타일 상수 — 시안 mode-split-ui.md 5-6.
//
// 축·그리드·툴팁은 테마 토큰(hsl(var(--border)) 등)을 그대로 쓰고, 선 색은
// `AGRI_PARAMS[].color` 만 쓴다. 여기 있는 hex 리터럴은 레시피·기준 밴드용
// emerald-400(#34d399) 하나뿐이다(시안 1-1 의 예외 둘 중 하나).
//
// `big` 은 전광판 모드 — 벽걸이 모니터에서 몇 미터 떨어져 읽는다. 글자·선을
// 한 단계 키우고 눈금 간격도 벌린다.
import type { CSSProperties } from "react"

/** 레시피 목표선·허용 밴드·표준 기준 밴드 색(emerald-400). */
export const BAND_COLOR = "#34d399"

export const GRID_STROKE = "hsl(var(--border))"
export const TICK_FILL = "hsl(var(--muted-foreground))"

export interface ChartSizing {
  /** 축 눈금 글자. */
  tick: number
  /** 기준선 라벨 글자. */
  refLabel: number
  /** 범례 글자. */
  legend: number
  /** 툴팁 글자. */
  tooltip: number
  /** 데이터 선 굵기. */
  stroke: number
  /** 마우스 오버 점 반지름. */
  activeDot: number
  /** X 축 눈금 최소 간격(px). */
  minTickGap: number
  /** Y 축 폭(px). */
  yWidth: number
}

export const NORMAL_SIZING: ChartSizing = {
  tick: 11, refLabel: 11, legend: 12, tooltip: 12, stroke: 2, activeDot: 4, minTickGap: 100, yWidth: 44,
}

export const BIG_SIZING: ChartSizing = {
  tick: 16, refLabel: 14, legend: 14, tooltip: 16, stroke: 3, activeDot: 6, minTickGap: 140, yWidth: 64,
}

export const sizing = (big: boolean): ChartSizing => (big ? BIG_SIZING : NORMAL_SIZING)

export const tooltipContentStyle = (big: boolean): CSSProperties => ({
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 12,
  fontSize: sizing(big).tooltip,
})

export const tooltipLabelStyle: CSSProperties = { color: "hsl(var(--muted-foreground))" }
export const tooltipItemStyle: CSSProperties = { color: "hsl(var(--foreground))" }

/** 기본 차트 높이(px). 320px 폭에서는 220 으로 줄인다. */
export const CHART_HEIGHT = 260
export const CHART_HEIGHT_NARROW = 220

/** 차트 x 축 라벨. 하루를 넘는 구간이면 월/일을 붙인다 — 시:분만으로는
 *  어느 날인지 알 수 없어 라벨이 뭉개진다. */
export function timeLabel(d: Date, multiDay: boolean, locale: string): string {
  const hm = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
  return multiDay ? `${d.getMonth() + 1}/${d.getDate()} ${hm}` : hm
}

/** 첫·끝 시각이 24시간 넘게 벌어졌는가. */
export function spansMultipleDays(first: string | undefined, last: string | undefined): boolean {
  if (!first || !last) return false
  return new Date(last).getTime() - new Date(first).getTime() > 24 * 3_600_000
}
