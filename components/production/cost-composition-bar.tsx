"use client"

// 비용 구성. **파이를 쓰지 않는다.**
//
// 항목이 6개라 §10 `no-pie-overuse` 경계이기도 하지만, 더 중요한 이유는
// **파이에는 「미입력」을 그릴 자리가 없다**는 것이다. 조각 합이 100% 가 되는
// 그래픽에서 미입력은 사라지고, 사라지면 `knownTotalKrw` 가 `totalKrw` 로
// 읽힌다 — 엔진 2 가 합계 필드 이름을 그렇게 지은 이유가 통째로 무의미해진다.
//
// 그래서 가로 100% 적층 막대 + **오른쪽 끝을 점선으로 열어 둔다.**
// 미입력 구간의 폭은 `flex-1` 이고 금액에 비례하지 않는다 — 비례시키려면 그
// 금액을 알아야 하는데 모른다. **막대가 닫혔다는 것이 「전부 입력됐다」는
// 신호**가 된다.

import { useT } from "@/lib/i18n-context"
import type { CostBreakdown, CostItem } from "@/lib/profitability"

import { costColor } from "./cost-meta"
import { fmtAmount, fmtPct, tpl } from "./format"

export type CostCompositionBarProps = {
  cost: CostBreakdown
  /** 미입력 항목을 그 자리에서 입력하게 한다. 기존 NewCostDialog 를 연다. */
  onFixCost?: (item: CostItem) => void
}

export function CostCompositionBar({ cost, onFixCost }: CostCompositionBarProps) {
  const { t, locale } = useT()
  const total = cost.knownTotalKrw
  // 막대 세그먼트는 폭이 있어야 그려지므로 0원은 뺀다.
  const lines = cost.lines.filter(l => l.krw > 0)
  // **범례는 다르다.** 「약품비 0원」을 실제로 입력한 농가의 그 사실이 범례에서
  // 사라지면, 0 과 미입력을 가르자는 이 파일의 취지와 정반대가 된다.
  // cost.lines 는 **입력된 항목만** 들어 있으므로(cost.ts), 0원 행이 있다는
  // 것은 농가가 0 을 넣었다는 뜻이다.
  // **한 항목도 입력되지 않았으면 「0원」을 쓰지 않는다.** knownTotalKrw 는
  // 그때도 수 0 이지만, 그것은 「비용이 0원이다」가 아니라 「더한 것이
  // 없다」는 뜻이다. 둘을 같은 글자로 쓰면 엔진 2 가 합계 필드를 totalKrw 가
  // 아니라 knownTotalKrw 로 지은 이유가 화면에서 지워진다.
  const nothingEntered = cost.lines.length === 0

  const aria = [
    t.production.costBarAria,
    ...lines.map(l => `${t.production.costCategories[l.item]} ${fmtAmount(l.krw, locale, t)} ${total > 0 ? fmtPct(l.krw / total, locale, 0) : ""}`),
    cost.complete ? t.production.costBarClosed : t.production.costBarOpenEnd,
  ].join(". ")

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {/* complete 가 false 면 「총비용」이라고 쓰지 않는다. */}
        <h4 className="text-sm font-medium text-foreground">
          {cost.complete ? t.production.totalCostSimple : t.production.knownTotalLabel}
        </h4>
        <p className="text-sm font-medium tabular-nums text-foreground">
          {nothingEntered ? "—" : fmtAmount(total, locale, t)}
        </p>
      </div>

      {total > 0 ? (
        <div className="flex h-6 w-full items-stretch overflow-hidden rounded-md" role="img" aria-label={aria}>
          {lines.map(l => (
            <div
              key={l.item}
              className={`${costColor(l.item)} min-w-[2px]`}
              style={{ width: `${(l.krw / total) * 100}%` }}
              title={`${t.production.costCategories[l.item]} ${fmtAmount(l.krw, locale, t)}`}
            />
          ))}
          {/* 열린 끝 — 폭이 금액을 주장하지 않는다. */}
          {!cost.complete && (
            <div className="flex min-w-[48px] flex-1 items-center justify-end border-y border-r border-dashed border-border bg-[repeating-linear-gradient(135deg,transparent_0_4px,hsl(var(--muted-foreground)/0.18)_4px_6px)] pr-1">
              <span className="text-[10px] leading-none text-muted-foreground" aria-hidden="true">▸</span>
            </div>
          )}
        </div>
      ) : (
        // 금액이 0 이 아니라 **없다.** "0원" 을 쓰지 않는다.
        <p className="text-sm text-muted-foreground">—</p>
      )}

      {/* 범례 — 색만으로 구분하지 않도록 항목명 텍스트를 병기한다. */}
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {cost.lines.map(l => (
          <li key={l.item} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={`h-2 w-2 shrink-0 rounded-full ${costColor(l.item)}`} aria-hidden="true" />
            <span className="text-foreground">{t.production.costCategories[l.item]}</span>
            <span className="tabular-nums">{fmtAmount(l.krw, locale, t)}</span>
            {total > 0 && <span className="tabular-nums">{fmtPct(l.krw / total, locale, 0)}</span>}
          </li>
        ))}
      </ul>

      {!cost.complete && (
        <div className="space-y-1.5">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t.production.costBarOpenEnd}
            {" · "}
            {tpl(t.production.missingItemsTpl, cost.missingItems.length)}
          </p>
          <ul className="flex flex-wrap gap-2">
            {cost.missingItems.map(item => (
              <li key={item}>
                {onFixCost === undefined ? (
                  <span className="inline-flex min-h-[32px] items-center rounded-lg border border-dashed border-border px-2 text-xs text-muted-foreground">
                    {t.production.costCategories[item]}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onFixCost(item)}
                    className="inline-flex min-h-[44px] items-center rounded-lg border border-dashed border-border px-3 text-xs text-muted-foreground transition-colors hover:border-ocean-500 hover:text-foreground"
                  >
                    {tpl(t.production.fixCostTpl, t.production.costCategories[item])}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
