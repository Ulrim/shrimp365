import { NextRequest, NextResponse } from "next/server"
import { authorizeControl, SUPER_ADMIN_EMAIL } from "@/lib/control-auth"

// 매니저 선임·해임. 총 관리자(고정 이메일)만 쓸 수 있다.
//
// 일반 사용자의 자가 승격은 DB 에서 이미 막혀 있고(profiles 는 name 만
// UPDATE 가능), 여기서는 service role 로 바꾸므로 이 라우트의 이메일
// 확인이 곧 방어선이다.

function forbidden() {
  return NextResponse.json({ error: "총 관리자만 매니저를 선임할 수 있습니다." }, { status: 403 })
}

// GET — 사용자 목록(이메일·역할). 선임 화면에 띄운다.
export async function GET(req: NextRequest) {
  const auth = await authorizeControl(req)
  if (!auth.ok) return auth.res
  if (auth.role !== "super_admin") return forbidden()

  try {
    // 사용자가 많아지면 한 페이지(1000)로는 부족하다. 끝까지 훑는다.
    type AuthUser = { id: string; email?: string; created_at?: string }
    const allUsers: AuthUser[] = []
    for (let page = 1; ; page++) {
      const { data, error } = await auth.admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) throw error
      allUsers.push(...data.users)
      if (data.users.length < 1000) break
    }
    const { data: profileRows } = await auth.admin.from("profiles").select("id, name, role")
    const roleOf = new Map((profileRows ?? []).map(p => [p.id as string, p]))

    const users = allUsers
      .map(u => {
        const p = roleOf.get(u.id)
        return {
          id: u.id,
          email: u.email ?? "",
          name: (p?.name as string) || "",
          role: (p?.role as string) || "farmer",
          is_super_admin: (u.email ?? "").trim().toLowerCase() === SUPER_ADMIN_EMAIL.trim().toLowerCase(),
          created_at: u.created_at ?? "",
        }
      })
      .sort((a, b) => {
        // 매니저·관리자를 위로 — 선임 화면에서 현재 구성을 먼저 본다.
        const rank = (r: string, sa: boolean) => (sa ? 0 : r === "admin" ? 1 : r === "manager" ? 2 : 3)
        return rank(a.role, a.is_super_admin) - rank(b.role, b.is_super_admin) || a.email.localeCompare(b.email)
      })

    return NextResponse.json({ users })
  } catch (e) {
    console.error("[control/managers]", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "목록을 불러오지 못했습니다." }, { status: 500 })
  }
}

// POST — { user_id, manager: true|false }  선임 또는 해임.
export async function POST(req: NextRequest) {
  const auth = await authorizeControl(req)
  if (!auth.ok) return auth.res
  if (auth.role !== "super_admin") return forbidden()

  let body: { user_id?: string; manager?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 })
  }
  if (typeof body.user_id !== "string" || typeof body.manager !== "boolean") {
    return NextResponse.json({ error: "user_id 와 manager 가 필요합니다." }, { status: 400 })
  }

  try {
    // 대상 확인 — 총 관리자 자신과 admin 계정은 건드리지 않는다.
    // 실수로 자기 권한을 내리면 아무도 매니저를 선임할 수 없게 된다.
    const { data: target } = await auth.admin.auth.admin.getUserById(body.user_id)
    if (!target?.user) {
      return NextResponse.json({ error: "대상 사용자를 찾을 수 없습니다." }, { status: 404 })
    }
    if ((target.user.email ?? "").trim().toLowerCase() === SUPER_ADMIN_EMAIL.trim().toLowerCase()) {
      return NextResponse.json({ error: "총 관리자의 권한은 바꿀 수 없습니다." }, { status: 400 })
    }
    const { data: targetProfile } = await auth.admin
      .from("profiles").select("role").eq("id", body.user_id).single()
    if (targetProfile?.role === "admin") {
      return NextResponse.json({ error: "관리자 계정의 권한은 여기서 바꿀 수 없습니다." }, { status: 400 })
    }

    // 해임할 때 원 역할로 되돌린다. viewer 였던 사람을 해임했다고 양식어가(farmer)로
    // 올려 주면 오히려 권한이 늘어난다. manager 였던 것만 farmer 로 내린다.
    const newRole = body.manager
      ? "manager"
      : (targetProfile?.role === "manager" ? "farmer" : (targetProfile?.role ?? "farmer"))

    const { error } = await auth.admin
      .from("profiles")
      .update({ role: newRole })
      .eq("id", body.user_id)
    if (error) throw error

    return NextResponse.json({ ok: true, role: newRole })
  } catch (e) {
    console.error("[control/managers]", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "변경하지 못했습니다." }, { status: 500 })
  }
}
