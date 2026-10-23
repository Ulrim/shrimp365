// 관리자 콘솔 "수질 기록"(/admin/readings) — 응답 모양·쿼리 해석·CSV 를 한 곳에 둔다.
//
// API(app/api/admin/readings)와 화면(components/admin/readings-view.tsx), 목데이터가
// 함께 쓴다. 서버 전용 코드가 없는 순수 함수뿐이라 브라우저에서도 안전하다.
// 출처 판정 규칙은 lib/wq-source.ts 에 있다.
import { WQ_SOURCE_FILTERS, type WqSourceFilter, type WqSourceKind } from "@/lib/wq-source"

export const READINGS_PAGE_SIZE = 50
export const READINGS_CSV_MAX = 5000
export const READINGS_DEFAULT_DAYS = 30
export const READINGS_MAX_RANGE_DAYS = 366
/** 사용자·농장으로 거른 수조가 이보다 많으면 400 too_many_tanks(`.in()` URL 길이). */
export const READINGS_MAX_TANKS = 300

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
/** 한국 표준시 — 일광절약시간이 없어 고정 오프셋으로 충분하다. */
const KST_OFFSET_MS = 9 * HOUR_MS

// ─── 응답 모양 ───────────────────────────────────────────────────────────────

export const WQ_VALUE_KEYS = [
  "temperature", "ph", "do_level", "salinity", "ammonia", "nitrite", "nitrate",
  "alkalinity", "turbidity", "conductivity", "flow_rate", "diff_pressure",
] as const
export type WqValueKey = (typeof WQ_VALUE_KEYS)[number]
export type WqValues = Record<WqValueKey, number | null>

/** 항목 이름·단위 — 표 머리와 CSV 머리가 함께 쓴다. */
export const WQ_VALUE_META: Record<WqValueKey, { label: string; short: string; unit: string }> = {
  temperature:   { label: "수온",     short: "수온",   unit: "°C" },
  ph:            { label: "pH",       short: "pH",     unit: "" },
  do_level:      { label: "용존산소", short: "DO",     unit: "mg/L" },
  salinity:      { label: "염도",     short: "염도",   unit: "‰" },
  ammonia:       { label: "암모니아", short: "암모니아", unit: "mg/L" },
  nitrite:       { label: "아질산",   short: "아질산", unit: "mg/L" },
  nitrate:       { label: "질산",     short: "질산",   unit: "mg/L" },
  alkalinity:    { label: "알칼리도", short: "알칼리도", unit: "mg/L" },
  turbidity:     { label: "탁도",     short: "탁도",   unit: "NTU" },
  conductivity:  { label: "전도도",   short: "전도도", unit: "uS/cm" },
  flow_rate:     { label: "유량",     short: "유량",   unit: "L/min" },
  diff_pressure: { label: "차압",     short: "차압",   unit: "kPa" },
}

export const SOURCE_LABEL: Record<WqSourceKind, string> = {
  manual: "수기",
  sensor: "센서",
  manual_guess: "수기(추정)",
}

export interface AdminReadingRow {
  id: string
  recorded_at: string
  created_at: string
  source_kind: WqSourceKind
  /** 센서 기록이고 장비가 남아 있을 때만. */
  device_name?: string
  tank_id: string
  tank_name: string
  farm_id: string
  farm_name: string
  farm_type: "shrimp" | "agriculture"
  owner_id: string
  owner_name: string
  values: WqValues
}

/** 사용자로 걸렀을 때 그 사용자의 농장·수조 — 화면의 농장/수조 선택지. */
export interface AdminReadingsScope {
  farms: { id: string; name: string; farm_type: "shrimp" | "agriculture"; tanks: { id: string; name: string }[] }[]
}

export interface AdminReadingsResponse {
  total: number
  page: number
  page_size: number
  rows: AdminReadingRow[]
  /** water_quality_readings.source 칸이 있는가(wq_source.sql 실행 여부). */
  has_source_column: boolean
  /** user 쿼리가 있을 때만. */
  scope?: AdminReadingsScope
}

// ─── 쿼리 해석(서버) ─────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/

export function isUuid(v: string): boolean {
  return UUID_RE.test(v)
}

export interface ReadingsQuery {
  user: string | null
  farm: string | null
  tank: string | null
  source: WqSourceFilter
  /** recorded_at >= from (ISO). */
  from: string
  /** recorded_at < to (ISO). null 이면 위쪽 경계 없음(장비 시계가 앞선 기록도 보이게). */
  to: string | null
  page: number
  format: "json" | "csv"
}

export type ParseResult = { ok: true; query: ReadingsQuery } | { ok: false; message: string }

/** "YYYY-MM-DD"(한국 날짜) 또는 시간대가 붙은 ISO 시각 → ms.
 *  날짜만 오면 그날 0시(KST). `end` 면 다음 날 0시(배타적 끝). 틀리면 null. */
export function parseDateParam(v: string, end: boolean): number | null {
  const d = DATE_RE.exec(v)
  if (d) {
    const [y, m, day] = [Number(d[1]), Number(d[2]), Number(d[3])]
    const utc = Date.UTC(y, m - 1, day)
    const check = new Date(utc)
    // 2026-02-30 같은 없는 날짜는 Date 가 다음 달로 넘겨 버린다 — 되짚어 막는다.
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== day) return null
    return utc - KST_OFFSET_MS + (end ? DAY_MS : 0)
  }
  if (DATETIME_RE.test(v)) {
    const t = Date.parse(v)
    if (!Number.isFinite(t)) return null
    return t + (end ? 1 : 0)
  }
  return null
}

function idParam(sp: URLSearchParams, key: string): string | null | undefined {
  const v = sp.get(key)?.trim()
  if (!v) return null
  return isUuid(v) ? v.toLowerCase() : undefined
}

export function parseReadingsQuery(sp: URLSearchParams, now: number): ParseResult {
  const user = idParam(sp, "user")
  const farm = idParam(sp, "farm")
  const tank = idParam(sp, "tank")
  if (user === undefined || farm === undefined || tank === undefined) {
    return { ok: false, message: "사용자·농장·수조 ID 형식이 올바르지 않습니다" }
  }

  const sourceRaw = sp.get("source")?.trim() || "all"
  if (!(WQ_SOURCE_FILTERS as readonly string[]).includes(sourceRaw)) {
    return { ok: false, message: "출처는 all·manual·sensor 중 하나여야 합니다" }
  }
  const source = sourceRaw as WqSourceFilter

  const fromRaw = sp.get("from")?.trim()
  const toRaw = sp.get("to")?.trim()
  const fromMs = fromRaw ? parseDateParam(fromRaw, false) : now - READINGS_DEFAULT_DAYS * DAY_MS
  const toMs = toRaw ? parseDateParam(toRaw, true) : null
  if (fromMs === null || (toRaw && toMs === null)) {
    return { ok: false, message: "날짜 형식이 올바르지 않습니다(YYYY-MM-DD)" }
  }
  const upper = toMs ?? now
  if (fromMs >= upper) return { ok: false, message: "시작일이 종료일보다 늦습니다" }
  if (upper - fromMs > READINGS_MAX_RANGE_DAYS * DAY_MS) {
    return { ok: false, message: `기간은 최대 ${READINGS_MAX_RANGE_DAYS}일입니다` }
  }

  const pageRaw = sp.get("page")?.trim() || "1"
  if (!/^\d{1,6}$/.test(pageRaw) || Number(pageRaw) < 1) {
    return { ok: false, message: "page 는 1 이상의 정수여야 합니다" }
  }

  const formatRaw = sp.get("format")?.trim() || "json"
  if (formatRaw !== "json" && formatRaw !== "csv") {
    return { ok: false, message: "format 은 csv 만 지원합니다" }
  }

  return {
    ok: true,
    query: {
      user, farm, tank, source,
      from: new Date(fromMs).toISOString(),
      to: toMs === null ? null : new Date(toMs).toISOString(),
      page: Number(pageRaw),
      format: formatRaw,
    },
  }
}

// ─── 화면 필터 ↔ 주소 ────────────────────────────────────────────────────────

export type ReadingsPeriod = "7" | "30" | "90" | "custom"
export const READINGS_PERIODS: { value: ReadingsPeriod; label: string }[] = [
  { value: "7", label: "7일" },
  { value: "30", label: "30일" },
  { value: "90", label: "90일" },
  { value: "custom", label: "직접" },
]

/** 화면 필터 — 주소(?user=&farm=&tank=&source=&days=|from=&to=&page=)가 원본이다. */
export interface ReadingsFilter {
  user: string
  farm: string
  tank: string
  source: WqSourceFilter
  period: ReadingsPeriod
  /** period === "custom" 일 때만. YYYY-MM-DD */
  from: string
  to: string
  page: number
}

export const DEFAULT_READINGS_FILTER: ReadingsFilter = {
  user: "", farm: "", tank: "", source: "all", period: "30", from: "", to: "", page: 1,
}

/** 화면 주소 → 필터. 너그럽게 읽는다(틀린 값은 기본값) — 검증은 서버가 한다.
 *  ID 는 형식을 보지 않는다: 목데이터 계정의 ID 는 UUID 가 아니다. */
export function filterFromSearch(sp: URLSearchParams): ReadingsFilter {
  const s = sp.get("source")
  const days = sp.get("days")
  const from = sp.get("from") ?? ""
  const to = sp.get("to") ?? ""
  const custom = !!(from || to)
  const page = Number(sp.get("page"))
  return {
    user: sp.get("user") ?? "",
    farm: sp.get("farm") ?? "",
    tank: sp.get("tank") ?? "",
    source: s === "manual" || s === "sensor" ? s : "all",
    period: custom ? "custom" : days === "7" || days === "90" ? days : "30",
    from: custom && DATE_RE.test(from) ? from : "",
    to: custom && DATE_RE.test(to) ? to : "",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  }
}

/** 필터 → 화면 주소 쿼리(기본값은 뺀다). */
export function filterToSearch(f: ReadingsFilter): URLSearchParams {
  const qs = new URLSearchParams()
  if (f.user) qs.set("user", f.user)
  if (f.farm) qs.set("farm", f.farm)
  if (f.tank) qs.set("tank", f.tank)
  if (f.source !== "all") qs.set("source", f.source)
  if (f.period === "custom") {
    if (f.from) qs.set("from", f.from)
    if (f.to) qs.set("to", f.to)
  } else if (f.period !== "30") {
    qs.set("days", f.period)
  }
  if (f.page > 1) qs.set("page", String(f.page))
  return qs
}

/** 필터 → API 쿼리. 프리셋 기간은 지금부터 N일 전 시각(ISO)으로, 직접 기간은 날짜 그대로. */
export function filterToApiSearch(f: ReadingsFilter, now: number, format?: "csv"): URLSearchParams {
  const qs = new URLSearchParams()
  if (f.user) qs.set("user", f.user)
  if (f.farm) qs.set("farm", f.farm)
  if (f.tank) qs.set("tank", f.tank)
  if (f.source !== "all") qs.set("source", f.source)
  if (f.period === "custom") {
    if (f.from) qs.set("from", f.from)
    if (f.to) qs.set("to", f.to)
  } else {
    qs.set("from", new Date(now - Number(f.period) * DAY_MS).toISOString())
  }
  if (format === "csv") qs.set("format", "csv")
  else qs.set("page", String(f.page))
  return qs
}

/** 필터의 기간 → [from, to) ms. 목데이터 거르기용(서버 해석과 같은 규칙). */
export function filterRange(f: ReadingsFilter, now: number): { from: number; to: number | null } {
  if (f.period !== "custom") return { from: now - Number(f.period) * DAY_MS, to: null }
  return {
    from: (f.from && parseDateParam(f.from, false)) || now - READINGS_DEFAULT_DAYS * DAY_MS,
    to: f.to ? parseDateParam(f.to, true) : null,
  }
}

// ─── 시각 ────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0")

/** ISO → "YYYY-MM-DD HH:mm"(KST). 브라우저 시간대와 무관하게 같은 글자. */
export function formatKst(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ""
  const d = new Date(t + KST_OFFSET_MS)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** KST 날짜(YYYY-MM-DD) — 지금 시각 기준 n일 전. 직접 기간 입력의 기본값. */
export function kstDateString(ms: number): string {
  return formatKst(new Date(ms).toISOString()).slice(0, 10)
}

/** "나중 입력" — 입력 시각이 측정 시각보다 1시간 넘게 늦고 **한국 날짜도 다를 때**.
 *
 *  수기 입력 폼은 측정 시각을 그날 12:00(또는 0시)로 저장한다 — 날짜만 고르기 때문이다.
 *  1시간 규칙만 쓰면 같은 날 오후에 적은 거의 모든 수기 기록이 "나중 입력"이 된다.
 *  그래서 날짜가 넘어간 경우만 표시한다(사후 입력 파악용). */
export function isLateEntry(recordedIso: string, createdIso: string): boolean {
  const r = Date.parse(recordedIso)
  const c = Date.parse(createdIso)
  if (!Number.isFinite(r) || !Number.isFinite(c)) return false
  if (c - r <= HOUR_MS) return false
  return formatKst(createdIso).slice(0, 10) > formatKst(recordedIso).slice(0, 10)
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

/** CSV 한 칸. 숫자는 그대로(수식이 될 수 없다). 글자는
 *  - `=` `+` `-` `@`(그리고 탭·CR)로 시작하면 앞에 `'` — 스프레드시트 수식 주입 방지
 *  - 쉼표·따옴표·줄바꿈이 있으면 큰따옴표로 감싸고 안의 `"` 는 `""` 로. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : ""
  let s = v
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

/** 머리 + 줄들 → CSV 글. 엑셀이 한글을 깨뜨리지 않게 UTF-8 BOM, 줄 끝은 CRLF. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [header, ...rows].map(r => r.map(csvCell).join(","))
  return `﻿${lines.join("\r\n")}\r\n`
}

export function readingsCsv(rows: AdminReadingRow[]): string {
  const header = [
    "측정 시각(KST)", "입력 시각(KST)", "출처", "기기", "사용자", "농장", "농장 유형", "수조/베드",
    ...WQ_VALUE_KEYS.map(k => {
      const m = WQ_VALUE_META[k]
      return m.unit ? `${m.label}(${m.unit})` : m.label
    }),
  ]
  const body = rows.map(r => [
    formatKst(r.recorded_at),
    formatKst(r.created_at),
    SOURCE_LABEL[r.source_kind],
    r.device_name ?? "",
    r.owner_name,
    r.farm_name,
    r.farm_type === "agriculture" ? "스마트팜" : "양식장",
    r.tank_name,
    ...WQ_VALUE_KEYS.map(k => r.values[k]),
  ])
  return toCsv(header, body)
}

export function readingsCsvFilename(now: number): string {
  return `water-quality-${kstDateString(now).replace(/-/g, "")}.csv`
}
