// 수질 기록 출처 판정 — 한 곳에서만 한다(supabase/migrations/wq_source.sql 머리 주석).
//
// water_quality_readings 에는 출처 칸(source)이 wq_source.sql 로 생긴다. 그 전 DB 와
// 그 전에 저장된 기록을 함께 다뤄야 해서 규칙이 세 갈래다:
//   · source === "manual"               → 수기
//   · source === "sensor" 또는 device_id → 센서
//   · 그 외                              → "수기(추정)" — 수기이거나 device_id 이전 옛 센서 기록
// 이 파일은 서버·브라우저 어디서나 쓴다(의존 없음, 순수 함수).

export type WqSourceKind = "manual" | "sensor" | "manual_guess"
export type WqSourceFilter = "all" | "manual" | "sensor"

export const WQ_SOURCE_FILTERS: readonly WqSourceFilter[] = ["all", "manual", "sensor"]

export function wqSourceKind(row: { source?: string | null; device_id?: string | null }): WqSourceKind {
  if (row.source === "manual") return "manual"
  if (row.source === "sensor" || row.device_id) return "sensor"
  return "manual_guess"
}

/** 출처 필터 → PostgREST 조건.
 *
 *  - `or`: `.or()` 에 넘길 문자열(source 칸이 있을 때).
 *  - `deviceNull`: source 칸이 없는 DB 의 폴백 — device_id 가 NULL(true)/NOT NULL(false).
 *  - 둘 다 없으면 거르지 않는다(all).
 *
 *  manual 과 sensor 는 서로의 여집합이다(CHECK 로 source 는 NULL·manual·sensor 뿐).
 *  "수기(추정)"(source NULL, device_id NULL)은 수기 쪽에 든다. */
export function wqSourceCondition(
  filter: WqSourceFilter,
  hasSourceColumn: boolean,
): { or?: string; deviceNull?: boolean } {
  if (filter === "all") return {}
  if (!hasSourceColumn) return { deviceNull: filter === "manual" }
  return filter === "manual"
    ? { or: "source.eq.manual,and(source.is.null,device_id.is.null)" }
    : { or: "source.eq.sensor,and(source.is.null,device_id.not.is.null)" }
}

/** 판정 결과가 필터에 드는가 — 목데이터 거르기용(서버 조건과 같은 규칙). */
export function wqSourceMatches(kind: WqSourceKind, filter: WqSourceFilter): boolean {
  if (filter === "all") return true
  if (filter === "sensor") return kind === "sensor"
  return kind === "manual" || kind === "manual_guess"
}

/** Supabase 오류가 "그 칸이 없다"는 뜻인가 — 마이그레이션 전 DB 판정용.
 *  insert 는 PostgREST 스키마 캐시 오류(PGRST204), select·filter 는 Postgres 42703. */
export function isMissingColumnError(err: unknown, column: string): boolean {
  if (!err || typeof err !== "object") return false
  const { code, message } = err as { code?: unknown; message?: unknown }
  if (code === "PGRST204" || code === "42703") return true
  return typeof message === "string" && message.includes(column)
}
