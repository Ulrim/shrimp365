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
  included_quality_flags: string[]
  biomass_source_refs: { before: string[]; after: string[] }
  config_version: { before: string; after: string }
  assumptions: string[]
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
      <tr><td>포함 품질 플래그</td><td colspan="2">${joinOrDash(boundary.included_quality_flags)}</td></tr>
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
      <tr><td>적용 배출계수</td><td colspan="2">${esc(ef.version)} (${esc(ef.source)}, ${esc(ef.year)}년)</td></tr>
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
