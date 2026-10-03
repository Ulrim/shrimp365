"use client"

// 「아는 폭」을 계산하려면 사용자에게 두 개를 물어야 한다.
//
// 엔진 2 는 재고 평가를 **인자로 받는다** — 「사이클이 안 닫혔을 때 재고를
// 얼마로 잡느냐는 사람이 정할 일이지 엔진이 0 으로 가정할 일이 아니다」
// (lib/profitability/index.ts). 그래서 화면이 묻고, **묻기 전에는 폭을 그리지
// 않는다.**
//
// ── 입력 문자열을 상태로 들고 있는 이유 ──────────────────────────────────
// 숫자를 상태로 들면 controlled input 이 매 입력마다 `number` 를 거쳐
// `String()` 으로 되돌아온다. 그러면 **소수점을 칠 수 없다** — "1." 이
// parseFloat 로 1 이 되고 value 가 "1" 로 덮여 점이 지워진다. step="0.1" 을
// 둔 것은 소수를 받겠다는 뜻인데 1.5 를 못 넣는다.
//
// 그래서 **보이는 글자는 문자열 그대로** 두고, 부모에는 파싱된 수만 올린다.
// 빈 칸은 `null` 이다 — `0` 이 아니다. "0" 을 입력하는 것과 비워 두는 것이
// 다른 사건이고, 그 차이가 엔진의 missingItems·exclusions 로 그대로 간다.

import { useState } from "react"

import { useT } from "@/lib/i18n-context"

export type InventoryInputProps = {
  inventoryKg: number | null
  outOfLedgerKg: number | null
  onChange: (next: { inventoryKg: number | null; outOfLedgerKg: number | null }) => void
}

/** 빈 칸은 null, "0" 은 0. **둘을 같게 만들지 않는다.** 음수·NaN 도 null. */
function parseKg(raw: string): number | null {
  if (raw.trim() === "") return null
  const v = Number.parseFloat(raw)
  return Number.isFinite(v) && v >= 0 ? v : null
}

export function InventoryInput({ inventoryKg, outOfLedgerKg, onChange }: InventoryInputProps) {
  const { t } = useT()
  // 보이는 글자. 부모의 수와 **같을 필요가 없다** — "1." 같은 중간 상태가 있다.
  const [inventoryText, setInventoryText] = useState(inventoryKg === null ? "" : String(inventoryKg))
  const [outOfLedgerText, setOutOfLedgerText] = useState(outOfLedgerKg === null ? "" : String(outOfLedgerKg))

  return (
    <section className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
      <h4 className="text-sm font-medium text-foreground">{t.production.inventoryTitle}</h4>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-muted-foreground">{t.production.inventoryKgLabel}</span>
          <input
            type="number"
            min={0}
            step="0.1"
            inputMode="decimal"
            value={inventoryText}
            onChange={e => {
              setInventoryText(e.target.value)
              onChange({ inventoryKg: parseKg(e.target.value), outOfLedgerKg })
            }}
            className="mt-1 min-h-[44px] w-full rounded-xl border border-border bg-muted px-3 text-sm tabular-nums text-foreground focus:border-ocean-500 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">{t.production.outOfLedgerKgLabel}</span>
          <input
            type="number"
            min={0}
            step="0.1"
            inputMode="decimal"
            value={outOfLedgerText}
            onChange={e => {
              setOutOfLedgerText(e.target.value)
              onChange({ inventoryKg, outOfLedgerKg: parseKg(e.target.value) })
            }}
            className="mt-1 min-h-[44px] w-full rounded-xl border border-border bg-muted px-3 text-sm tabular-nums text-foreground focus:border-ocean-500 focus:outline-none"
          />
        </label>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{t.production.inventoryValuationHint}</p>
      {/* 원장 누락 출하는 **금액으로 환산되지 않는다.** 엔진이 단가를 모른다. */}
      {outOfLedgerKg !== null && (
        <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
          {t.engines.exclusionDetail.harvest_not_in_event_ledger}
        </p>
      )}
    </section>
  )
}
