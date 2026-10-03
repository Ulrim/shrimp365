/**
 * POST /api/mrv/organizations/{orgId}/users — 조직 구성원 초대(owner 전용).
 * 원본: apps/api/app/routers/organizations.py::invite_user
 *
 * 이 시스템에는 셀프서비스 회원가입이 없다. 이 엔드포인트가 만드는 행 자체가 초대장이며,
 * supabase_user_id 가 비어 있으면 "초대는 됐으나 아직 첫 로그인 전"이라는 뜻이다.
 *
 * supabase_user_id 를 함께 주면 **선연계 초대**가 된다 — 카카오처럼 JWT 에 이메일이
 * 실리지 않는 계정은 이메일 기반 자동 연계를 탈 수 없어서, 관리자가 UID 로 미리 이어 준다.
 * 주지 않으면 동작은 기존과 완전히 같다.
 *
 * 실제 Supabase 계정 생성(초대 메일 발송)은 이 범위 밖이다.
 */

import { NextRequest, NextResponse } from "next/server"
import { authorizeMrv, requireOwner } from "@/lib/mrv/auth"
import { HttpError, handleRoute } from "@/lib/mrv/http"
import { T, newId } from "@/lib/mrv/db"
import { recordAudit } from "@/lib/mrv/audit"

const UNIQUE_VIOLATION = "23505"
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const ROLES = ["owner", "operator", "viewer"] as const

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  return handleRoute(async () => {
    const { orgId } = await params
    const auth = requireOwner(await authorizeMrv(req))
    // 남의 조직 경로로는 존재조차 알리지 않는다.
    if (orgId !== auth.orgId) throw new HttpError(404, "organization not found")

    const body = (await req.json()) as {
      email?: string
      role?: string
      supabase_user_id?: string | null
    }
    if (!body.email || !EMAIL_RE.test(body.email) || body.email.length > 320) {
      throw new HttpError(422, "a valid email is required")
    }
    if (!body.role || !(ROLES as readonly string[]).includes(body.role)) {
      throw new HttpError(422, `role must be one of ${ROLES.join(", ")}`)
    }
    const supabaseUserId = body.supabase_user_id ?? null
    if (supabaseUserId !== null && !UUID_RE.test(supabaseUserId)) {
      throw new HttpError(422, "supabase_user_id must be a UUID")
    }

    // 한 Supabase 계정이 두 조직에 연결되면 어느 조직 데이터를 보여야 할지 정할 수 없다.
    // 부분 유니크 인덱스가 최종 방어선이지만, 여기서 먼저 걸러 원인이 다른 409(이메일
    // 중복)와 메시지를 구분해 준다.
    if (supabaseUserId !== null) {
      const { data, error } = await auth.db
        .from(T.users)
        .select("id")
        .eq("supabase_user_id", supabaseUserId)
        .maybeSingle()
      if (error) throw error
      if (data) {
        throw new HttpError(409, "this supabase account is already linked to a user")
      }
    }

    const row = {
      id: newId("user"),
      org_id: orgId,
      email: body.email,
      role: body.role,
      supabase_user_id: supabaseUserId,
    }
    const { error } = await auth.db.from(T.users).insert(row)
    if (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new HttpError(
          409,
          "a user with this email already exists in this organization",
        )
      }
      throw error
    }

    const linked = supabaseUserId !== null
    await recordAudit(auth.db, {
      orgId,
      actorId: auth.userId,
      entity: "users",
      entityId: row.id,
      action: "invite",
      diff: {
        before: null,
        after: {
          email: row.email,
          role: row.role,
          linked,
          supabase_user_id: supabaseUserId,
        },
      },
    })

    return NextResponse.json(
      { id: row.id, org_id: orgId, email: row.email, role: row.role, linked },
      { status: 201 },
    )
  })
}
