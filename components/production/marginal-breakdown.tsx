"use client"

// 요구 ③ — **왜 그런지 보일 것.**
//
// 계획서 2-3 의 검증 조건이 「근거 수치가 화면에 모두 노출(블랙박스 금지)」다.
// 그래서 발산 막대 + 같은 데이터의 `<table>` 토글을 같이 둔다.
//
// ── 두 가지를 섞지 않는다 ─────────────────────────────────────────────────
// 엔진 3 에는 비슷해 보이는 두 구조가 있고 뜻이 다르다(설계서 4-5).
//
//   candidate.attribution.components[]  **요인별 금액 분해.** 발산 막대의 행
//   window.marginal.rows[]              **후보 사이의 하루당 이익 변화(원/일).**
//                                       0 을 지나는 지점이 경제적 적기다
//
// 하나는 「왜 이익이 바뀌나」이고 하나는 「언제 바뀜이 멈추나」다.
//
// ── 행 목록을 하드코딩하지 않는다 ─────────────────────────────────────────
// components 를 순회한다. AttributionCode 는 `cost_${CostItem}` 템플릿 리터럴
// 이라 비용 6항목 전부가 올 수 있고, 다섯 요인만 적으면 cost_labor 와 교차항이
// **조용히 사라진다.** 그러면 막대의 합이 profitDeltaKrw 와 안 맞고, 엔진이
// 교차항을 잔차로 둔 이유(합이 정확히 같게)가 깨진다.
//
// 합계 행은 **profitDeltaKrw 를 그대로 쓴다.** 막대를 더해 만들지 않는다 —
// 반올림된 값에서 다시 계산하지 않는다는 규칙.

import { useState } from "react"
import { ChevronDown, Scale } from "lucide-react"

import { useT } from "@/lib/i18n-context"
import type { AttributionCode, HarvestCandidate, HarvestExclusion, MarginalAnalysis } from "@/lib/harvest"

import { ExclusionChip } from "./exclusion-chip"
import { fmt, fmtAmount, fmtRatioDelta, signColorClass, signGlyph, tpl } from "./format"

/** 코드 → 출처 태그. 블랙박스 금지(계획서 2-3). */
function sourceOf(code: AttributionCode): "growth" | "pricing" | "profitability" {
  if (code === "size_premium" || code === "price_size_interaction") return "pricing"
  if (code === "growth" || code === "mortality") return "growth"
  return "profitability"
}

/** 그 행에 붙일 경고. 폐사 행에는 생존율 가정값 칩이 붙는다. */
function exclusionsFor(
  code: AttributionCode,
  exclusions: readonly HarvestExclusion[],
): HarvestExclusion[] {
  const wanted: Record<string, readonly string[]> = {
    mortality: ["survival_rate_assumed", "harvest_daily_survival_default", "harvest_zero_mortality_assumed"],
    growth: ["abw_from_growth_projection", "harvest_water_temp_outlook_assumed", "harvest_abw_at_winf_ceiling"],
    size_premium: ["price_elasticity_provisional", "price_target_outside_observed_size"],
    cost_feed: ["remaining_period_cost_not_estimated"],
    cost_electricity: ["remaining_period_cost_not_estimated"],
  }
  const codes = wanted[code] ?? []
  return exclusions.filter(e => codes.includes(e.code))
}

export type MarginalBreakdownProps = {
  /** 분해를 보여줄 후보. 보통 추천 구간의 대표(또는 best)다. */
  candidate: HarvestCandidate | null
  /** 하루당 변화. **null 이 아니다** — 못 구했으면 sign 이 indeterminate 다. */
  marginal: MarginalAnalysis
  exclusions: readonly HarvestExclusion[]
}

export function MarginalBreakdown({ candidate, marginal, exclusions }: MarginalBreakdownProps) {
  const { t, locale } = useT()
  const [tableOpen, setTableOpen] = useState(false)

  const attribution = candidate?.attribution ?? null
  // 비용을 못 받았으면 **미산정**이다. 0 으로 그리면 "더 키워라" 쪽으로 이익이
  // 부풀고, 그것이 이 화면에서 가장 위험한 착각이다.
  const costNotEstimated = candidate !== null && candidate.additionalCostKrw === null
  const days = candidate?.dayOffset ?? null

  // 0일 후보의 분해는 자기 자신과의 비교라 전 항목이 0 이다. **그 막대를
  // 그리면 화면이 「증체도 폐사도 사료비도 0」이라고 말하게 된다.**
  if (attribution === null || candidate === null || candidate.dayOffset === 0) {
    return (
      <section className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Scale className="h-4 w-4" aria-hidden="true" />
          {t.production.marginalTitle}
        </h4>
        <p className="text-xs text-muted-foreground">
          {candidate !== null && candidate.dayOffset === 0
            ? t.engines.decision.harvest_now
            : candidate?.failure == null
              ? t.engines.marginalSign.indeterminate
              : t.engines.candidateFailure[candidate.failure]}
        </p>
      </section>
    )
  }

  const components = [...attribution.components].sort((a, b) => Math.abs(b.krw) - Math.abs(a.krw))
  const maxAbs = Math.max(1, ...components.map(c => Math.abs(c.krw)))

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Scale className="h-4 w-4" aria-hidden="true" />
          {days === null ? t.production.marginalTitle : tpl(t.production.marginalTitleTpl, days)}
        </h4>
        {/* 합계는 엔진의 profitDeltaKrw 그대로. 막대를 더해 만들지 않는다. */}
        <p className={`text-sm font-medium tabular-nums ${signColorClass(attribution.profitDeltaKrw)}`}>
          <span aria-hidden="true">{signGlyph(attribution.profitDeltaKrw)}</span>
          {fmtAmount(attribution.profitDeltaKrw, locale, t, { abs: true })}
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {attribution.profitDeltaKrw >= 0 ? t.production.profitPositive : t.production.profitNegative}
          </span>
        </p>
      </div>

      {/* ── 발산 막대 ─────────────────────────────────────────────────── */}
      <ul className="space-y-1">
        {components.map(c => {
          const pct = (Math.abs(c.krw) / maxAbs) * 50
          const rowExclusions = exclusionsFor(c.code, exclusions)
          const isCost = c.code.startsWith("cost_")
          const dimmed = isCost && costNotEstimated && c.krw === 0
          return (
            <li key={c.code} className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 truncate text-xs text-foreground sm:w-24">
                  {t.engines.attribution[c.code]}
                </span>
                {/* 중앙 0선에서 좌(손실) / 우(이익). */}
                <span className={`relative h-3 min-w-0 flex-1 rounded-sm ${dimmed ? "border border-dashed border-border" : "bg-muted"}`}>
                  <span className="absolute inset-y-0 left-1/2 w-px bg-border" aria-hidden="true" />
                  {!dimmed && (
                    <span
                      className={`absolute inset-y-0 rounded-sm ${c.krw >= 0 ? "bg-emerald-500/60" : "bg-red-500/60"}`}
                      style={c.krw >= 0 ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }}
                      aria-hidden="true"
                    />
                  )}
                </span>
                <span className={`w-20 shrink-0 text-right text-xs tabular-nums sm:w-24 ${dimmed ? "text-muted-foreground" : signColorClass(c.krw)}`}>
                  {dimmed ? (
                    t.production.marginalNotEstimated
                  ) : (
                    <>
                      <span aria-hidden="true">{signGlyph(c.krw)}</span>
                      {fmtAmount(c.krw, locale, t, { abs: true })}
                    </>
                  )}
                </span>
                <span className="hidden w-14 shrink-0 text-right text-[10px] text-muted-foreground sm:block">
                  {t.engines.source[sourceOf(c.code)]}
                </span>
              </div>
              {/* 크기 프리미엄의 보조 수치 — 앵커 대비 몇 % 인가. */}
              {c.code === "size_premium" && candidate?.priceRatioFromAnchor != null && (
                <p className="ml-20 text-[10px] tabular-nums text-muted-foreground sm:ml-24">
                  {/* **앵커 대비**다. 「지금 대비」가 아니다 — 라벨을 빼면
                      +110만원 막대 밑의 −9.0% 가 모순으로 읽힌다. */}
                  {t.production.sizeLadderColPremium} {fmtRatioDelta(candidate.priceRatioFromAnchor, locale)}
                </p>
              )}
              {rowExclusions.length > 0 && (
                <div className="ml-20 flex flex-wrap gap-1 sm:ml-24">
                  {rowExclusions.map(e => (
                    <ExclusionChip key={`${c.code}|${e.code}`} exclusion={e} />
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {/* 미산정이 있으면 합계의 아래쪽을 열어 둔다. */}
      {costNotEstimated && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          ◀ {t.production.marginalNotEstimated} · {t.engines.exclusionDetail.remaining_period_cost_not_estimated}
        </p>
      )}

      {/* ── 하루당 이익 변화 — 요인 분해가 아니다 ──────────────────────── */}
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <p className="text-xs font-medium text-foreground">{t.production.marginalPerDayTitle}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{t.engines.marginalSign[marginal.sign]}</p>
        {marginal.zeroCrossingDayOffset !== null && (
          <p className="mt-0.5 text-[11px] tabular-nums text-foreground">
            {tpl(t.production.marginalZeroCrossTpl, fmt(marginal.zeroCrossingDayOffset, locale, 1))}
          </p>
        )}
      </div>

      {/* ── 수치 표 토글 — 차트만으로는 SR 접근이 안 된다(§10 data-table) ── */}
      <button
        type="button"
        onClick={() => setTableOpen(v => !v)}
        aria-expanded={tableOpen}
        aria-controls="marginal-table"
        className="flex min-h-[44px] items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {tableOpen ? t.production.marginalHideTable : t.production.marginalShowTable}
        <ChevronDown className={`h-3 w-3 transition-transform ${tableOpen ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {tableOpen && (
        <div id="marginal-table" className="animate-fade-in space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className="sticky left-0 bg-card py-1.5 pr-2 text-left font-medium">{t.production.marginalColFactor}</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">{t.production.marginalColAmount}</th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">{t.production.marginalColSource}</th>
                </tr>
              </thead>
              <tbody>
                {components.map(c => (
                  <tr key={c.code} className="border-b border-border/50">
                    <th scope="row" className="sticky left-0 bg-card py-1.5 pr-2 text-left font-normal text-foreground">
                      {t.engines.attribution[c.code]}
                    </th>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${signColorClass(c.krw)}`}>
                      <span aria-hidden="true">{signGlyph(c.krw)}</span>
                      {fmtAmount(c.krw, locale, t, { abs: true })}
                    </td>
                    <td className="px-2 py-1.5 text-left text-muted-foreground">{t.engines.source[sourceOf(c.code)]}</td>
                  </tr>
                ))}
                <tr className="border-b-2 border-border font-medium">
                  <th scope="row" className="sticky left-0 bg-card py-1.5 pr-2 text-left text-foreground">{t.production.marginalNetLabel}</th>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${signColorClass(attribution.profitDeltaKrw)}`}>
                    <span aria-hidden="true">{signGlyph(attribution.profitDeltaKrw)}</span>
                    {fmtAmount(attribution.profitDeltaKrw, locale, t, { abs: true })}
                  </td>
                  <td className="px-2 py-1.5 text-left text-muted-foreground">{t.engines.source.harvest}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {marginal.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[360px] text-xs">
                <caption className="pb-1 text-left text-[11px] text-muted-foreground">
                  {t.production.marginalPerDayTitle} ({t.production.marginalPerDayUnit})
                </caption>
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th scope="col" className="py-1.5 pr-2 text-left font-medium">{t.production.marginalColFrom}</th>
                    <th scope="col" className="px-2 py-1.5 text-left font-medium">{t.production.marginalColTo}</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">{t.production.marginalColPerDay}</th>
                  </tr>
                </thead>
                <tbody>
                  {marginal.rows.map(r => (
                    <tr key={`${r.fromDayOffset}-${r.toDayOffset}`} className="border-b border-border/50">
                      <td className="py-1.5 pr-2 tabular-nums text-foreground">{r.fromDayOffset}{t.engines.unit.day}</td>
                      <td className="px-2 py-1.5 tabular-nums text-foreground">{r.toDayOffset}{t.engines.unit.day}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${signColorClass(r.perDayKrw)}`}>
                        <span aria-hidden="true">{signGlyph(r.perDayKrw)}</span>
                        {r.perDayKrw === null ? "—" : fmt(Math.abs(r.perDayKrw), locale)}
                        {/* 밴드가 0 을 품으면 부호를 단정하지 않는다. */}
                        {!r.signCertain && (
                          <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-400" title={t.production.marginalSignUncertain}>
                            ?
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
