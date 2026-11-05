/**
 * 맞춤 리포트 서식 — 검사와 기본값. (ENTERPRISE, 사양서 화면 13번)
 *
 * **서식이 바꾸는 것은 보여 주기뿐이다.** 어떤 절을 넣고 뺄지, 표에 어떤 지표를 올릴지,
 * 표지에 무엇을 적을지만 정한다. 산식·배출계수·기간은 서식이 건드리지 못한다 — 서식으로
 * 숫자가 달라질 수 있으면 "어느 서식으로 뽑았느냐" 가 감축량을 바꾸는 변수가 된다.
 *
 * 발행된 리포트는 그때 쓴 서식을 `template_json` 에 **얼려서** 들고 있다. 서식을 나중에
 * 고쳐도 이미 발행된 리포트의 모양은 바뀌지 않는다.
 */

import type { ReportSectionKey } from "./api-types"

export const REPORT_SECTIONS: readonly { key: ReportSectionKey; label: string; locked?: true }[] = [
  { key: "summary", label: "요약 (감축량 · 기간 · 배출계수)", locked: true },
  { key: "kpi_table", label: "KPI 표 (Before / After)" },
  { key: "formula", label: "산식 전문 (재현 가능)", locked: true },
  { key: "boundary", label: "측정경계 · 가정" },
  { key: "provenance", label: "자료 출처 (전력 자료유형 · 생산량 산정 근거)" },
  { key: "unavailability", label: "산출 불가 사유" },
  { key: "market_based", label: "Scope 2 market-based" },
]

/**
 * 뺄 수 없는 절. 요약과 산식 전문이 없는 문서는 증빙이 아니다 — 서식이 그것을 빼도록
 * 두면 "맞춤 서식" 이 증빙 요건을 우회하는 길이 된다.
 */
export const LOCKED_SECTIONS: readonly ReportSectionKey[] = REPORT_SECTIONS.filter(
  (s) => s.locked,
).map((s) => s.key)

/**
 * 표에 올릴 수 있는 지표 — **리포트가 실제로 들고 있는 것만.**
 *
 * MRV 리포트의 before/after 요약(`MrvReportPeriodSummary`)에는 EI 계열·전력·생산량·
 * Scope 2 만 있다. FCR·OEI·폐사율은 리포트에 얼려 들어가지 않으므로(그것은 KPI 스냅샷에
 * 있고 drill-down 으로 본다) 여기 적을 수 없다 — 적으면 서식이 **없는 칸을 약속**하게
 * 된다. 리포트 화면·인쇄물의 표 행(`MRV_METRIC_ROWS`)과 같은 다섯 개다.
 */
export const REPORT_METRICS: readonly { key: string; label: string }[] = [
  { key: "ei_total", label: "전력집약도(EI)" },
  { key: "ei_aeration", label: "폭기 EI" },
  { key: "total_power_kwh", label: "총 전력사용량" },
  { key: "biomass_delta_kg", label: "생산량(Δbiomass)" },
  { key: "scope2_tco2e", label: "Scope 2 배출량" },
]

/** 서식을 고르지 않았을 때의 모양 = 지금까지의 리포트와 같다. */
export const DEFAULT_TEMPLATE = {
  sections: REPORT_SECTIONS.map((s) => s.key),
  metrics: REPORT_METRICS.map((m) => m.key),
} as const

export const TEMPLATE_NAME_MAX = 80
export const COVER_TITLE_MAX = 120
export const COVER_NOTE_MAX = 1000

export type TemplateInput = {
  name?: unknown
  sections?: unknown
  metrics?: unknown
  cover_title?: unknown
  cover_note?: unknown
}

export type TemplateCheck =
  | {
      ok: true
      value: {
        name: string
        sections: ReportSectionKey[]
        metrics: string[]
        cover_title: string | null
        cover_note: string | null
      }
    }
  | { ok: false; detail: string }

export function checkTemplate(input: TemplateInput): TemplateCheck {
  const name = typeof input.name === "string" ? input.name.trim() : ""
  if (name === "") return { ok: false, detail: "서식 이름을 적어야 합니다." }
  if (name.length > TEMPLATE_NAME_MAX) {
    return { ok: false, detail: `서식 이름은 ${TEMPLATE_NAME_MAX}자까지 적을 수 있습니다.` }
  }

  if (!Array.isArray(input.sections) || input.sections.some((s) => typeof s !== "string")) {
    return { ok: false, detail: "sections 는 절 이름 배열이어야 합니다." }
  }
  const known = new Set(REPORT_SECTIONS.map((s) => s.key as string))
  const unknownSection = (input.sections as string[]).find((s) => !known.has(s))
  if (unknownSection) {
    return { ok: false, detail: `모르는 절입니다: ${unknownSection}` }
  }
  const sections = Array.from(new Set(input.sections as ReportSectionKey[]))
  for (const locked of LOCKED_SECTIONS) {
    if (!sections.includes(locked)) {
      return {
        ok: false,
        detail:
          `'${REPORT_SECTIONS.find((s) => s.key === locked)?.label}' 절은 뺄 수 없습니다 — ` +
          "요약과 산식 전문이 없는 문서는 증빙이 아닙니다.",
      }
    }
  }

  if (!Array.isArray(input.metrics) || input.metrics.some((m) => typeof m !== "string")) {
    return { ok: false, detail: "metrics 는 지표 이름 배열이어야 합니다." }
  }
  const knownMetric = new Set(REPORT_METRICS.map((m) => m.key))
  const unknownMetric = (input.metrics as string[]).find((m) => !knownMetric.has(m))
  if (unknownMetric) return { ok: false, detail: `모르는 지표입니다: ${unknownMetric}` }
  const metrics = Array.from(new Set(input.metrics as string[]))
  if (sections.includes("kpi_table") && metrics.length === 0) {
    return { ok: false, detail: "KPI 표를 넣으려면 지표를 하나 이상 골라야 합니다." }
  }

  const str = (v: unknown, max: number, label: string): string | null | { err: string } => {
    if (v === undefined || v === null) return null
    if (typeof v !== "string") return { err: `${label}은(는) 문자열이어야 합니다.` }
    const t = v.trim()
    if (t === "") return null
    if (t.length > max) return { err: `${label}은(는) ${max}자까지 적을 수 있습니다.` }
    return t
  }
  const coverTitle = str(input.cover_title, COVER_TITLE_MAX, "표지 제목")
  if (coverTitle !== null && typeof coverTitle === "object") return { ok: false, detail: coverTitle.err }
  const coverNote = str(input.cover_note, COVER_NOTE_MAX, "표지 머리말")
  if (coverNote !== null && typeof coverNote === "object") return { ok: false, detail: coverNote.err }

  return {
    ok: true,
    value: { name, sections, metrics, cover_title: coverTitle, cover_note: coverNote },
  }
}

/** 리포트 화면이 "이 절을 그릴까" 를 묻는 한 함수. 서식이 없으면 전부 그린다. */
export function templateShowsSection(
  template: { sections: ReportSectionKey[] } | null | undefined,
  key: ReportSectionKey,
): boolean {
  if (!template) return true
  return template.sections.includes(key)
}

export function templateShowsMetric(
  template: { metrics: string[] } | null | undefined,
  key: string,
): boolean {
  if (!template) return true
  return template.metrics.includes(key)
}
