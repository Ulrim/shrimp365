/**
 * MRV 인증/테넌시 — 원본 `apps/api/app/deps.py` 의 이식본.
 *
 * 원본은 Bearer JWT 를 직접 검증해 `sub`(Supabase UUID)를 얻고, `users.supabase_user_id`
 * 로 우리 도메인의 org_id/role 을 조회했다(매 요청 DB 조회 — role/plan 을 토큰에 굽지
 * 않는다는 원칙). 이식본은 토큰 검증을 shrimp365 가 이미 쓰는 `@supabase/ssr` 쿠키 세션에
 * 맡기고(같은 Supabase 프로젝트이므로 계정이 그대로 공유된다 — ADR 0006 이 말한 "계정
 * 공유의 실체"), 그 뒤의 조회·연계 로직은 원본 그대로 옮긴다.
 *
 * 상태 코드와 문구를 원본에서 바꾸지 않았다. 화면(NotInvitedPage)이 403/409 를 구분해
 * 다른 안내를 띄우므로, 코드가 달라지면 안내가 조용히 어긋난다.
 */

import { NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { HttpError } from "./http"
import { T, mrvDb, newId, type MrvDb } from "./db"

export type MrvRole = "owner" | "operator" | "viewer"
export type MrvPlan = "START" | "PRO" | "ENTERPRISE"

/** 인증된 요청 컨텍스트. 원본 AuthContext + 플랜 게이팅용 plan. */
export type MrvAuth = {
  orgId: string
  role: MrvRole
  /** mrv_users.id — 감사 로그의 actor_id 가 이 값이다(Supabase UUID 가 아니다). */
  userId: string
  supabaseUserId: string
  plan: MrvPlan
  db: MrvDb
}

type UserRow = {
  id: string
  org_id: string
  role: MrvRole
  email: string
  supabase_user_id: string | null
}

/** 로그인한 Supabase 계정(없으면 401). 검증은 Supabase 가 하고 우리는 결과만 받는다. */
async function currentSupabaseUser(
  req: NextRequest,
): Promise<{ id: string; email: string | null }> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } },
  )
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new HttpError(401, "missing or invalid session")
  return { id: user.id, email: user.email ?? null }
}

/**
 * 첫 로그인 자동 연계(원본 `_lazy_link`).
 *
 *  - email 클레임 없음 → 403. 카카오처럼 이메일을 주지 않는 provider 가 여기 온다.
 *    0건 매칭과 원인이 다르므로 문구를 분리해, 운영자가 UID 선연계 초대로 안내할 수 있게 한다.
 *  - `email 일치 AND supabase_user_id IS NULL` 후보 0건 → 403(초대 없음).
 *  - 후보 1건 → supabase_user_id 를 채우고 감사 로그(action='link')를 남긴 뒤 그 행 반환.
 *  - 후보 2건 이상 → 409. **자동으로 하나를 고르지 않는다** — 잘못된 org 에 연결하는 것은
 *    멀티테넌시 사고와 같은 무게이므로 안전한 실패를 택한다.
 */
async function lazyLink(
  db: MrvDb,
  supabaseUid: string,
  email: string | null,
): Promise<UserRow> {
  if (!email) {
    throw new HttpError(
      403,
      "account has no email claim; ask your administrator to link " +
        "this account by supabase user id",
    )
  }

  const { data, error } = await db
    .from(T.users)
    .select("id, org_id, role, email, supabase_user_id")
    .eq("email", email)
    .is("supabase_user_id", null)
  if (error) throw error

  const candidates = (data ?? []) as UserRow[]
  if (candidates.length === 0) {
    throw new HttpError(403, "no invitation found for this account")
  }
  if (candidates.length > 1) {
    throw new HttpError(
      409,
      "ambiguous invitation across multiple organizations, contact administrator",
    )
  }

  const row = candidates[0]
  const { error: updateError } = await db
    .from(T.users)
    .update({ supabase_user_id: supabaseUid })
    .eq("id", row.id)
  if (updateError) throw updateError

  const { error: auditError } = await db.from(T.auditLogs).insert({
    id: newId("audit"),
    org_id: row.org_id,
    actor_id: row.id,
    entity: "users",
    entity_id: row.id,
    action: "link",
    diff_json: { before: null, after: { supabase_user_id: supabaseUid } },
  })
  if (auditError) throw auditError

  return { ...row, supabase_user_id: supabaseUid }
}

/**
 * 요청을 인증하고 org/role/plan 을 확정한다. 모든 MRV 라우트의 첫 줄이어야 한다.
 *
 * ⚠ 이 함수가 돌려주는 db 는 service-role 이라 RLS 를 우회한다. 따라서 여기서 확정한
 * orgId 로 질의를 좁히는 것이 그 경로의 유일한 방어선이다 — 확인 없이 조기 반환하는
 * 분기를 두어서는 안 된다(shrimp365 관제센터 라우트와 같은 규율).
 */
export async function authorizeMrv(req: NextRequest): Promise<MrvAuth> {
  const supabaseUser = await currentSupabaseUser(req)
  const db = mrvDb()

  const { data, error } = await db
    .from(T.users)
    .select("id, org_id, role, email, supabase_user_id")
    .eq("supabase_user_id", supabaseUser.id)
    .maybeSingle()
  if (error) throw error

  const row = (data as UserRow | null) ?? (await lazyLink(db, supabaseUser.id, supabaseUser.email))

  const { data: orgRow, error: orgError } = await db
    .from(T.organizations)
    .select("plan")
    .eq("id", row.org_id)
    .maybeSingle()
  if (orgError) throw orgError

  return {
    orgId: row.org_id,
    role: row.role,
    userId: row.id,
    supabaseUserId: supabaseUser.id,
    // 조직 행이 없으면(이론상 불가하나 방어적으로) START 로 취급해 게이팅한다.
    plan: ((orgRow as { plan?: MrvPlan } | null)?.plan ?? "START") as MrvPlan,
    db,
  }
}

const WRITER_ROLES: ReadonlySet<string> = new Set(["owner", "operator"])

/** owner/operator 만 통과(viewer 는 403). 상태 변경 엔드포인트의 권한 게이트. */
export function requireWriter(auth: MrvAuth): MrvAuth {
  if (!WRITER_ROLES.has(auth.role)) {
    throw new HttpError(403, "requires owner or operator role")
  }
  return auth
}

/**
 * owner 단독만 통과(operator/viewer 는 403).
 * requireWriter 는 "owner 한정" 계약에는 너무 관대하다(operator 까지 통과) — 조직 구성원
 * 초대처럼 owner 만 해야 하는 일에 쓴다.
 */
export function requireOwner(auth: MrvAuth): MrvAuth {
  if (auth.role !== "owner") throw new HttpError(403, "requires owner role")
  return auth
}

const PLAN_RANK: Record<MrvPlan, number> = { START: 0, PRO: 1, ENTERPRISE: 2 }

/**
 * 플랜 게이팅(PRO 이상 / ENTERPRISE 전용 엔드포인트).
 * 화면도 플랜에 따라 메뉴를 감추지만 그것은 UX 보조일 뿐이고, 여기가 최종 방어선이다
 * — 주소를 직접 쳐서 들어와도 이 게이트를 통과하지 못한다.
 */
export function requirePlan(auth: MrvAuth, ...allowed: MrvPlan[]): MrvAuth {
  const minRank = Math.min(...allowed.map((p) => PLAN_RANK[p]))
  if (PLAN_RANK[auth.plan] < minRank) {
    throw new HttpError(403, `requires plan: ${allowed.join(" or ")}`)
  }
  return auth
}
