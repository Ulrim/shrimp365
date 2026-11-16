// CSV 읽기·쓰기 — UTF-8 with BOM, CRLF. 엑셀에서 바로 열리는 형식이다.
// 의존 패키지 없이 쓴다(시험 PC 에서 npm install 없이 돌아가야 한다).

export const BOM = "﻿"

/** 한 칸을 CSV 규칙대로 감싼다. */
function cell(v) {
  const s = v === null || v === undefined ? "" : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 열 이름 배열과 행(객체) 배열을 CSV 문자열로. 열 순서는 header 순서 그대로다. */
export function toCsv(header, rows) {
  const lines = [header.map(cell).join(",")]
  for (const r of rows) lines.push(header.map(h => cell(r[h])).join(","))
  return BOM + lines.join("\r\n") + "\r\n"
}

/** CSV 문자열을 { header, rows } 로. 따옴표 안의 쉼표·줄바꿈·"" 를 처리한다. */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const table = []
  let row = [], field = "", quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ",") { row.push(field); field = "" }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(field); field = ""
      table.push(row); row = []
    } else field += c
  }
  if (field !== "" || row.length) { row.push(field); table.push(row) }
  const filled = table.filter(r => r.some(x => x !== ""))
  if (!filled.length) return { header: [], rows: [] }
  const header = filled[0]
  const rows = filled.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])))
  return { header, rows }
}
