"use client"

// 계산이 안 될 때. **빈 차트 축을 그리지 않는다**(§10 empty-data-state).
//
// 규칙 셋 — ① 빈 축을 그리지 않는다 ② 왜 없는지 쓴다 ③ 고칠 버튼을 붙인다.
//
// 체크리스트 형태인 이유: 「계산 불가」 한 줄로는 농가가 다음에 무엇을 할지
// 모른다. ✓ 갖춰진 것과 ○ 없는 것을 같이 보여 주면 남은 한 칸이 보인다.
//
// **「7.5 g 이상 샘플 부족」을 「샘플 없음」과 같은 문구로 처리하면 안 된다.**
// 입식 초기 사이클에서 흔하게 걸리고, 그때 농가는 자기가 입력한 샘플이
// 무시됐다고 읽는다. 그래서 blocker 가 `samples_below_stanza` 로 따로 있고
// 건수(갖춘 것 / 전체)를 같이 쓴다.

import { Check, Circle } from "lucide-react"

import { useT } from "@/lib/i18n-context"

import type { EngineBlocker } from "./use-cycle-engines"
import { tpl } from "./format"

export type EngineEmptyStateProps = {
  blockers: readonly EngineBlocker[]
  /** 전체 항목. 갖춰진 것은 ✓ 로 보인다. 주지 않으면 막는 것만 나열한다. */
  checklist?: readonly EngineBlocker["kind"][]
  onAction?: (b: EngineBlocker) => void
  actionLabel?: (b: EngineBlocker) => string | null
}

/** blocker → 한 줄 문장. **엔진이 준 코드로만 만든다.** */
function blockerText(b: EngineBlocker, t: ReturnType<typeof useT>["t"]): string {
  switch (b.kind) {
    case "no_samples":
      return t.engines.fitFailure.no_samples
    case "samples_below_min":
      return `${tpl(t.production.growthNeedSamplesTpl, b.need)} — ${tpl(t.production.growthHaveSamplesTpl, b.have)}`
    case "samples_below_stanza":
      // 「현재 0건 / 전체 5건」 — 넣은 샘플이 무시된 것이 아니라는 사실.
      return `${tpl(t.production.growthNeedStanzaTpl, 3)} — ${tpl(t.production.growthHaveSamplesTpl, b.eligible)} / ${b.total}${t.engines.unit.count}`
    case "fit_failure":
      return t.engines.fitFailure[b.failure]
    case "no_price_basis":
      return t.engines.priceFailure.price_basis_not_selected
    case "no_cost":
      return tpl(t.production.missingItemsTpl, b.missing.length)
    case "no_temp_series":
      return t.production.growthNoTempSeries
    case "window_failure":
      return t.engines.windowFailure[b.failure]
  }
}

export function EngineEmptyState({ blockers, checklist, onAction, actionLabel }: EngineEmptyStateProps) {
  const { t } = useT()
  if (blockers.length === 0 && (checklist === undefined || checklist.length === 0)) return null

  const blocked = new Map(blockers.map(b => [b.kind, b]))
  const kinds = checklist ?? blockers.map(b => b.kind)

  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/40 p-3">
      <p className="text-sm font-medium text-foreground">{t.production.blockerChecklistTitle}</p>
      <ul className="mt-2 space-y-1.5">
        {kinds.map(kind => {
          const b = blocked.get(kind)
          const ok = b === undefined
          const label = actionLabel?.(b ?? ({ kind } as EngineBlocker)) ?? null
          return (
            <li key={kind} className="flex items-start gap-2">
              {ok ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              ) : (
                <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">
                <span className={`text-xs ${ok ? "text-muted-foreground line-through" : "text-foreground"}`}>
                  {t.engines.blocker[kind]}
                </span>
                {b !== undefined && (
                  <span className="block text-[11px] leading-relaxed text-muted-foreground">{blockerText(b, t)}</span>
                )}
              </span>
              {b !== undefined && label !== null && onAction !== undefined && (
                <button
                  type="button"
                  onClick={() => onAction(b)}
                  className="min-h-[44px] shrink-0 rounded-lg border border-ocean-500/40 bg-ocean-500/10 px-2.5 text-xs text-ocean-700 transition-colors hover:bg-ocean-500/20 dark:text-ocean-300"
                >
                  {label}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
