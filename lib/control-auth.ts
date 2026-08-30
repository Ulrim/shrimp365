import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { createAdminClient } from "@/lib/supabase-server"

/** 총 관리자 이메일. 매니저 선임·해임은 이 계정만 할 수 있다.
 *  환경변수로 바꿀 수 있게 두되, 비워 두면 기본값을 쓴다. */
export const SUPER_ADMIN_EMAIL =
  process.env.SUPER_ADMIN_EMAIL || "kjs100184@gmail.com"

export type ControlRole = "super_admin" | "manager"

/** 관제센터 호출자의 권한을 확인한다.
 *
 *  판별은 반드시 서버에서 한다. 화면의 role 값은 표시용일 뿐이고,
 *  브라우저에서 오는 어떤 값도 믿지 않는다 — 세션의 사용자로 profiles 를
 *  직접 조회한다.
 *
 *  총 관리자는 role 이 아니라 **이메일**로 판별한다. role='admin' 은 DB 를
 *  만질 수 있는 사람이 부여할 수 있지만, 이 이메일 계정은 하나뿐이고
 *  이미 가입되어 있어 다른 사람이 차지할 수 없다. 이렇게 하면 실수로
 *  admin 을 여러 명 만들어도 매니저 선임 권한은 넘어가지 않는다.
 */
export async function authorizeControl(req: NextRequest): Promise<
  | { ok: true; role: ControlRole; userId: string; email: string; admin: ReturnType<typeof createAdminClient> }
  | { ok: false; res: NextResponse }
> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) {
    return { ok: false, res: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }) }
  }
  // 이메일을 정규화해 둔다. 앞뒤 공백이 끼면 이메일 비교가 어긋나
  // 총 관리자가 매니저 취급으로 떨어질 수 있다.
  const email = user.email.trim().toLowerCase()

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, res: NextResponse.json({ error: "SERVICE_ROLE_KEY_NOT_SET" }, { status: 503 }) }
  }
  const admin = createAdminClient()

  if (email === SUPER_ADMIN_EMAIL.trim().toLowerCase()) {
    return { ok: true, role: "super_admin", userId: user.id, email: user.email, admin }
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  // admin 은 총 관리자 이메일이 아니어도 관제센터는 볼 수 있게 한다.
  // (선임·해임은 위에서 이메일로 걸러지므로 여기까지 오면 manager 취급)
  if (profile?.role === "manager" || profile?.role === "admin") {
    return { ok: true, role: "manager", userId: user.id, email: user.email, admin }
  }

  return { ok: false, res: NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 }) }
}
