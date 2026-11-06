/**
 * 생산량 산정 근거(production basis) — 그 생체량을 **저울이 쟀는가, 산식이 냈는가**.
 *
 * ── 왜 이 파일이 따로 있는가 ─────────────────────────────────────────────────
 * `lib/mrv/measurement-basis.ts` 와 **같은 자리**다. 값을 만드는 곳은 입력 화면과 쓰기
 * 라우트이고, 그것을 읽어 밝히는 곳은 인쇄 리포트·리포트 화면·기준선 잠금 판정이다.
 * 네 곳이 각자 문장을 지으면 화면으로 본 사람과 인쇄물로 본 사람이 **다른 사실**을 알게
 * 되므로, 값의 의미와 사람이 읽는 문구를 한곳에 둔다.
 *
 * ★ 이 모듈은 의존성이 없는 순수 모듈로 유지할 것. 입력 화면(`"use client"`)과 인쇄
 *   리포트 렌더러와 라우트와 CSV 파서가 같이 import 한다 — `next/server` 나 DB 를 끌고
 *   들어오면 클라이언트 번들이 깨진다.
 *
 * ── 전력의 자료유형과 무엇이 다른가 ─────────────────────────────────────────
 * 둘은 **같은 모양의 다른 축**이다. 전력(`mrv_readings.measurement_basis`)은 EI 의 **분자**
 * 가 어떻게 얻어졌는지를 말하고, 이쪽은 **분모**가 어떻게 얻어졌는지를 말한다. EI 가
 * 낮게 나왔을 때 그것이 전기를 덜 쓴 결과인지 생산량을 넉넉히 가정한 결과인지는 두 칸을
 * 함께 읽어야만 갈린다.
 *
 * 값 이름이 `metered` 가 아니라 `measured` 인 이유: 생체량에는 계량기가 없다. 저울과
 * 계수기에 올린 값이고, '계량기 지침' 이라는 말이 뜻을 갖지 않는다.
 *
 * ── 집계가 아니라 **두 점**이다 (판단) ──────────────────────────────────────
 * 전력 쪽은 산입 건수의 분포(실측 N건 · 계산값 M건…)를 센다. 여기서는 세지 않는다 —
 * 분모 Δbiomass 는 기간 안 수확 기록 **양 끝 두 점의 차이**로 정의되므로
 * (lib/mrv/kpi-service.ts::pickBiomassBounds), 기간에 기록이 50건 있어도 분모를 만든 것은
 * 두 건뿐이다. 50건의 분포를 적으면 "분모가 무엇으로 만들어졌는가" 를 **틀리게** 적는다.
 * 그래서 이 모듈이 다루는 단위는 개시·마감 **두 점**이다.
 *
 * ── null = 미기재 ───────────────────────────────────────────────────────────
 * 이 열들이 생기기 전에 저장된 행은 전부 null 이고, 그 행들이 실측이었다는 기록은 어디에도
 * 없다(supabase/migrations/mrv_harvest_logs_production_basis.sql). 그래서 null 은
 * **「미기재」**이며, 화면·리포트가 그렇게 적는다 — 실측으로 세지 않고, 실측이 아니라고도
 * 단정하지 않는다.
 */

/** 저장 가능한 산정 근거 전체. `mrv_harvest_logs.production_basis` 의 CHECK 와 같은 집합. */
export const PRODUCTION_BASES = ["measured", "calculated", "estimated"] as const

export type ProductionBasis = (typeof PRODUCTION_BASES)[number]

/**
 * 실측이 아닌 산정 근거. **미기재(null)는 여기 들어가지 않는다** — 모른다는 것과 실측이
 * 아니라는 것은 다른 사실이고, 뭉개면 옛 데이터 전부가 "계산값" 으로 경고된다.
 */
export const NON_MEASURED_BASES = ["calculated", "estimated"] as const

/** 화면·인쇄물이 함께 쓰는 짧은 이름. 괄호 안이 판단 근거다. */
export const PRODUCTION_BASIS_LABELS: Record<ProductionBasis, string> = {
  measured: "실측(출하·계측량)",
  calculated: "계산생체량(산식)",
  estimated: "어림값",
}

/** 미기재(null)의 이름. 라벨 표에 null 키를 둘 수 없어 따로 둔다. */
export const UNRECORDED_PRODUCTION_BASIS_LABEL = "미기재"

/**
 * 고를 때 읽는 한 줄. "무엇을 고르면 되는가" 가 아니라 **그 값이 뜻하는 사실**을 적는다 —
 * 고르는 사람이 자기 기록이 어느 쪽인지 판단할 수 있어야 한다.
 */
export const PRODUCTION_BASIS_HINTS: Record<ProductionBasis, string> = {
  measured:
    "저울·계수기에 올려 실제로 잰 값입니다 — 출하 계량 전표, 표본 계측으로 산출한 현존량.",
  calculated:
    "산식으로 계산한 값입니다 — 입식수 × 최종평균개체중처럼 가정과 곱셈으로 낸 수. " +
    "저울에 올린 출하량이 아닙니다.",
  estimated: "어림값입니다 — 기억·경험으로 적은 수, 다른 기간·다른 수조에서 미룬 수.",
}

/** 계산·어림이면 근거를 적어야 한다. 그 사실을 화면과 라우트가 같은 문장으로 알린다. */
export const PRODUCTION_BASIS_NOTE_REQUIRED_NOTE =
  "계산생체량·어림값에는 「무엇으로 계산했는지」를 함께 적어야 합니다(예: 입식 100,000미 × " +
  "최종평균 35g, 생존율 보정 미적용). 근거 없는 '계산생체량' 딱지는 검산할 수 없는 주장이라 " +
  "딱지가 없는 것보다 나쁩니다."

/** 산정 근거 메모의 길이 상한. 라우트가 이 값으로 자르지 않고 **거절**한다. */
export const PRODUCTION_BASIS_NOTE_MAX = 500

/** 이 근거에 메모가 **필수**인가. 화면 검증과 라우트 검증이 같은 함수를 쓴다. */
export function productionBasisNoteRequired(basis: ProductionBasis): boolean {
  return (NON_MEASURED_BASES as readonly string[]).includes(basis)
}

/** 문자열이 저장 가능한 산정 근거인가. */
export function isProductionBasis(value: unknown): value is ProductionBasis {
  return typeof value === "string" && (PRODUCTION_BASES as readonly string[]).includes(value)
}

/**
 * 사람이 적은 칸 한 개를 산정 근거로 읽는다(기록지 CSV 의 열). 모르는 값이면 null.
 *
 * **한국어 표기도 받는다.** 운영자가 받는 기록지는 한국어이고, 받은 계산표는 그 칸에
 * "입식수×최종체중 계산생체량(실측 출하량 아님)" 처럼 적어 두었다. 다만 **뜻이 하나로
 * 모이는 표기만** 받는다 — 헤더 별칭과 같은 기준이다(lib/mrv/csv-records.ts). 못 읽은
 * 값을 그럴듯한 쪽으로 넘겨짚지 않고 null 을 돌려주고, 호출부가 그 줄을 오류로 센다.
 * 산정 근거를 넘겨짚는 것은 "실측 아님" 을 실측으로 저장하는 길이다.
 */
export function parseProductionBasis(raw: string): ProductionBasis | null {
  const value = raw.trim().toLowerCase().replace(/[\s_-]+/g, "")
  if (!value) return null
  switch (value) {
    case "measured":
    case "measure":
    case "metered":
    case "actual":
    case "실측":
    case "실측값":
    case "실측출하량":
    case "출하량":
    case "계량":
    case "계측":
    case "계측량":
      return "measured"
    case "calculated":
    case "calc":
    case "computed":
    case "계산":
    case "계산값":
    case "계산생체량":
    case "산식":
    case "산식계산":
    case "입식수x최종체중":
    case "입식수×최종체중":
      return "calculated"
    case "estimated":
    case "estimate":
    case "est":
    case "어림":
    case "어림값":
    case "추정":
    case "추정값":
      return "estimated"
    default:
      return null
  }
}

/** 받아들이는 표기를 사람에게 알려 주는 한 줄(422 문구·화면 설명이 같이 쓴다). */
export const PRODUCTION_BASIS_ACCEPTED_NOTE =
  `산정 근거는 ${PRODUCTION_BASES.join(", ")} 중 하나여야 합니다` +
  "(한국어로 실측 · 계산생체량 · 어림값 으로 적어도 됩니다)."

/**
 * 생존율 보정 적용 여부를 사람이 적은 칸에서 읽는다. 적히지 않았으면 undefined(미기재),
 * 읽을 수 없으면 null(그 줄을 오류로 센다).
 *
 * **"미적용" 을 미기재로 뭉개지 않는다.** 받은 계산표가 적은 사실이 바로 그 단어이고,
 * 미적용은 「보정하지 않았다」라는 **참인 기록**이다 — 모른다와 다르다.
 */
export function parseSurvivalAdjusted(raw: string): boolean | null | undefined {
  const value = raw.trim().toLowerCase().replace(/[\s_-]+/g, "")
  if (!value) return undefined
  switch (value) {
    case "true":
    case "y":
    case "yes":
    case "1":
    case "적용":
    case "적용함":
    case "o":
      return true
    case "false":
    case "n":
    case "no":
    case "0":
    case "미적용":
    case "적용안함":
    case "x":
      return false
    default:
      return null
  }
}

export const SURVIVAL_ADJUSTED_ACCEPTED_NOTE =
  "생존율 보정 적용 여부는 적용 / 미적용(또는 true / false)으로 적어 주세요. 빈 칸은 " +
  "미기재로 저장됩니다 — 미기재는 '미적용' 과 다른 사실입니다."

// ---------------------------------------------------------------------------
// 분모로 쓰인 두 점
// ---------------------------------------------------------------------------

/**
 * EI·FCR 의 분모를 만든 생체량 **한 점**의 산정 근거.
 *
 * `source_ref` 는 그 수확 기록의 id 다 — 리포트의 「생산량 근거」 줄에 이미 실리는 값과
 * 같은 것이므로, 심사자가 이 점이 어느 행인지 바로 되짚을 수 있다. 기간에 기록이 없어
 * 분모가 만들어지지 않은 경우에는 `source_ref` 가 null 이고 나머지도 전부 null 이다
 * (0 kg 더미 점은 「기록이 없다」이지 「0 kg 을 실측했다」가 아니다).
 */
export type ProductionBasisPoint = {
  source_ref: string | null
  /** ISO8601. 분모를 만든 그 시점. */
  ts: string | null
  biomass_kg: number | null
  /** null = 미기재. */
  basis: ProductionBasis | null
  /** 계산·어림의 근거(자유 기입). null = 적히지 않음. */
  basis_note: string | null
  /** null = 미기재. false = 보정하지 않았다(참인 기록). */
  survival_adjusted: boolean | null
}

/** 분모를 만든 **두 점**. 개시와 마감이 같은 기록인 경우 둘이 같은 행을 가리킨다. */
export type BiomassBasisRecord = {
  start: ProductionBasisPoint
  end: ProductionBasisPoint
}

export function emptyProductionBasisPoint(): ProductionBasisPoint {
  return {
    source_ref: null,
    ts: null,
    biomass_kg: null,
    basis: null,
    basis_note: null,
    survival_adjusted: null,
  }
}

export function emptyBiomassBasisRecord(): BiomassBasisRecord {
  return { start: emptyProductionBasisPoint(), end: emptyProductionBasisPoint() }
}

/**
 * 저장된 두 점(jsonb 에서 꺼낸 unknown)을 읽는다. 읽을 수 없으면 null — **「칸이 없다」와
 * 「미기재다」를 가르기 위해서다.**
 *
 * 인쇄 리포트와 리포트 화면이 같은 함수를 쓴다. 두 곳이 각자 읽으면 한쪽은 "-" 를,
 * 다른 쪽은 "미기재" 를 적는 날이 온다 — 그 둘은 다른 주장이다.
 *
 * 모양이 어긋난 점은 **일부만 읽어 적지 않고 통째로 버린다**(null). 반만 읽어 적으면
 * 분모를 만든 두 점 중 하나만 적힌 증빙을 인쇄하게 된다.
 */
export function readBiomassBasis(raw: unknown): BiomassBasisRecord | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null
  const doc = raw as Record<string, unknown>
  const start = readProductionBasisPoint(doc.start)
  const end = readProductionBasisPoint(doc.end)
  if (start === null || end === null) return null
  return { start, end }
}

function readProductionBasisPoint(raw: unknown): ProductionBasisPoint | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null
  const p = raw as Record<string, unknown>
  const out = emptyProductionBasisPoint()
  if (typeof p.source_ref === "string") out.source_ref = p.source_ref
  if (typeof p.ts === "string") out.ts = p.ts
  if (typeof p.biomass_kg === "number" && Number.isFinite(p.biomass_kg)) {
    out.biomass_kg = p.biomass_kg
  }
  if (isProductionBasis(p.basis)) out.basis = p.basis
  if (typeof p.basis_note === "string" && p.basis_note !== "") out.basis_note = p.basis_note
  if (typeof p.survival_adjusted === "boolean") out.survival_adjusted = p.survival_adjusted
  return out
}

/** 이 점의 산정 근거 이름. 미기재면 그렇게 적는다. */
export function productionBasisLabel(basis: ProductionBasis | null): string {
  return basis === null ? UNRECORDED_PRODUCTION_BASIS_LABEL : PRODUCTION_BASIS_LABELS[basis]
}

/**
 * 실측으로 **기록되지 않은** 점의 수(계산생체량 + 어림값). 미기재는 세지 않는다.
 *
 * 개시와 마감이 같은 행이면 1 로 센다 — 두 번 세면 "두 점이 다 계산값" 이라는 인상을
 * 주는데, 그 경우 실제로 분모를 만든 행은 하나다.
 */
export function nonMeasuredBiomassCount(record: BiomassBasisRecord): number {
  const points = distinctPoints(record)
  return points.filter(
    (p) => p.basis !== null && (NON_MEASURED_BASES as readonly string[]).includes(p.basis),
  ).length
}

/** 산정 근거가 적히지 않은 점의 수(미기재). 기록이 아예 없는 점은 세지 않는다. */
export function unrecordedBiomassCount(record: BiomassBasisRecord): number {
  return distinctPoints(record).filter((p) => p.basis === null).length
}

/**
 * 분모를 만든 **서로 다른** 행. 개시·마감이 같은 행을 가리키면 하나로 본다.
 * `source_ref` 가 null 인 점은 「기록이 없다」이므로 세지 않는다.
 */
function distinctPoints(record: BiomassBasisRecord): ProductionBasisPoint[] {
  const points = [record.start, record.end].filter((p) => p.source_ref !== null)
  if (
    points.length === 2 &&
    points[0].source_ref === points[1].source_ref
  ) {
    return [points[0]]
  }
  return points
}

/** 한 점을 "개시 — 계산생체량(산식) · 420.00 kg · 생존율 보정 미적용" 꼴로. */
export function formatProductionBasisPoint(
  label: "개시" | "마감",
  point: ProductionBasisPoint,
): string {
  if (point.source_ref === null) return `${label} — 기록 없음`
  const parts = [productionBasisLabel(point.basis)]
  if (point.biomass_kg !== null) parts.push(`${point.biomass_kg.toFixed(2)} kg`)
  parts.push(
    point.survival_adjusted === null
      ? "생존율 보정 미기재"
      : point.survival_adjusted
        ? "생존율 보정 적용"
        : "생존율 보정 미적용",
  )
  if (point.basis_note !== null) parts.push(`근거: ${point.basis_note}`)
  return `${label} — ${parts.join(" · ")}`
}

/** 두 점을 한 줄로. 화면·인쇄물이 같이 쓴다. */
export function formatBiomassBasis(record: BiomassBasisRecord): string {
  return (
    `${formatProductionBasisPoint("개시", record.start)} / ` +
    `${formatProductionBasisPoint("마감", record.end)}`
  )
}

/**
 * 실측이 아닌 생체량이 분모로 쓰였을 때 **무슨 일이 생기는지** 문장으로.
 *
 * "주의하십시오" 로 끝내지 않는다. 어느 지표가 그 값을 **분모로** 산출됐는지까지 적는다 —
 * 심사위원이 그 문장만 읽고 이 리포트의 성격을 판단할 수 있어야 경고가 제 일을 한다.
 * 색이나 아이콘에 기대지 않는다(인쇄 리포트는 흑백 복사가 기본이다 — 글자가 전부다).
 */
export function nonMeasuredBiomassText(record: BiomassBasisRecord): string {
  const points = distinctPoints(record).filter(
    (p) => p.basis !== null && (NON_MEASURED_BASES as readonly string[]).includes(p.basis),
  )
  const calculated = points.filter((p) => p.basis === "calculated").length
  const estimated = points.filter((p) => p.basis === "estimated").length
  const parts: string[] = []
  if (calculated > 0) {
    parts.push(
      `분모로 쓰인 생체량 ${calculated}건이 실측 출하·계측량이 아니라 계산생체량입니다` +
        "(입식수 × 최종평균개체중 꼴의 산식으로 낸 값)",
    )
  }
  if (estimated > 0) parts.push(`${estimated}건은 어림값입니다`)

  const unadjusted = points.filter((p) => p.survival_adjusted === false).length
  const adjustmentNote =
    unadjusted > 0
      ? ` 그중 ${unadjusted}건은 생존율 보정을 적용하지 않았습니다 — 폐사를 반영하지 않은 ` +
        "생산량은 과대해지고, 그만큼 EI 는 과소해집니다."
      : ""

  const notes = points
    .filter((p) => p.basis_note !== null)
    .map((p) => p.basis_note as string)
  const noteText = notes.length > 0 ? ` 적힌 산정 근거 — ${notes.join(" / ")}.` : ""

  return (
    `${parts.join("고, ")}. EI · 폭기 EI · FCR · OEI 는 그 값을 「분모」로 산출된 ` +
    "것입니다 — 저울에 올린 출하량으로 산출된 수치가 아닙니다." +
    adjustmentNote +
    noteText
  )
}

/** 미기재 점이 섞여 있을 때 덧붙이는 사실. 경고가 아니라 **모른다는 기록**이다. */
export function unrecordedBiomassText(count: number): string {
  return (
    `분모로 쓰인 생체량 ${count}건은 산정 근거가 기재되지 않았습니다(이 칸을 넣기 전에 ` +
    "저장된 수확·계측 기록은 전부 여기 들어갑니다). 미기재는 실측을 뜻하지 않으며, " +
    "실측이 아니라는 뜻도 아닙니다 — 그 기록이 어떻게 얻어진 값인지 아는 기록이 없다는 " +
    "뜻입니다."
  )
}

/**
 * 리포트의 「생산량 산정 근거」 줄이 **아예 없는** 옛 리포트에 적는 문구.
 *
 * ★ 칸이 없는 것과 "미기재" 는 다른 사실이다. 칸이 없는 리포트는 이 집계를 넣기 전에
 *   발행된 것이고, 그때 분모로 쓰인 생체량이 실측이었는지 **리포트 자신이 모른다.**
 *   (`REPORT_MISSING_BASIS_NOTE` 와 같은 태도다 — lib/mrv/measurement-basis.ts.)
 */
export const REPORT_MISSING_PRODUCTION_BASIS_NOTE =
  "이 리포트에는 생산량 산정 근거가 기록되지 않았습니다(이 칸을 넣기 전에 발행된 " +
  "리포트입니다). 분모로 쓰인 생체량이 실측 출하·계측량이었는지는 이 리포트로 알 수 " +
  "없으며, 근거 스냅샷(After KPI 스냅샷)과 원천 수확·계측 기록으로 되짚어야 합니다."

/**
 * 인쇄 리포트와 리포트 화면이 **같이 쓰는** 머리말. 두 곳이 각자 적으면 화면으로 본
 * 사람과 인쇄물로 본 사람이 다른 사실을 알게 된다(전력 자료유형 경고와 같은 모양).
 */
export const REPORT_NON_MEASURED_BIOMASS_HEADLINE =
  "★ 이 리포트의 분모(생산량)에는 실측 출하·계측량이 아닌 생체량이 쓰였습니다 — 아래 건수와 함께 읽으십시오."
