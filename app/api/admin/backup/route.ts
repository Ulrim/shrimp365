import { NextRequest, NextResponse } from "next/server"
import { authorizeControl } from "@/lib/control-auth"
import {
  BACKUP_PAGE_SIZE, BACKUP_ROWS_PER_CALL, backupTable, sanitizeRow,
  type BackupChunk, type BackupTable,
} from "@/lib/admin-backup"

// 전체 백업 — 관리자 콘솔 /admin/backup 의 데이터(읽기 전용).
//
// 표 하나를 한 번에 최대 BACKUP_ROWS_PER_CALL 줄씩 내준다. 화면이 next 를 돌려보내며
// 끝까지 받아 CSV·ZIP 으로 묶는다(이유는 lib/admin-backup.ts 머리말).
//
// **총관리자만** 쓸 수 있다. 회원 전체의 데이터를 RLS 를 넘어(service role) 통째로
// 내주는 길이라 admin role 로는 열지 않는다 — role 은 DB 를 만질 수 있으면 부여할 수
// 있지만 총관리자 이메일은 하나뿐이다(lib/control-auth.ts). 아래 권한 확인이 유일한
// 방어선이므로, 확인 전에 데이터를 읽는 분기가 있어서는 안 된다.
//
// 내줄 수 있는 표는 lib/admin-backup.ts 의 목록뿐이고(임의의 표 이름을 받지 않는다),
// 비밀 값 칸은 sanitizeRow 가 뺀 뒤에 응답에 싣는다.
//
// 쿼리: table(목록의 이름), cursor(앞 응답의 next — 없으면 처음부터).

export const dynamic = "force-dynamic"
export const maxDuration = 60

type Admin = Extract<Awaited<ReturnType<typeof authorizeControl>>, { ok: true }>["admin"]
type Row = Record<string, unknown>

class BadCursor extends Error {}

/** 표가 이 DB 에 없다 — 마이그레이션을 아직 실행하지 않은 기능. 오류가 아니라 "없음"이다. */
function isMissingTable(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null
  if (e?.code === "PGRST205" || e?.code === "42P01") return true
  return typeof e?.message === "string" && /could not find the table|relation .* does not exist/i.test(e.message)
}

/** 단일 열 키 — `키 > 마지막 값` 으로 이어 읽는다. cursor: "k:<마지막 키>". */
async function readKeyset(admin: Admin, table: BackupTable, column: string, cursor: string | null) {
  let last: string | null = null
  if (cursor !== null) {
    if (!cursor.startsWith("k:") || cursor.length > 300) throw new BadCursor()
    last = cursor.slice(2)
  }
  const rows: Row[] = []
  let done = false
  while (rows.length < BACKUP_ROWS_PER_CALL) {
    let qb = admin.from(table.name).select("*").order(column, { ascending: true }).limit(BACKUP_PAGE_SIZE)
    if (last !== null) qb = qb.gt(column, last)
    const { data, error } = await qb
    if (error) throw error
    const page = (data ?? []) as Row[]
    // 끝은 "빈 묶음"으로만 판단한다. 서버의 최대 행 설정이 BACKUP_PAGE_SIZE 보다 작으면
    // 짧은 묶음이 끝이 아닐 수 있어서다 — 짧다고 멈추면 조용히 잘린 백업이 된다.
    if (page.length === 0) { done = true; break }
    const key = page[page.length - 1][column]
    if (typeof key !== "string" && typeof key !== "number") throw new Error(`${table.name}.${column} 키를 읽을 수 없습니다`)
    last = String(key)
    rows.push(...page)
  }
  return { rows, next: done ? null : `k:${last}` }
}

/** 여러 열 키 — 키 순서로 정렬해 건너뛰며 읽는다. cursor: "o:<건너뛸 줄 수>". */
async function readOffset(admin: Admin, table: BackupTable, order: string[], cursor: string | null) {
  let offset = 0
  if (cursor !== null) {
    if (!/^o:\d{1,12}$/.test(cursor)) throw new BadCursor()
    offset = Number(cursor.slice(2))
  }
  const rows: Row[] = []
  let done = false
  while (rows.length < BACKUP_ROWS_PER_CALL) {
    let qb = admin.from(table.name).select("*")
    for (const column of order) qb = qb.order(column, { ascending: true })
    const { data, error } = await qb.range(offset, offset + BACKUP_PAGE_SIZE - 1)
    if (error) throw error
    const page = (data ?? []) as Row[]
    if (page.length === 0) { done = true; break }
    offset += page.length
    rows.push(...page)
  }
  return { rows, next: done ? null : `o:${offset}` }
}

/** 인증 계정 — 이메일·가입 시각 등 표에 없는 값. cursor: "p:<쪽 번호>". */
async function readAuthUsers(admin: Admin, cursor: string | null) {
  let page = 1
  if (cursor !== null) {
    if (!/^p:\d{1,7}$/.test(cursor)) throw new BadCursor()
    page = Number(cursor.slice(2))
    if (page < 1) throw new BadCursor()
  }
  const rows: Row[] = []
  let done = false
  while (rows.length < BACKUP_ROWS_PER_CALL) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: BACKUP_PAGE_SIZE })
    if (error) throw error
    const users = data?.users ?? []
    if (users.length === 0) { done = true; break }
    page += 1
    for (const u of users) {
      // 필요한 칸만 고른다 — 사용자 객체 전체(메타데이터·식별자 묶음)를 싣지 않는다.
      rows.push({
        id: u.id,
        email: u.email ?? null,
        phone: u.phone || null,
        providers: Array.isArray(u.app_metadata?.providers) ? u.app_metadata.providers.join(" ") : (u.app_metadata?.provider ?? null),
        created_at: u.created_at ?? null,
        email_confirmed_at: u.email_confirmed_at ?? null,
        last_sign_in_at: u.last_sign_in_at ?? null,
      })
    }
  }
  return { rows, next: done ? null : `p:${page}` }
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

export async function GET(req: NextRequest) {
  // 1·2. 로그인·권한 — 총관리자(이메일)만.
  const auth = await authorizeControl(req)
  if (!auth.ok) return auth.res
  if (auth.role !== "super_admin") return json({ error: "Forbidden" }, 403)

  // 3. 입력 — 목록에 있는 표만.
  const table = backupTable(req.nextUrl.searchParams.get("table") ?? "")
  if (!table) return json({ error: "bad_request", message: "내보낼 수 없는 표입니다" }, 400)
  const cursor = req.nextUrl.searchParams.get("cursor")

  // 누가 언제 받아 갔는지 서버 기록에 남긴다. 이어 받는 호출도 빠짐없이 적는다 —
  // 첫 호출만 적으면 cursor 를 직접 넣어 기록 없이 받을 수 있다.
  console.info(`[admin/backup] ${auth.email} → ${table.name}${cursor === null ? "" : " (이어 받기)"}`)

  try {
    const { paging } = table
    const result = paging.kind === "keyset" ? await readKeyset(auth.admin, table, paging.column, cursor)
      : paging.kind === "offset" ? await readOffset(auth.admin, table, paging.order, cursor)
      : await readAuthUsers(auth.admin, cursor)
    const chunk: BackupChunk = {
      table: table.name,
      rows: result.rows.map(r => sanitizeRow(table, r)),
      next: result.next,
    }
    return json(chunk)
  } catch (err) {
    if (err instanceof BadCursor) return json({ error: "bad_request", message: "cursor 가 올바르지 않습니다" }, 400)
    if (isMissingTable(err)) {
      const chunk: BackupChunk = { table: table.name, rows: [], next: null, missing: true }
      return json(chunk)
    }
    console.error(`[admin/backup] ${table.name}`, err)
    return json({ error: "failed", message: "읽지 못했습니다" }, 500)
  }
}
