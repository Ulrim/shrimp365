"use client"

// 요구 ① — **금액과 불확실성을 같은 무게로.**
//
// 기록된 −2,921만원은 비관 끝값이 아니다. 위로 아는 폭이 있고(재고 평가),
// 아래로는 **폭을 모르는 구간이 열려 있는**, 축 중간의 한 점이다. 이 한 문장이
// 설계의 전부이고, 그러면 그래픽이 결정된다(설계서 2-2·2-3).
//
// ── 하지 않은 것 ──────────────────────────────────────────────────────────
//  · 금액을 text-5xl 로 띄우지 않는다. 기존 KPI 카드와 같은 text-2xl 이다 —
//    **금액을 키워서 확신을 주지 않는다.**
//  · 경고를 아코디언에 접지 않는다. 접힌 것은 없는 것이다.
//  · "±30%" 같은 단일 오차율을 쓰지 않는다. **엔진에 그런 수가 없다.**
//  · recharts 를 쓰지 않는다. 열린 왼쪽 끝을 표현할 축이 recharts 에 없다.
//
// ── 왼쪽 열린 구간의 길이는 **아무 수도 뜻하지 않는다** ────────────────────
// 축의 왼쪽 38% 를 열린 구간에 고정으로 주고 왼쪽으로 페이드시킨다. 길이를
// 금액에 비례시키려면 그 금액을 알아야 하는데 **모른다** — 엔진이 추정을
// 거부한 자리다(전기는 월별 3배 계절성, 감가는 모델에 없음). 길이가 수를
// 주장하면 폭을 그린 목적이 뒤집힌다. 그래서 길이는 고정이고, 페이드가
// 「여기서 끝나지 않는다」를 말한다.
//
// 오른쪽 62% 만 **실제 수치 축**이다 — 기록된 값에서 max(아는 폭 끝, 0) 까지.

import { useState } from "react"
import { ChevronDown } from "lucide-react"

import { useT } from "@/lib/i18n-context"
import type { ActualPerformance, CostItem } from "@/lib/profitability"

import { ExclusionChip, groupExclusions } from "./exclusion-chip"
import type { AnyExclusion, ExclusionGroup } from "./exclusion-chip"
import { fmtAmount, signColorClass, signGlyph, tpl } from "./format"

/** 열린 구간이 차지하는 폭. **수치가 아니라 레이아웃 상수다.** */
const OPEN_PCT = 38

export type ProfitHeadlineProps = {
  /** 호출 ① 기록대로. */
  recorded: ActualPerformance
  /** 호출 ② 아는 폭 반영. 단가 미선택이면 null — **0 폭으로 그리지 않는다.** */
  withKnownGap: ActualPerformance | null
  /** 세 엔진에서 합쳐 올라온 전체. */
  exclusions: readonly AnyExclusion[]
  /** NewCostDialog 를 category 로 미리 채워 연다. **새 모달을 만들지 않는다.** */
  onFixCost?: (item: CostItem) => void
}

export function ProfitHeadline({ recorded, withKnownGap, exclusions, onFixCost }: ProfitHeadlineProps) {
  const { t, locale } = useT()

  const point = recorded.operatingProfitKrw
  const knownHigh = withKnownGap?.operatingProfitKrw ?? null
  const groups = groupExclusions(exclusions)
  const openLow = groups.unquantified.length > 0

  // 오른쪽 수치 축의 범위. 0 이 점 오른쪽에 있으면 0 까지 보여 준다 — 「적자가
  // 흑자에서 얼마나 떨어져 있나」가 폭의 뜻이기 때문이다.
  const axisRight = point === null ? null : Math.max(knownHigh ?? point, 0, point)
  const axisSpan = point === null || axisRight === null ? 0 : axisRight - point
  const toPct = (v: number): number =>
    point === null || axisSpan <= 0 ? 0 : OPEN_PCT + ((v - point) / axisSpan) * (100 - OPEN_PCT)

  const knownPct = knownHigh === null ? 0 : Math.max(0, toPct(knownHigh) - OPEN_PCT)
  const zeroPct = point !== null && axisRight !== null && axisSpan > 0 && point < 0 && axisRight >= 0 ? toPct(0) : null

  const aria = [
    t.production.profitBandAria,
    `${t.production.profitRecorded} ${fmtAmount(point, locale, t)}`,
    knownHigh === null ? t.production.priceBasisNone : `${t.production.profitWithKnownGap} ${fmtAmount(knownHigh, locale, t)}`,
    openLow ? t.production.profitOpenLow : "",
  ].filter(s => s !== "").join(". ")

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-sm font-medium text-foreground">{t.production.profitHeadline}</h4>
        <p className="text-[11px] text-muted-foreground">{t.engines.bandNotCi}</p>
      </div>

      {/* 기록된 값 — text-2xl. 색만으로 부호를 말하지 않는다(▲/▼ + 텍스트). */}
      <p className="flex flex-wrap items-baseline gap-x-2" aria-live="polite">
        <span className={`text-2xl font-bold tabular-nums leading-tight ${signColorClass(point)}`}>
          <span aria-hidden="true">{signGlyph(point)}</span>
          {fmtAmount(point, locale, t, { abs: true })}
        </span>
        <span className="text-xs text-muted-foreground">
          {point === null ? "" : point >= 0 ? t.production.profitPositive : t.production.profitNegative}
          {" · "}
          {t.production.profitRecorded}
        </span>
      </p>

      {/* ── 축 ─────────────────────────────────────────────────────────── */}
      {point === null ? (
        <p className="text-xs text-muted-foreground">{t.production.priceBasisNone}</p>
      ) : (
        <>
          <div className="relative h-14" role="img" aria-label={aria}>
            {/* 왼쪽 열린 구간. 길이는 레이아웃 상수이고 수를 뜻하지 않는다. */}
            {openLow && (
              <div
                className="absolute inset-y-0 left-0 border-y border-dashed border-border bg-[repeating-linear-gradient(135deg,transparent_0_5px,hsl(var(--muted-foreground)/0.14)_5px_7px)] [mask-image:linear-gradient(to_right,transparent,black_60%)]"
                style={{ width: `${OPEN_PCT}%` }}
              />
            )}
            {/* 아는 폭 — 채워진 띠. 단가 미선택이면 아예 그리지 않는다. */}
            {knownHigh !== null && knownPct > 0 && (
              <div
                className="absolute inset-y-4 rounded-sm bg-ocean-200 dark:bg-ocean-900"
                style={{ left: `${OPEN_PCT}%`, width: `${knownPct}%` }}
              />
            )}
            {/* 손익 0 선. 점 오른쪽에 있을 때만 보인다. */}
            {zeroPct !== null && (
              <div className="absolute inset-y-0 border-l border-dashed border-foreground/40" style={{ left: `${zeroPct}%` }}>
                {/* 0선이 오른쪽 끝에 붙으면 라벨이 축 밖으로 잘린다. 85% 를
                    넘으면 선 왼쪽에 쓴다. */}
                <span
                  className={`absolute -top-0.5 whitespace-nowrap text-[10px] text-muted-foreground ${
                    zeroPct > 85 ? "right-1" : "left-1"
                  }`}
                >
                  {`0${t.engines.unit.krw}`}
                </span>
              </div>
            )}
            {/* 기록된 점 */}
            <span
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-base leading-none text-foreground"
              style={{ left: `${OPEN_PCT}%` }}
              aria-hidden="true"
            >
              ●
            </span>
            {/* 아는 폭의 끝 */}
            {knownHigh !== null && knownPct > 0 && (
              <span
                className="absolute bottom-0 -translate-x-1/2 whitespace-nowrap text-[10px] tabular-nums text-ocean-700 dark:text-ocean-300"
                style={{ left: `${OPEN_PCT + knownPct}%` }}
              >
                <span aria-hidden="true">▲</span> {fmtAmount(knownHigh, locale, t)}
              </span>
            )}
            {/* 열린 쪽 라벨 */}
            {openLow && (
              <span className="absolute left-0 top-0 text-[10px] text-muted-foreground">
                ◀ {t.production.profitOpenLow}
              </span>
            )}
          </div>

          {knownHigh === null && (
            <p className="text-xs text-muted-foreground">{t.production.priceBasisNone}</p>
          )}
        </>
      )}

      {/* ── 경고 3줄. 어떤 상태에서도 접히지 않는다 ───────────────────── */}
      <UncertaintyList
        groups={groups}
        knownGapKrw={point !== null && knownHigh !== null ? knownHigh - point : null}
        onFixCost={onFixCost}
      />
    </section>
  )
}

// ── UncertaintyList — 경고를 3줄로, 접지 않고 ─────────────────────────────
// 줄마다 **그룹명 · 건수 · 항목 요약 · 금액(또는 「폭 미상」)** 이 전부 상시
// 노출된다. `[자세히]` 가 펼치는 것은 **건별 설명과 조치 경로**뿐이다.

const GROUP_ORDER: readonly Exclude<ExclusionGroup, never>[] = [
  "quantified",
  "unquantified",
  "denominator",
  "other",
]

function UncertaintyList({
  groups,
  knownGapKrw,
  onFixCost,
}: {
  groups: Record<ExclusionGroup, AnyExclusion[]>
  knownGapKrw: number | null
  onFixCost?: (item: CostItem) => void
}) {
  const { t, locale } = useT()
  const [open, setOpen] = useState<ExclusionGroup | null>(null)

  const rows = GROUP_ORDER.filter(g => groups[g].length > 0)
  if (rows.length === 0) return null

  return (
    <div className="space-y-1.5">
      {rows.map(g => {
        const items = groups[g]
        const expanded = open === g
        const id = `uncertainty-${g}`
        // 금액은 quantified 그룹만 있다. 나머지는 「폭 미상」이고 **0 이 아니다.**
        const amount =
          g === "quantified"
            ? knownGapKrw === null
              ? t.production.priceBasisNone
              : `+${fmtAmount(knownGapKrw, locale, t, { abs: true })}`
            : g === "unquantified"
              ? t.production.widthUnknown
              : ""
        const label = g === "other" ? t.engines.source.pricing : t.engines.group[g]
        const hint = g === "other" ? "" : t.engines.groupHint[g]

        return (
          <div key={g} className="rounded-lg border border-border bg-muted/40">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2">
              <span className="text-xs font-medium text-foreground">{label}</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {items.length}{t.engines.unit.count}
              </span>
              {hint !== "" && <span className="text-[11px] text-muted-foreground">{hint}</span>}
              <span className="ml-auto shrink-0 text-xs tabular-nums text-foreground">{amount}</span>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : g)}
                aria-expanded={expanded}
                aria-controls={id}
                className="flex min-h-[44px] shrink-0 items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {expanded ? t.production.detailsClose : t.production.detailsOpen}
                <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
            </div>
            {/* 항목 요약은 **접히지 않는다.** 이름만 한 줄로 늘 보인다. */}
            <p className="px-3 pb-2 text-[11px] leading-relaxed text-muted-foreground">
              {items.map(e => summaryName(e, t)).join(" · ")}
            </p>
            {expanded && (
              <div id={id} className="animate-fade-in space-y-1.5 border-t border-border p-2">
                {items.map(e => (
                  <ExclusionChip
                    key={`${e.code}|${e.item ?? ""}`}
                    exclusion={e}
                    variant="row"
                    action={
                      e.code === "cost_not_recorded" && e.item !== undefined && onFixCost !== undefined
                        ? {
                            label: tpl(t.production.fixCostTpl, t.production.costCategories[e.item]),
                            onClick: () => onFixCost(e.item as CostItem),
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** 요약줄의 항목 이름. 비용 미입력은 어느 항목인지까지 쓴다. */
function summaryName(e: AnyExclusion, t: ReturnType<typeof useT>["t"]): string {
  const dict = t.engines.exclusion as unknown as Record<string, string | undefined>
  const base = dict[e.code] ?? e.code
  if (e.code === "cost_not_recorded" && e.item !== undefined) {
    return `${t.production.costCategories[e.item]}`
  }
  return base
}

