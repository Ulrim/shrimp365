/**
 * MRV 리포트 인쇄용 문서 — 원본 `apps/api/app/templates/mrv_report.html` +
 * `services/pdf_render.py` 의 이식본.
 *
 * ★ 원본과 달라진 점 하나: 서버가 PDF 파일을 만들어 디스크에 두지 않는다.
 *   원본은 WeasyPrint(또는 Playwright)로 PDF 를 렌더해 `mrv_reports_dir` 에 저장하고
 *   경로를 DB 에 남겼다. 이 배포 형태(Next.js/서버리스)에는 그런 영속 디스크가 없고,
 *   한글 글리프를 담은 폰트를 PDF 엔진에 붙이는 일도 배포 환경마다 갈린다 — 원본이
 *   `pdf_is_available` 로 "PDF 실패 시 HTML 폴백"을 이미 계약에 넣어 둔 이유가 그것이다.
 *   그래서 이식본은 그 폴백을 정식 경로로 삼는다: 요청 시 인쇄용 HTML 을 그려 주고,
 *   브라우저의 인쇄 → PDF 저장으로 파일을 만든다. 한글이 깨지지 않고(브라우저 폰트를
 *   그대로 쓴다), 저장소도 필요 없으며, 리포트가 append-only 라는 성질도 그대로다.
 *
 * 표시 규칙은 원본 템플릿 그대로다. 특히 '산출 불가'(null)를 0 으로 바꾸지 않고
 * "N/A" 로 드러낸다 — 조용히 0 으로 적으면 심사자가 그것을 실측 0 으로 읽는다.
 */

import type { EmissionFactorRow, MrvReportRow } from "./mrv-report-service"
import {
  REPORT_MISSING_BASIS_NOTE,
  REPORT_NON_METERED_HEADLINE,
  formatMeasurementBasisTally,
  nonMeteredCount,
  nonMeteredPowerText,
  readMeasurementBasisTally,
  unrecordedBasisText,
} from "./measurement-basis"
import {
  EMPTY_QUALITY_FLAG_LIST_REASON,
  REPORT_MISSING_FLAGS_NOTE,
  REPORT_NON_DEFAULT_FLAGS_HEADLINE,
  RISKY_QUALITY_FLAGS,
  isDefaultQualityFlagList,
  qualityFlagRiskText,
} from "./quality-flags"

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** 소수 자리 고정. null 은 "N/A" — 산출 불가를 숫자로 위장하지 않는다. */
function num(value: unknown, digits: number): string {
  if (value === null || value === undefined) return "N/A"
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(digits) : "N/A"
}

/** 유효숫자 4자리(원본의 `%.4g`). 그래프 막대 라벨용. */
function sig4(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A"
  return Number(value.toPrecision(4)).toString()
}

function joinOrDash(values: unknown): string {
  const list = Array.isArray(values) ? values : []
  return list.length > 0 ? esc(list.join(", ")) : "-"
}

/**
 * 전/후 비교 막대그래프. 외부 차트 라이브러리 없이 결정론적으로 그린다
 * (수치가 둘뿐이라 SVG 직접 생성으로 충분하고, 렌더 결과가 환경에 흔들리지 않는다).
 * 값이 null 이면 높이 0 막대 + "N/A" 라벨로 표시한다 — 조용히 숨기지 않는다.
 */
function comparisonBarSvg(params: {
  labelBefore: string
  valueBefore: number | null
  labelAfter: string
  valueAfter: number | null
  unit: string
  width?: number
  height?: number
}): string {
  const { labelBefore, valueBefore, labelAfter, valueAfter, unit } = params
  const width = params.width ?? 320
  const height = params.height ?? 180
  const barAreaH = height - 50

  const values = [valueBefore, valueAfter].filter(
    (v): v is number => v !== null && Number.isFinite(v),
  )
  const rawMax = values.length > 0 ? Math.max(...values) : 0
  const maxV = rawMax > 0 ? rawMax : 1.0 // 0 나눗셈 방지(표시 전용)

  const barH = (v: number | null) =>
    v === null || !Number.isFinite(v) ? 0 : Math.max(2, (v / maxV) * barAreaH)

  const barW = 70
  const gap = 60
  const xBefore = 40
  const xAfter = xBefore + barW + gap
  const hBefore = barH(valueBefore)
  const hAfter = barH(valueAfter)
  const baseY = barAreaH + 20

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `,
    `viewBox="0 0 ${width} ${height}" role="img" aria-label="전후 비교 그래프">`,
    `<line x1="20" y1="${baseY}" x2="${width - 10}" y2="${baseY}" stroke="#333" stroke-width="1"/>`,
    `<rect x="${xBefore}" y="${baseY - hBefore}" width="${barW}" height="${hBefore}" fill="#94a3b8"/>`,
    `<text x="${xBefore + barW / 2}" y="${baseY + 20}" text-anchor="middle" font-size="12">${esc(labelBefore)}</text>`,
    `<text x="${xBefore + barW / 2}" y="${baseY - hBefore - 6}" text-anchor="middle" font-size="12">${esc(sig4(valueBefore))} ${esc(unit)}</text>`,
    `<rect x="${xAfter}" y="${baseY - hAfter}" width="${barW}" height="${hAfter}" fill="#16a34a"/>`,
    `<text x="${xAfter + barW / 2}" y="${baseY + 20}" text-anchor="middle" font-size="12">${esc(labelAfter)}</text>`,
    `<text x="${xAfter + barW / 2}" y="${baseY - hAfter - 6}" text-anchor="middle" font-size="12">${esc(sig4(valueAfter))} ${esc(unit)}</text>`,
    "</svg>",
  ].join("")
}

type Summary = {
  period: { from: string; to: string }
  config_version: string
  ei_total: number | null
  ei_aeration: number | null
  total_power_kwh: number
  aeration_power_kwh: number
  biomass_delta_kg: number
  scope2_tco2e: number | null
  kpi_snapshot_id: string | null
}

type Boundary = {
  site_id: string
  site_name: string
  included_meter_ids: string[]
  /**
   * EI 의 산입 품질 플래그. **옛 리포트에는 이 칸이 없다**(이 칸을 넣기 전에 발행된
   * 것들). 그래서 optional 이다 — 필수로 적으면 `undefined` 를 빈 배열로 뭉개는 코드가
   * 타입 검사를 통과해 버리고, 그것이 옛 리포트에 거짓 주장을 인쇄한 원인이었다.
   */
  included_quality_flags?: string[]
  /**
   * After 기간에 **산입된** 전력의 자료유형 집계. **옛 리포트에는 이 칸이 없다**(이 칸을
   * 넣기 전에 발행된 것들). 그래서 optional 이고, 없는 것은 "-" + 기록 없음 설명으로
   * 적는다 — 0 으로 뭉개면 "전부 실측" 이라는 거짓을 인쇄하게 된다.
   */
  after_power_measurement_basis?: unknown
  biomass_source_refs: { before: string[]; after: string[] }
  config_version: { before: string; after: string }
  /**
   * 생성 시점에 얼린 배출계수 출처. **옛 리포트에는 없다**(이 칸을 넣기 전에 발행된
   * 것들). 그래서 optional 이고, 아래 렌더는 스냅샷 우선 · 활성 조인 폴백이다.
   */
  emission_factor?: {
    version: string
    source: string
    year: number
    factor_tco2e_per_mwh: number
    gas_scope: string | null
    basis_from_year: number | null
    basis_to_year: number | null
    document_name: string | null
    issuing_body: string | null
    published_on: string | null
    source_url: string | null
    method: string | null
  }
  assumptions: string[]
}

/** 기준 기간을 사람이 읽는 한 줄로. 단년도와 다년 평균을 구분해 적는다. */
function basisPeriodLabel(from: number | null, to: number | null): string | null {
  if (from === null || to === null) return null
  return from === to ? `${from}년 단년도` : `${from}~${to}년 평균`
}

/**
 * 적용 배출계수의 출처 줄들.
 *
 * **스냅샷 우선, 활성 조인 폴백.** 리포트가 생성될 때 얼린 `boundary.emission_factor` 가
 * 있으면 그것을 쓴다 — 나중에 계수 행의 문서명·URL 을 보강해도 **이미 발행된 리포트의
 * 인용문이 바뀌지 않아야** 하기 때문이다. 그 칸이 없는 옛 리포트는 종전처럼 계수 행을
 * 그대로 읽는다(그 리포트들에는 애초에 출처 칸이 없었다).
 *
 * 비어 있는 칸은 **줄을 만들지 않는다.** "—" 로 채우면 인쇄물에 빈 근거 줄이 늘어서
 * 검증자가 무엇이 제시된 것인지 가려내기 어렵다 — 없는 것은 없는 대로 둔다.
 */
function emissionFactorRows(boundary: Boundary, ef: EmissionFactorRow): string {
  const snap = boundary.emission_factor
  const version = snap?.version ?? ef.version
  const source = snap?.source ?? ef.source
  const year = snap?.year ?? ef.year
  const factor = snap?.factor_tco2e_per_mwh ?? ef.factor_tco2e_per_mwh
  const gasScope = snap?.gas_scope ?? ef.gas_scope ?? null
  const basis = basisPeriodLabel(
    snap?.basis_from_year ?? ef.basis_from_year ?? null,
    snap?.basis_to_year ?? ef.basis_to_year ?? null,
  )
  const documentName = snap?.document_name ?? ef.document_name ?? null
  const issuingBody = snap?.issuing_body ?? ef.issuing_body ?? null
  const publishedOn = snap?.published_on ?? ef.published_on ?? null
  const sourceUrl = snap?.source_url ?? ef.source_url ?? null
  const method = snap?.method ?? ef.method ?? null

  const rows: string[] = [
    `<tr><td>적용 배출계수</td><td colspan="2">${esc(version)} — ${esc(factor)} tCO2e/MWh` +
      `${gasScope ? ` (${esc(gasScope)} 기준)` : ""}, ${esc(year)}년</td></tr>`,
  ]
  if (basis) rows.push(`<tr><td>계수 기준 기간</td><td colspan="2">${esc(basis)}</td></tr>`)
  if (documentName || issuingBody || publishedOn) {
    const parts = [issuingBody, documentName, publishedOn ? `${publishedOn} 공표` : null]
      .filter(Boolean)
      .map((x) => esc(x as string))
    rows.push(`<tr><td>계수 공표 출처</td><td colspan="2">${parts.join(" · ")}</td></tr>`)
  }
  // URL 은 인쇄물에서 눌릴 수 없으므로 글자로 그대로 적는다(검증자가 타이핑해 따라간다).
  if (sourceUrl) rows.push(`<tr><td>출처 주소</td><td colspan="2">${esc(sourceUrl)}</td></tr>`)
  if (method) {
    rows.push(
      `<tr><td>Scope2 산정 방식</td><td colspan="2">` +
        `${method === "location_based" ? "location-based (계통 평균 배출계수)" : esc(method)}` +
        `</td></tr>`,
    )
  }
  // source 자유 문자열은 마지막에 둔다 — 위 칸들이 비어 있을 때 유일한 근거이고,
  // 채워져 있을 때는 보충 설명이다.
  rows.push(`<tr><td>계수 비고</td><td colspan="2">${esc(source)}</td></tr>`)
  return rows.join("\n      ")
}

/**
 * 「포함 품질 플래그」 줄. 기본값(`["ok"]`)이면 값만, 아니면 **눈에 띄게** 그린다.
 *
 * ── 왜 이 줄만 다르게 그리는가 ───────────────────────────────────────────────
 * 이 한 줄이 리포트의 모든 수치가 **어떤 계측값으로 산출됐는지**를 정하는 칸이다.
 * 기본값을 넓히면(예: `ok, suspect`) 적산 원값이 EI 분자에 들어가 EI·Scope2·감축량이
 * 전부 달라지는데, 지금까지 이 줄은 `ok, suspect` 라는 글자만 조용히 적고 있었다 —
 * 심사위원이 그 차이를 알아보려면 ADR 0001 을 읽고 와야 했다.
 *
 * 그래서 기본값이 아닐 때는 (1) 줄에 테두리를 주고 (2) **무슨 일이 생기는지를 문장으로**
 * 같은 칸에 적는다. 인쇄물이라 색만으로는 알릴 수 없다(흑백 인쇄·복사가 기본이다) —
 * 테두리는 보조이고 판단 근거는 글자다.
 */
function qualityFlagRow(flags: unknown): string {
  /**
   * ★ **칸이 없는 것**과 **빈 배열**을 가르는 분기다.
   *
   * 전에는 `Array.isArray(flags) ? flags : []` 한 줄이라 둘이 같은 길로 갔다. 그래서
   * `boundary_json` 에 그 칸이 **없는** 옛 리포트가 "포함 건이 0 건이라 EI 0 · Scope2 0 ·
   * 감축량 기준선 전량" 이라는 **강한 거짓 주장**을 인쇄했다 — 종전에는 `-` 한 글자였다.
   * 기록이 없는 것은 "비어 있었다" 가 아니다.
   */
  if (flags === undefined || flags === null || !Array.isArray(flags)) {
    return (
      `<tr><td>포함 품질 플래그</td><td colspan="2">-` +
      `<div class="flag-note">${esc(REPORT_MISSING_FLAGS_NOTE)}</div></td></tr>`
    )
  }
  const list = flags
  if (isDefaultQualityFlagList(list)) {
    return `<tr><td>포함 품질 플래그</td><td colspan="2">${joinOrDash(list)}</td></tr>`
  }

  // 설명 순서는 사전순이 아니라 RISKY_QUALITY_FLAGS 순서(suspect, bad)다 — 심사위원이
  // 먼저 봐야 하는 것은 수치를 키우는 suspect 쪽이다.
  //
  // 블록은 "ei" 로 고정이다. 이 줄이 담는 것은 생성 시점에 얼린
  // `ei.included_quality_flags` 하나뿐이고(lib/mrv/mrv-report-service.ts), 경고 문장은
  // (플래그 × 블록)으로 갈려 있으므로 어느 목록인지를 밝혀 넘겨야 한다 — EI 를 주어로
  // 적은 문장을 다른 목록에 쓰면 틀린 수치 이름을 인쇄하게 된다.
  const notes: string[] = RISKY_QUALITY_FLAGS.filter((f) => list.includes(f)).map((f) =>
    qualityFlagRiskText(f, "ei"),
  )
  // 빈 배열은 **기록된 사실**이다(SQL 로 그렇게 들어간 설정으로 산출된 리포트). 그 경우
  // 분자가 0 으로 합산됐다는 것이 가장 중요한 단서이므로 같은 자리에 적는다.
  if (list.length === 0) notes.push(EMPTY_QUALITY_FLAG_LIST_REASON)

  return (
    `<tr class="flag-warn"><td>포함 품질 플래그</td><td colspan="2">` +
    `<strong>${joinOrDash(list)}</strong>` +
    `<div class="flag-warn-note">${esc(REPORT_NON_DEFAULT_FLAGS_HEADLINE)}` +
    (notes.length > 0 ? ` ${notes.map((n) => esc(n)).join(" ")}` : "") +
    `</div></td></tr>`
  )
}

/**
 * 「전력 자료유형(After)」 줄. 계량기 실측이 아닌 건이 산입돼 있으면 **눈에 띄게** 그린다.
 *
 * ── 왜 이 줄이 있는가 ───────────────────────────────────────────────────────
 * 이 리포트의 Scope 2 배출량과 EI 는 **전력(kWh)을 분자로** 산출된다. 그 kWh 가 계량기
 * 지침이 아니라 「정격 출력 × 가정 부하율 ÷ 가정 효율 × 가동시간」 같은 산식의 결과인
 * 경우가 실제로 있고(실증 전 단계의 계산 샘플), 그 사실을 적지 않으면 **인쇄된 리포트가
 * 계산값을 실측으로 제시한다.** 검증기관이 가장 먼저 무너뜨리는 자리다.
 *
 * 모양은 「포함 품질 플래그」 줄과 **같다** — 같은 `.flag-warn` 테두리, 같은 `.flag-note`,
 * 색이 아니라 **글자가 판단 근거**다(흑백 복사가 기본이다). 두 경고가 다른 모양이면
 * 하나는 덜 중요한 것으로 읽힌다.
 */
function measurementBasisRow(raw: unknown): string {
  // ★ **칸이 없는 것**과 **0 건**을 가르는 분기다(품질 플래그 줄과 같은 이유).
  //   기록이 없는 리포트에 "실측 0건 · 계산값 0건" 을 적으면 합이 0 인 집계를 증빙으로
  //   인쇄하는 것이고, 읽는 사람은 그것을 "전력이 없었다" 로 읽는다.
  if (raw === undefined) {
    return (
      `<tr><td>전력 자료유형(After)</td><td colspan="2">-` +
      `<div class="flag-note">${esc(REPORT_MISSING_BASIS_NOTE)}</div></td></tr>`
    )
  }
  const tally = readMeasurementBasisTally(raw)
  if (tally === null) {
    return (
      `<tr><td>전력 자료유형(After)</td><td colspan="2">-` +
      `<div class="flag-note">${esc(REPORT_MISSING_BASIS_NOTE)}</div></td></tr>`
    )
  }

  const summary = formatMeasurementBasisTally(tally)
  if (nonMeteredCount(tally) === 0) {
    // 실측이 아닌 건이 없다. 그래도 **미기재가 있으면 그 사실을 적는다** — 경고는
    // 아니지만(모른다는 것은 실측이 아니라는 뜻이 아니다) 숨길 사실도 아니다.
    const note =
      tally.unrecorded > 0
        ? `<div class="flag-note">${esc(unrecordedBasisText(tally.unrecorded))}</div>`
        : ""
    return `<tr><td>전력 자료유형(After)</td><td colspan="2">${esc(summary)}${note}</td></tr>`
  }

  const notes = [nonMeteredPowerText(tally)]
  if (tally.unrecorded > 0) notes.push(unrecordedBasisText(tally.unrecorded))
  return (
    `<tr class="flag-warn"><td>전력 자료유형(After)</td><td colspan="2">` +
    `<strong>${esc(summary)}</strong>` +
    `<div class="flag-warn-note">${esc(REPORT_NON_METERED_HEADLINE)} ` +
    `${notes.map((n) => esc(n)).join(" ")}</div></td></tr>`
  )
}

/** 리포트 1건을 A4 인쇄용 HTML 문서로 그린다. */
export function renderMrvReportHtml(
  report: MrvReportRow,
  ef: EmissionFactorRow,
): string {
  const before = report.before_json as unknown as Summary
  const after = report.after_json as unknown as Summary
  const boundary = report.boundary_json as unknown as Boundary

  const chart = comparisonBarSvg({
    labelBefore: "Before",
    valueBefore: before.ei_total,
    labelAfter: "After",
    valueAfter: after.ei_total,
    unit: "kWh/kg",
  })

  const reduction =
    report.reduction_tco2e !== null
      ? `${num(report.reduction_tco2e, 4)} tCO2e`
      : "산출 불가(N/A)"

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MRV 리포트 — ${esc(report.id)}</title>
<style>
  /* 한글 글리프는 열람 기기의 폰트를 쓴다. 서버에서 PDF 를 굽지 않으므로 폰트 임베드가
     필요 없고, 어느 환경에서 인쇄해도 글자가 깨지지 않는다. */
  body {
    font-family: "Pretendard", "Noto Sans KR", "Malgun Gothic", -apple-system,
      BlinkMacSystemFont, sans-serif;
    font-size: 11pt; color: #111827; line-height: 1.5;
    max-width: 210mm; margin: 0 auto; padding: 16mm 12mm;
  }
  @page { size: A4; margin: 20mm 16mm; }
  h1 { font-size: 18pt; margin-bottom: 2mm; }
  h2 { font-size: 13pt; margin-top: 8mm; margin-bottom: 3mm;
       border-bottom: 1px solid #cbd5e1; padding-bottom: 1mm; }
  .meta { color: #475569; font-size: 9.5pt; margin-bottom: 6mm; }
  .meta div { margin-bottom: 1mm; }
  table { width: 100%; border-collapse: collapse; margin-top: 2mm; }
  th, td { border: 1px solid #cbd5e1; padding: 2mm 3mm; text-align: right; font-size: 10pt; }
  th { background: #f1f5f9; text-align: center; }
  td:first-child, th:first-child { text-align: left; }
  .headline { background: #ecfdf5; border: 1px solid #16a34a; border-radius: 4px;
              padding: 4mm; margin-top: 4mm; }
  .headline .value { font-size: 20pt; font-weight: 700; color: #15803d; }
  /* 산식 전문에 한글이 섞이므로 monospace 를 지정하지 않는다 — 지정하면 한글만
     시스템 폴백 폰트로 튀어 줄 간격이 흐트러진다. */
  .formula { white-space: pre-line; background: #f8fafc; border: 1px solid #e2e8f0;
             padding: 4mm; font-size: 9.5pt; }
  .assumptions li { margin-bottom: 1.5mm; }
  .chart-wrap { display: flex; align-items: center; gap: 8mm; margin-top: 3mm; }
  .chart-caption { font-size: 9.5pt; color: #475569; }
  .footer-note { margin-top: 8mm; font-size: 8.5pt; color: #64748b; }
  /* 수치의 산출 범위가 기본 상태와 다를 때 쓰는 한 가지 모양. 지금 두 줄이 쓴다 —
     포함 품질 플래그가 기본값이 아닐 때, 그리고 산입된 전력에 계량기 실측이 아닌 건이
     섞여 있을 때. 흑백 인쇄에서도 보이게 테두리를 굵게 주고, 판단 근거는 색이 아니라
     같은 칸의 문장이 담는다. 두 경고가 다른 모양이면 하나는 덜 중요한 것으로 읽힌다. */
  .flag-warn td { border: 2px solid #b45309; background: #fffbeb; }
  .flag-warn-note { margin-top: 1.5mm; font-size: 9pt; line-height: 1.45; color: #7c2d12; }
  /* 기록이 없는 칸의 설명. 경고가 아니므로 테두리를 주지 않는다 — 옛 리포트에 없는
     위험을 있는 것처럼 인쇄하지 않는다. */
  .flag-note { margin-top: 1.5mm; font-size: 9pt; line-height: 1.45; color: #475569; }
  .print-hint { margin-bottom: 6mm; padding: 3mm 4mm; background: #eff6ff;
                border: 1px solid #bfdbfe; border-radius: 4px; font-size: 9.5pt;
                color: #1e40af; }
  @media print { .print-hint { display: none; } body { padding: 0; } }
</style>
</head>
<body>
  <div class="print-hint">
    이 문서를 PDF 로 저장하려면 브라우저의 인쇄(Ctrl/⌘+P)에서 대상을 “PDF 로 저장”으로
    선택하십시오. 용지 A4, 여백 기본값 기준으로 배치돼 있습니다.
  </div>

  <h1>MRV 리포트 (탄소저감 성과: Scope2)</h1>
  <div class="meta">
    <div>리포트 ID: ${esc(report.id)}</div>
    <div>사이트: ${esc(boundary.site_name)} (${esc(report.site_id)})</div>
    <div>기간(After): ${esc(report.period_start)} ~ ${esc(report.period_end)}</div>
    <div>Baseline(Before) 참조 ID: ${esc(report.baseline_id)}</div>
    <div>After KPI 스냅샷 참조 ID: ${esc(after.kpi_snapshot_id)}</div>
    <div>생성자: ${esc(report.generated_by)} / 생성 시각: ${esc(report.generated_at)}</div>
  </div>

  <h2>1. Before / After 비교표</h2>
  <table>
    <thead>
      <tr><th>지표</th><th>Before(기준선)</th><th>After(현재)</th></tr>
    </thead>
    <tbody>
      <tr><td>기간</td><td>${esc(before.period.from)} ~ ${esc(before.period.to)}</td><td>${esc(after.period.from)} ~ ${esc(after.period.to)}</td></tr>
      <tr><td>적용 kpi_config 버전</td><td>${esc(before.config_version)}</td><td>${esc(after.config_version)}</td></tr>
      <tr><td>EI_total (kWh/kg)</td><td>${esc(before.ei_total ?? "N/A")}</td><td>${esc(after.ei_total ?? "N/A")}</td></tr>
      <tr><td>EI_aeration (kWh/kg)</td><td>${esc(before.ei_aeration ?? "N/A")}</td><td>${esc(after.ei_aeration ?? "N/A")}</td></tr>
      <tr><td>총 전력사용량 (kWh)</td><td>${num(before.total_power_kwh, 2)}</td><td>${num(after.total_power_kwh, 2)}</td></tr>
      <tr><td>폭기 전력사용량 (kWh)</td><td>${num(before.aeration_power_kwh, 2)}</td><td>${num(after.aeration_power_kwh, 2)}</td></tr>
      <tr><td>생산량 Δbiomass (kg)</td><td>${num(before.biomass_delta_kg, 2)}</td><td>${num(after.biomass_delta_kg, 2)}</td></tr>
      <tr><td>Scope2 배출량 (tCO2e)</td><td>${num(before.scope2_tco2e, 4)}</td><td>${num(after.scope2_tco2e, 4)}</td></tr>
    </tbody>
  </table>

  <div class="headline">
    감축량(Scope2 Reduction): <span class="value">${esc(reduction)}</span>
  </div>

  <h2>2. 기간 / 측정경계(Boundary) / 가정(Assumptions)</h2>
  <table>
    <tbody>
      <tr><td>사이트</td><td colspan="2">${esc(boundary.site_name)} (${esc(boundary.site_id)})</td></tr>
      <tr><td>포함 계측기(meter) ID</td><td colspan="2">${joinOrDash(boundary.included_meter_ids)}</td></tr>
      ${qualityFlagRow(boundary.included_quality_flags)}
      ${measurementBasisRow(boundary.after_power_measurement_basis)}
      <tr><td>생산량 근거(Before)</td><td colspan="2">${joinOrDash(boundary.biomass_source_refs?.before)}</td></tr>
      <tr><td>생산량 근거(After)</td><td colspan="2">${joinOrDash(boundary.biomass_source_refs?.after)}</td></tr>
    </tbody>
  </table>
  <ul class="assumptions">
    ${(boundary.assumptions ?? []).map((a) => `<li>${esc(a)}</li>`).join("\n    ")}
  </ul>

  <h2>3. 산식 전문 (재현 가능)</h2>
  <div class="formula">${esc(report.formula_text)}</div>

  <h2>4. 전 / 후 그래프</h2>
  <div class="chart-wrap">
    ${chart}
    <div class="chart-caption">EI_total(kWh/kg) Before(회색) vs After(녹색)</div>
  </div>

  <h2>5. 적용 로직 / 버전 / 적용 로그 참조</h2>
  <table>
    <tbody>
      <tr><td>Baseline(Before) ID</td><td colspan="2">${esc(report.baseline_id)}</td></tr>
      <tr><td>After KPI 스냅샷 ID</td><td colspan="2">${esc(after.kpi_snapshot_id)}</td></tr>
      ${emissionFactorRows(boundary, ef)}
      <tr><td>kpi_config 버전(Before / After)</td><td colspan="2">${esc(boundary.config_version?.before)} / ${esc(boundary.config_version?.after)}</td></tr>
    </tbody>
  </table>

  <div class="footer-note">
    본 리포트의 모든 수치는 원천 Reading 까지 역추적 가능합니다
    (GET /api/mrv/kpi-snapshots/{id}, GET /api/mrv/sites/{id}/readings).
    생성 후 본 리포트는 append-only 이며 재생성 시 새 리포트가 발급됩니다.
  </div>
</body>
</html>`
}
