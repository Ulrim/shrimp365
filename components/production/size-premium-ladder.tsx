"use client"

// 크기 → 단가. `sizePriceTable` 의 결과를 **행마다 그대로** 보여준다.
//
// **스칼라 단가 테이블이 아니다.** 행마다 앵커의 단계·상태와 경고 목록이 붙어
// 나간다 — 판매처를 무시한 단가 표를 만들지 말라는 것이 lib/pricing 의 설계
// 제약이고(같은 40미/kg 에서 단가가 1.78배 벌어진다. 크기 전구간 효과는
// +24.6% 뿐이다 — 판매처 간 노이즈가 크기 신호의 3배다), 표 형태가 필요하다는
// 이유로 그 제약을 우회하지 않는다.
//
// 그래서 금액 옆에 **밴드**(탄력성 0.63~0.73)를 같이 쓴다. 0.63 은 하한이고,
// 점만 보면 크기 프리미엄이 과소평가된다.

import { useT } from "@/lib/i18n-context"
import type { SizePriceEstimate } from "@/lib/pricing"

import { ExclusionChip } from "./exclusion-chip"
import { fmt, fmtG, fmtRatioDelta } from "./format"

export type SizePremiumLadderProps = {
  /** sizePriceTable 의 결과 그대로. */
  estimates: readonly SizePriceEstimate[]
  /** 지금 개체중(g). 그 행을 강조한다. */
  currentAbwG?: number | null
}

export function SizePremiumLadder({ estimates, currentAbwG }: SizePremiumLadderProps) {
  const { t, locale } = useT()
  if (estimates.length === 0) return null

  const first = estimates[0]
  // 행마다 같은 경고가 반복되므로 표 아래에 **한 번** 모아 쓴다. 숨기지 않는다.
  const shared = first.exclusions

  // 지금 개체중에 가장 가까운 행. 없으면 강조하지 않는다.
  const nearest =
    currentAbwG == null || !Number.isFinite(currentAbwG)
      ? null
      : estimates.reduce<SizePriceEstimate | null>((best, e) => {
          if (best === null) return e
          return Math.abs(e.targetAbwG - currentAbwG) < Math.abs(best.targetAbwG - currentAbwG) ? e : best
        }, null)

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-sm font-medium text-foreground">{t.production.sizeLadderTitle}</h4>
        {first.stage !== null && first.form !== null && (
          <p className="text-[11px] text-muted-foreground">
            {t.engines.stage[first.stage]} · {t.engines.form[first.form]}
          </p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[400px] text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th scope="col" className="sticky left-0 bg-card py-1.5 pr-2 text-left font-medium">{t.production.sizeLadderColSize}</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">{t.production.sizeLadderColCountPerKg}</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">{t.production.sizeLadderColPrice}</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">{t.production.sizeLadderColBand}</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">{t.production.sizeLadderColPremium}</th>
            </tr>
          </thead>
          <tbody>
            {estimates.map(e => {
              const here = nearest !== null && e.targetAbwG === nearest.targetAbwG
              return (
                <tr key={e.targetAbwG} className={`border-b border-border/50 ${here ? "bg-ocean-500/10" : ""}`}>
                  <th scope="row" className={`sticky left-0 py-1.5 pr-2 text-left font-normal tabular-nums text-foreground ${here ? "bg-ocean-500/10" : "bg-card"}`}>
                    {fmtG(e.targetAbwG, locale, 1)}
                  </th>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {e.targetCountPerKg === null ? "—" : `${fmt(e.targetCountPerKg, locale)}${t.engines.unit.countPerKg}`}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                    {e.krwPerKg === null
                      ? (e.failure === null ? "—" : t.engines.sizePriceFailure[e.failure])
                      : fmt(e.krwPerKg, locale)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {e.bandKrwPerKg === null ? "—" : `${fmt(e.bandKrwPerKg.low, locale)}~${fmt(e.bandKrwPerKg.high, locale)}`}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {fmtRatioDelta(e.priceRatio, locale)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">{t.production.sizeLadderAnchorNote}</p>

      {shared.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {shared.map(e => (
            <ExclusionChip key={`${e.code}|${e.item ?? ""}`} exclusion={e} />
          ))}
        </div>
      )}
    </section>
  )
}
