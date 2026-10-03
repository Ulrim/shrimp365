"use client"

// 경고 표시의 **유일한** 원시 요소.
//
// 엔진 넷은 문장을 만들지 않는다 — `{ code, item?, quantity, unit }` 만 돌려주고
// 번역은 화면의 일이다(raspberry-pi/advice.py 와 같은 원칙). 그 번역이 여기
// 한 곳에만 있어야 하는 이유: 경고가 열 군데에서 각자 조립되면 같은 코드가
// 화면마다 다른 문구로 나오고, 그러면 농가가 두 경고를 다른 사건으로 읽는다.
//
// ── 규칙 ──────────────────────────────────────────────────────────────────
//  1. **수치를 문구 안에 넣지 않는다.** `{제목} · {수량}{단위}` 로 조립하고
//     단위는 `t.engines.unit[unit]` 에서 온다(설계서 9-2).
//  2. **quantity 가 null 이면 「폭 미상」이고 0 으로 찍지 않는다.** 「재고가
//     없다」와 「재고가 얼마인지 모른다」는 다른 사건이다.
//  3. `cost_not_recorded` 는 `item` 으로 **기존 비용 항목 번역을 재사용한다.**
//     비용 항목 이름을 새로 번역하지 않는다.
//  4. 엔진 2·단가·엔진 3 의 Exclusion 은 필드가 같다. **변환 코드를 쓰지
//     않는다** — 세 타입을 그대로 받는다.

import { useState } from "react"
import { ChevronDown, TriangleAlert } from "lucide-react"

import { useT } from "@/lib/i18n-context"
import type { Exclusion } from "@/lib/profitability"
import type { PricingExclusion } from "@/lib/pricing"
import type { HarvestExclusion } from "@/lib/harvest"

import { localeTag } from "./format"

/** 세 엔진의 Exclusion 중 아무거나. 가장 넓은 것이 HarvestExclusion 이다. */
export type AnyExclusion = Exclusion | PricingExclusion | HarvestExclusion

type ExclusionDict = Record<string, string | undefined>

/** 코드 → 짧은 제목. 사전에 없는 코드는 코드 자체를 보여준다 — 삼키지 않는다. */
export function exclusionTitle(e: AnyExclusion, t: ReturnType<typeof useT>["t"]): string {
  const dict = t.engines.exclusion as unknown as ExclusionDict
  const base = dict[e.code] ?? e.code
  if (e.code === "cost_not_recorded" && e.item !== undefined) {
    return `${t.production.costCategories[e.item]} ${base}`
  }
  return base
}

/** 코드 → 한 줄 설명. 없으면 빈 문자열(제목만 보인다). */
export function exclusionDetail(e: AnyExclusion, t: ReturnType<typeof useT>["t"]): string {
  const dict = t.engines.exclusionDetail as unknown as ExclusionDict
  return dict[e.code] ?? ""
}

/**
 * 수량 + 단위. **모르면 「폭 미상」이다.**
 *
 * 비율(ratio)은 배수로 쓴다 — 0.4545 를 "0.45배" 로. 생존율처럼 0~1 비율이
 * 들어오는 코드도 있는데(survival_rate_assumed), 그 경우도 배수 표기가
 * 틀리지 않다: 0.9970 은 하루 뒤 마리수가 0.997배라는 뜻이다.
 */
export function exclusionQuantity(
  e: AnyExclusion,
  t: ReturnType<typeof useT>["t"],
  locale: Parameters<typeof localeTag>[0],
): string {
  if (e.quantity === null) return t.production.widthUnknown
  const units = t.engines.unit as unknown as ExclusionDict
  const unit = e.unit === null ? "" : (units[e.unit] ?? "")
  // 단위마다 자리수가 다르다. 금액은 정수, 비율은 소수 4자리(0.9970 이 하루
  // 0.30% 폐사라는 사실이 3자리에서 사라진다).
  const digits = e.unit === "ratio" ? 4 : e.unit === "gram" || e.unit === "krw_per_kg" ? 1 : 0
  return e.quantity.toLocaleString(localeTag(locale), { maximumFractionDigits: digits }) + unit
}

export type ExclusionChipProps = {
  exclusion: AnyExclusion
  /** "inline" 은 칩 하나, "row" 는 설명을 펼칠 수 있는 한 줄. */
  variant?: "inline" | "row"
  /** 「그 자리에서 고칠」 버튼. 없으면 안 그린다. */
  action?: { label: string; onClick: () => void }
}

export function ExclusionChip({ exclusion, variant = "inline", action }: ExclusionChipProps) {
  const { t, locale } = useT()
  const [open, setOpen] = useState(false)
  const title = exclusionTitle(exclusion, t)
  const qty = exclusionQuantity(exclusion, t, locale)
  const detail = exclusionDetail(exclusion, t)
  const id = `excl-${exclusion.code}-${exclusion.item ?? "x"}`

  if (variant === "inline") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300"
        title={detail}
      >
        <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{title}</span>
        <span className="tabular-nums opacity-80">{qty}</span>
      </span>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-muted/50">
      <div className="flex items-center gap-2 px-3 py-2">
        <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{title}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{qty}</span>
        {detail !== "" && (
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            aria-controls={id}
            className="flex min-h-[44px] shrink-0 items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {open ? t.production.detailsClose : t.production.detailsOpen}
            <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && detail !== "" && (
        <div id={id} className="animate-fade-in border-t border-border px-3 py-2">
          <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>
          {action !== undefined && (
            <button
              type="button"
              onClick={action.onClick}
              className="mt-2 min-h-[44px] rounded-lg border border-ocean-500/40 bg-ocean-500/10 px-3 text-xs font-medium text-ocean-700 transition-colors hover:bg-ocean-500/20 dark:text-ocean-300"
            >
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── 그룹 분류 ──────────────────────────────────────────────────────────────
// 설계서 2-2 의 세 그룹. **금액축에서의 위치로 갈린다** — 이름이 아니라 위치다.
//
//   quantified    위쪽. 손익을 **올린다**. kg × 사용자가 고른 단가로 계산된다
//   unquantified  아래쪽. 손익을 **내린다**. 엔진이 추정을 거부한다
//   denominator   금액이 아니다. 생존율·FCR 의 **분모 신뢰도**를 흔든다
//
// 어느 그룹도 아닌 코드(단가 모델의 경고 대부분)는 `other` 다 — 금액의 방향을
// 말하지 않고 그 수가 어떻게 만들어졌는지를 말한다.
export type ExclusionGroup = "quantified" | "unquantified" | "denominator" | "other"

const GROUP_OF: Readonly<Record<string, ExclusionGroup>> = {
  revenue_unsold_inventory: "quantified",
  harvest_not_in_event_ledger: "quantified",
  cost_not_recorded: "unquantified",
  cost_depreciation_not_modeled: "unquantified",
  electricity_billing_incomplete: "unquantified",
  remaining_period_cost_not_estimated: "unquantified",
  cycle_boundary_derived_label: "denominator",
  cycle_boundary_not_resolved: "denominator",
}

export function exclusionGroup(e: AnyExclusion): ExclusionGroup {
  return GROUP_OF[e.code] ?? "other"
}

export function groupExclusions(
  exclusions: readonly AnyExclusion[],
): Record<ExclusionGroup, AnyExclusion[]> {
  const out: Record<ExclusionGroup, AnyExclusion[]> = {
    quantified: [],
    unquantified: [],
    denominator: [],
    other: [],
  }
  for (const e of exclusions) out[exclusionGroup(e)].push(e)
  return out
}
