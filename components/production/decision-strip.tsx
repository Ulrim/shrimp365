"use client"

// KPI 4카드와 Tabs 사이 **한 줄.** 모바일에서 농가가 제일 먼저 보는 것이다.
//
// 수조 옆에서 폰으로 볼 때 필요한 정보는 「지금 건질까, 2주 더?」 하나다.
// 그래서 추천 구간 + 이익 폭을 한 줄에 쓰고 전체가 출하 탭으로 가는 버튼이다.
//
// **window 가 null 이면 숨기지 않는다.** 「출하 구간 계산 불가 — 단가 근거
// 미선택」처럼 사유를 쓴다(§9 empty-nav-state: 목적지가 없으면 왜 없는지
// 설명한다). 숨기면 농가는 그 기능이 없는 줄 안다.

import { ChevronRight } from "lucide-react"

import { useT } from "@/lib/i18n-context"
import type { HarvestWindow } from "@/lib/harvest"

import { MIN_FIT_SAMPLES } from "./use-cycle-engines"
import type { EngineBlocker } from "./use-cycle-engines"
import { fmtAmount, shortDate, signColorClass, signGlyph, tpl } from "./format"

export type DecisionStripProps = {
  harvest: HarvestWindow | null
  /** 계산 불가 사유. harvest 가 null 일 때 첫 사유를 쓴다. */
  blockers: readonly EngineBlocker[]
  onJumpToHarvest: () => void
}

function blockerShort(b: EngineBlocker, t: ReturnType<typeof useT>["t"]): string {
  switch (b.kind) {
    case "no_price_basis":
      return t.engines.priceFailure.price_basis_not_selected
    case "no_temp_series":
      return t.production.growthNoTempSeries
    case "no_samples":
      return t.engines.fitFailure.no_samples
    case "samples_below_stanza":
      // 남은 수를 쓴다 — 2건 넣은 농가에게 「3건 필요」라고 하지 않는다.
      return tpl(t.production.growthNeedStanzaTpl, Math.max(0, MIN_FIT_SAMPLES - b.eligible))
    case "samples_below_min":
      return tpl(t.production.growthNeedSamplesTpl, b.need)
    case "fit_failure":
      return t.engines.fitFailure[b.failure]
    case "no_cost":
      return tpl(t.production.missingItemsTpl, b.missing.length)
    case "window_failure":
      return t.engines.windowFailure[b.failure]
  }
}

export function DecisionStrip({ harvest, blockers, onJumpToHarvest }: DecisionStripProps) {
  const { t, locale } = useT()

  const r = harvest?.recommended ?? null
  const best = harvest?.best ?? null
  // 「지금 출하」 대비 차액. 추천 구간 안의 대표 후보에서 읽는다.
  const delta =
    harvest === null || best === null
      ? null
      : harvest.candidates.find(c => c.dayOffset === best.dayOffset)?.profitDeltaFromNowKrw ?? null

  const rangeLabel =
    r === null
      ? null
      : r.startDate !== null && r.endDate !== null
        ? r.startDate === r.endDate
          ? shortDate(r.startDate)
          : `${shortDate(r.startDate)} ~ ${shortDate(r.endDate)}`
        : tpl(
            t.production.windowRangeDaysTpl,
            r.startDayOffset === r.endDayOffset ? `${r.startDayOffset}` : `${r.startDayOffset}~${r.endDayOffset}`,
          )

  // **window 가 null 일 때만 사유를 쓰면 안 된다.** 냉동 채널처럼
  // `window !== null` 인데 `failure` 가 찬 경로가 있고, 그때 recommended·
  // decision 이 둘 다 null 이라 스트립이 「계산 불가」만 쓰고 이유를 한 글자도
  // 안 쓴다 — 가진 정보를 조건 하나 때문에 버리는 것이다.
  const reason =
    harvest?.failure != null
      ? t.engines.windowFailure[harvest.failure]
      : harvest === null && blockers.length > 0
        ? blockerShort(blockers[0], t)
        : null

  const aria = [
    rangeLabel === null ? t.production.decisionWindowNone : tpl(t.production.decisionWindowTpl, rangeLabel),
    harvest?.decision == null ? "" : t.engines.decision[harvest.decision],
    delta === null ? "" : `${fmtAmount(delta, locale, t)}`,
    reason ?? "",
  ].filter(s => s !== "").join(". ")

  return (
    <button
      type="button"
      onClick={onJumpToHarvest}
      aria-label={aria}
      className="flex min-h-[44px] w-full flex-col items-start gap-1 border-b border-border bg-muted/40 px-4 py-2.5 text-left transition-colors hover:bg-muted sm:flex-row sm:items-center sm:gap-3"
    >
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium text-foreground">
          {rangeLabel === null ? t.production.decisionWindowNone : tpl(t.production.decisionWindowTpl, rangeLabel)}
        </span>
        {r !== null && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {tpl(t.production.windowSpanDaysTpl, r.endDayOffset - r.startDayOffset + 1)}
          </span>
        )}
        {reason !== null && <span className="text-xs text-amber-700 dark:text-amber-400">{reason}</span>}
        {harvest?.decision != null && (
          <span className="text-xs text-muted-foreground">{t.engines.decision[harvest.decision]}</span>
        )}
      </span>

      {delta !== null && delta !== 0 && (
        <span className={`shrink-0 text-sm tabular-nums ${signColorClass(delta)}`}>
          <span aria-hidden="true">{signGlyph(delta)}</span>
          {fmtAmount(delta, locale, t, { abs: true })}
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {delta >= 0 ? t.production.profitPositive : t.production.profitNegative}
          </span>
        </span>
      )}
      {/* 구간 안에서 구분되지 않는다는 사실은 폭 옆에 바로 쓴다. 단
          window_includes_now 판정은 이미 같은 말을 하므로 겹쳐 쓰지 않는다. */}
      {r !== null && r.indistinguishableWithinWindow && harvest?.decision !== "window_includes_now" && (
        <span className="shrink-0 text-[11px] text-muted-foreground">{t.production.windowIndistinguishable}</span>
      )}

      <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
    </button>
  )
}
