"use client"

// 단가 근거 선택. **이 화면에서 두 번째로 중요한 컴포넌트다.**
//
// 도매 17,000 과 소매 활새우 26,500 이 **56% 벌어진다** — 성장 몇 주치보다 큰
// 레버다. 그래서 엔진 2 는 단가에 기본값을 박지 않고, 아무것도 안 넘기면
// 매출을 null 로 돌려준다(channel.ts 1~16행).
//
// **화면도 미리 고르지 않는다.** 고르는 순간 56% 가 결정되므로, 그 사실이
// 선택 지점에서 보여야 한다. 그래서 세 채널을 중앙값 하나로 보여주지 않고
// **관측 폭(표본 수 · 최저~최고)과 나란히** 놓는다. 소매 활새우는
// 16,000~28,000 으로 거의 두 배 벌어진다 — 중앙값만 쥐여 주면 26,500 이
// 확정 단가처럼 쓰인다.
//
// 미선택이 **유효한 초기 상태**임이 스크린리더에도 전달돼야 한다(§8).
// role="radiogroup" + aria-checked 로 하고, 아무 항목도 checked 가 아니다.

import { CHANNEL_MEDIAN_KRW_PER_KG, CHANNEL_PRICE_OBSERVED } from "@/lib/profitability"
import type { PriceBasis, SalesChannel } from "@/lib/profitability"
import { useT } from "@/lib/i18n-context"

import { fmt, tpl } from "./format"

const CHANNELS: readonly SalesChannel[] = ["wholesale", "retail_live", "retail_frozen"]

export type PriceBasisPickerProps = {
  value: PriceBasis | null
  onChange: (basis: PriceBasis | null) => void
  /** 실적에서 역산한 실현 단가(원/kg). 없으면 그 선택지를 비활성화한다. */
  realizedKrwPerKg: number | null
}

export function PriceBasisPicker({ value, onChange, realizedKrwPerKg }: PriceBasisPickerProps) {
  const { t, locale } = useT()

  const isChannel = (c: SalesChannel) => value?.kind === "channel_median" && value.channel === c
  const isRealized = value?.kind === "realized"

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-sm font-medium text-foreground">{t.production.priceBasisTitle}</h4>
        {/* 56% 격차를 선택 지점에 적는다. 고른 뒤에 알려 주면 늦다. */}
        <p className="text-xs text-amber-700 dark:text-amber-400">{t.production.priceBasisGapNote}</p>
      </div>

      <div role="radiogroup" aria-label={t.production.priceBasisTitle} className="grid gap-2 sm:grid-cols-2">
        {CHANNELS.map(c => {
          const observed = CHANNEL_PRICE_OBSERVED[c]
          const checked = isChannel(c)
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(checked ? null : { kind: "channel_median", channel: c })}
              className={`flex min-h-[44px] flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                checked
                  ? "border-ocean-500 bg-ocean-500/10"
                  : "border-border bg-muted hover:border-ocean-500/50"
              }`}
            >
              <span className="flex w-full items-baseline justify-between gap-2">
                <span className="text-sm text-foreground">{t.engines.channel[c]}</span>
                <span className="text-sm font-medium tabular-nums text-foreground">
                  {fmt(CHANNEL_MEDIAN_KRW_PER_KG[c], locale)}
                  <span className="ml-0.5 text-xs font-normal text-muted-foreground">{t.engines.unit.krw_per_kg}</span>
                </span>
              </span>
              {/* 관측 폭. **중앙값이 확정 단가가 아님을 말하는 수다.** */}
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {t.production.priceObservedRange} {fmt(observed.minKrwPerKg, locale)}~{fmt(observed.maxKrwPerKg, locale)}
                {" · "}
                {tpl(t.engines.channelObservedTpl, observed.n)}
              </span>
            </button>
          )
        })}

        {/* 실현 단가 — 채널이 섞인 평균이다. 민감도 분석이 이것을 쓴다. */}
        <button
          type="button"
          role="radio"
          aria-checked={isRealized}
          disabled={realizedKrwPerKg === null}
          onClick={() => onChange(isRealized ? null : { kind: "realized" })}
          className={`flex min-h-[44px] flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            isRealized ? "border-ocean-500 bg-ocean-500/10" : "border-border bg-muted hover:border-ocean-500/50"
          }`}
        >
          <span className="flex w-full items-baseline justify-between gap-2">
            <span className="text-sm text-foreground">{t.production.priceRealized}</span>
            <span className="text-sm font-medium tabular-nums text-foreground">
              {realizedKrwPerKg === null ? "—" : fmt(realizedKrwPerKg, locale)}
              {realizedKrwPerKg !== null && (
                <span className="ml-0.5 text-xs font-normal text-muted-foreground">{t.engines.unit.krw_per_kg}</span>
              )}
            </span>
          </span>
          <span className="text-[11px] text-muted-foreground">
            {realizedKrwPerKg === null
              ? t.engines.priceFailure.no_realized_basis
              : t.engines.exclusionDetail.price_from_channel_median}
          </span>
        </button>
      </div>

      {value === null && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {t.production.priceBasisNone}
        </p>
      )}
    </section>
  )
}

/** 직접 입력 단가. 계약 단가·견적이 있을 때. 0 과 빈 칸을 구분한다. */
export function explicitBasis(krwPerKg: string): PriceBasis | null {
  const v = Number.parseFloat(krwPerKg)
  if (!Number.isFinite(v) || v <= 0) return null
  return { kind: "explicit", krwPerKg: v }
}

