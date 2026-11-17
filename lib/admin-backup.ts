// 관리자 콘솔 "전체 백업"(/admin/backup) — 무엇을 어떻게 내보내는지를 한 곳에 둔다.
// 서버(app/api/admin/backup)와 화면(components/admin/backup-view.tsx)이 함께 쓴다.
//
// 내보내는 방식: 화면이 표 하나씩, 한 번에 최대 BACKUP_ROWS_PER_CALL 줄씩 서버에서
// 받아 CSV 로 바꾸고 브라우저에서 ZIP 으로 묶는다. 서버가 통째로 만들어 주지 않는
// 이유는 응답 크기·실행 시간 제한(서버리스) 때문이다 — 누적 기록이 많아도 끊기지 않는다.
//
// **비밀 값은 내보내지 않는다.** 장비 키·페어링 코드·푸시 구독 같은 값은 백업 파일이
// 새면 곧바로 장비·계정 탈취로 이어진다. 두 겹으로 막는다:
//   1) 표 단위 — 아래 목록(BACKUP_TABLES)에 없는 표는 요청해도 주지 않는다.
//   2) 칸 단위 — 표마다 적은 exclude + 이름으로 거르는 isSecretColumn().
// 이 파일은 다른 모듈을 import 하지 않는다(scripts/verify-backup.mjs 가 단독으로 검증).

export type BackupGroupKey = "members" | "farm" | "sensor" | "community" | "mrv"

export const BACKUP_GROUPS: { key: BackupGroupKey; label: string; hint: string }[] = [
  { key: "members", label: "회원", hint: "계정(이메일)·프로필" },
  { key: "farm", label: "농장 운영", hint: "농장·수조·일지·진단·사육 주기·수확·비용·재고" },
  { key: "sensor", label: "센서·장비", hint: "수질 기록·전력·관수·비전 계수·위험 판정" },
  { key: "community", label: "커뮤니티·콘텐츠", hint: "게시판·댓글·카드뉴스" },
  { key: "mrv", label: "탄소 MRV", hint: "조직·사이트·계측·KPI·보고서·감사 기록" },
]

/** 줄을 나눠 읽는 방법.
 *  - keyset: 단일 열 기본 키로 `> 마지막 값` 을 이어 읽는다(표가 커도 느려지지 않는다).
 *  - offset: 기본 키가 여러 열인 표. 키 순서로 정렬해 건너뛰며 읽는다.
 *  - auth:   표가 아니라 인증 계정 목록(auth.users) — 이메일은 여기에만 있다. */
export type BackupPaging =
  | { kind: "keyset"; column: string }
  | { kind: "offset"; order: string[] }
  | { kind: "auth" }

export type BackupTable = {
  name: string
  label: string
  group: BackupGroupKey
  paging: BackupPaging
  /** 내보내지 않는 칸(비밀 값·지나치게 큰 값). */
  exclude?: string[]
}

const id: BackupPaging = { kind: "keyset", column: "id" }

export const BACKUP_TABLES: BackupTable[] = [
  // ── 회원 ──
  { name: "auth_users", label: "회원 계정(이메일)", group: "members", paging: { kind: "auth" } },
  { name: "profiles", label: "프로필", group: "members", paging: id },

  // ── 농장 운영 ──
  { name: "farms", label: "농장", group: "farm", paging: id },
  { name: "tanks", label: "수조·베드", group: "farm", paging: id },
  { name: "farm_viewers", label: "농장 열람 권한", group: "farm", paging: { kind: "offset", order: ["farm_id", "user_id"] } },
  { name: "farm_geocodes", label: "농장 좌표", group: "farm", paging: { kind: "keyset", column: "farm_id" } },
  { name: "journal_entries", label: "일지", group: "farm", paging: id },
  { name: "diagnosis_results", label: "질병 진단", group: "farm", paging: id },
  { name: "alerts", label: "알림", group: "farm", paging: id },
  { name: "production_cycles", label: "사육 주기", group: "farm", paging: id },
  { name: "growth_samples", label: "성장 샘플링", group: "farm", paging: id },
  { name: "cycle_harvests", label: "수확", group: "farm", paging: id },
  { name: "cycle_costs", label: "주기 비용", group: "farm", paging: id },
  { name: "inventory_items", label: "재고 품목", group: "farm", paging: id },
  { name: "inventory_transactions", label: "재고 입출고", group: "farm", paging: id },

  // ── 센서·장비 ──
  { name: "water_quality_readings", label: "수질 기록", group: "sensor", paging: id },
  { name: "sensor_devices", label: "센서 장비", group: "sensor", paging: id, exclude: ["api_key"] },
  { name: "power_readings", label: "전력 측정", group: "sensor", paging: id },
  { name: "power_commands", label: "전력 제어 명령", group: "sensor", paging: id },
  { name: "power_control_state", label: "전력 제어 상태", group: "sensor", paging: { kind: "keyset", column: "device_id" } },
  { name: "irrigation_readings", label: "관수 측정", group: "sensor", paging: id },
  { name: "field_risk_judgements", label: "현장 위험 판정", group: "sensor", paging: id },
  // stream_url 은 rtsp://사용자:암호@… 꼴로 접속 정보를 품는 일이 많다.
  { name: "vision_cameras", label: "비전 카메라", group: "sensor", paging: id, exclude: ["api_key", "stream_url"] },
  // notify_webhook 은 주소 자체가 열쇠다(아는 사람은 누구나 보낼 수 있다).
  { name: "vision_alert_configs", label: "비전 알림 설정", group: "sensor", paging: id, exclude: ["notify_webhook"] },
  // image 는 사진 원본(base64)이라 CSV 에 맞지 않는다 — 시각·계수 값만 담는다.
  { name: "vision_snapshots", label: "비전 스냅샷(사진 제외)", group: "sensor", paging: { kind: "keyset", column: "camera_id" }, exclude: ["image"] },
  { name: "count_records", label: "비전 계수 기록", group: "sensor", paging: { kind: "offset", order: ["camera_id", "time"] } },

  // ── 커뮤니티·콘텐츠 ──
  { name: "board_posts", label: "게시글", group: "community", paging: id },
  { name: "board_comments", label: "댓글", group: "community", paging: id },
  { name: "board_post_likes", label: "게시글 좋아요", group: "community", paging: { kind: "offset", order: ["post_id", "user_id"] } },
  { name: "card_news", label: "카드뉴스", group: "community", paging: id },
  { name: "card_news_likes", label: "카드뉴스 좋아요", group: "community", paging: { kind: "offset", order: ["card_news_id", "user_id"] } },

  // ── 탄소 MRV ──
  { name: "mrv_organizations", label: "조직", group: "mrv", paging: id },
  { name: "mrv_users", label: "MRV 사용자", group: "mrv", paging: id },
  { name: "mrv_sites", label: "사이트", group: "mrv", paging: id },
  { name: "mrv_tanks", label: "수조", group: "mrv", paging: id },
  { name: "mrv_batches", label: "배치", group: "mrv", paging: id },
  { name: "mrv_meters", label: "계측기", group: "mrv", paging: id },
  { name: "mrv_readings", label: "계측 기록", group: "mrv", paging: { kind: "offset", order: ["time", "meter_id"] } },
  { name: "mrv_feed_logs", label: "급이 기록", group: "mrv", paging: id },
  { name: "mrv_mortality_logs", label: "폐사 기록", group: "mrv", paging: id },
  { name: "mrv_harvest_logs", label: "수확 기록", group: "mrv", paging: id },
  { name: "mrv_kpi_config", label: "KPI 설정", group: "mrv", paging: id },
  { name: "mrv_kpi_snapshots", label: "KPI 스냅샷", group: "mrv", paging: id },
  { name: "mrv_baselines", label: "기준선", group: "mrv", paging: id },
  { name: "mrv_emission_factors", label: "배출계수", group: "mrv", paging: id },
  { name: "mrv_contractual_instruments", label: "전력 계약 수단", group: "mrv", paging: id },
  { name: "mrv_recipes", label: "제어 레시피", group: "mrv", paging: id },
  { name: "mrv_recipe_versions", label: "레시피 버전", group: "mrv", paging: id },
  { name: "mrv_control_actions", label: "제어 조치", group: "mrv", paging: id },
  { name: "mrv_sop_checklist_runs", label: "SOP 점검", group: "mrv", paging: id },
  { name: "mrv_experiments", label: "실험", group: "mrv", paging: id },
  { name: "mrv_alerts", label: "MRV 알림", group: "mrv", paging: id },
  { name: "mrv_reports", label: "보고서", group: "mrv", paging: id },
  { name: "mrv_report_templates", label: "보고서 양식", group: "mrv", paging: id },
  { name: "mrv_report_schedules", label: "보고서 예약", group: "mrv", paging: id },
  { name: "mrv_report_deliveries", label: "보고서 발송", group: "mrv", paging: id },
  { name: "mrv_audit_logs", label: "감사 기록", group: "mrv", paging: id },
]

/** 일부러 뺀 표 — 안내문(백업 안의 설명 파일·화면)에 그대로 적는다. */
export const BACKUP_EXCLUDED_TABLES: { name: string; reason: string }[] = [
  { name: "push_subscriptions", reason: "푸시 알림 구독 키" },
  { name: "sensor_pairings", reason: "센서 페어링 코드·비밀 값" },
  { name: "vision_pairings", reason: "카메라 페어링 코드·비밀 값" },
  { name: "mrv_device_pairings", reason: "MRV 장비 페어링 코드·발급 키" },
  { name: "mrv_api_keys", reason: "MRV API 키" },
]

export function backupTable(name: string): BackupTable | undefined {
  return BACKUP_TABLES.find(t => t.name === name)
}

/** 이름만으로 비밀 값이라 볼 칸. 표마다 적은 exclude 가 빠뜨려도(나중에 칸이
 *  추가돼도) 새지 않게 하는 두 번째 그물이다. */
export function isSecretColumn(column: string): boolean {
  return /(^|_)(api_key|secret|password|passwd|token|key_hash|issued_key|p256dh|private_key)($|_)/i.test(column)
}

/** 내보내도 되는 칸만 남긴다. */
export function sanitizeRow(table: BackupTable, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (table.exclude?.includes(k) || isSecretColumn(k)) continue
    out[k] = v
  }
  return out
}

// ─── 서버 ↔ 화면 ─────────────────────────────────────────────────────────────

/** DB 에 한 번 묻는 줄 수(PostgREST 기본 최대 행). */
export const BACKUP_PAGE_SIZE = 1000
/** API 한 번 호출이 돌려주는 최대 줄 수 — 응답이 수 MB 를 넘지 않게 한다. */
export const BACKUP_ROWS_PER_CALL = 5000

export type BackupChunk = {
  table: string
  rows: Record<string, unknown>[]
  /** 이어 받을 위치. 끝이면 null. 화면은 뜻을 모르고 그대로 돌려보낸다. */
  next: string | null
  /** 이 DB 에 표가 없다(마이그레이션을 아직 실행하지 않음). */
  missing?: boolean
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

/** CSV 한 칸. 객체·배열(jsonb)은 JSON 글로. 글자는 lib/admin-readings.ts 의
 *  csvCell 과 같은 규칙 — 수식으로 읽힐 첫 글자 앞에 `'`, 쉼표·따옴표·줄바꿈은 감싼다. */
export function backupCell(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : ""
  if (typeof v === "boolean") return v ? "true" : "false"
  let s = typeof v === "string" ? v : JSON.stringify(v) ?? ""
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

/** CSV 한 줄(줄 끝 CRLF 포함). */
export function backupCsvLine(cells: unknown[]): string {
  return `${cells.map(backupCell).join(",")}\r\n`
}

/** 줄들 → CSV 글 조각. 머리(columns)에 없는 칸은 버리고, 없는 값은 빈 칸. */
export function backupCsvRows(columns: string[], rows: Record<string, unknown>[]): string {
  return rows.map(r => backupCsvLine(columns.map(c => r[c]))).join("")
}

/** 첫 묶음에서 머리를 정한다 — 처음 나온 순서대로, 모든 줄의 칸을 합친다. */
export function backupColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k)
  return [...seen]
}

/** 파일 이름에 쓰는 한국 시각 "YYYYMMDD-HHmm". */
export function backupStamp(now: number): string {
  const kst = new Date(now + 9 * 3_600_000).toISOString()
  return `${kst.slice(0, 10).replace(/-/g, "")}-${kst.slice(11, 16).replace(":", "")}`
}

export function backupFilename(now: number): string {
  return `shrimp365-backup-${backupStamp(now)}.zip`
}
