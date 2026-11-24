import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { createAdminClient } from "@/lib/supabase-server"

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 })

  try {
    const admin = createAdminClient()

    // 현장관리(dw_) 기록은 탈퇴 뒤에도 남으므로, 계정을 지우기 전에 그 구성원의 개인정보를 지운다.
    // 현장관리 SQL 을 아직 적용하지 않은 DB(함수 없음)나 구성원이 아닌 계정은 그냥 지나간다.
    // 여기서 실패해도 탈퇴는 막지 않는다 — dw_profiles 는 auth.users 에 묶여 있지 않아 삭제는 성공한다.
    try {
      const { error: anonymizeError } = await admin.rpc("dw_anonymize_member", { p_user: user.id })
      if (anonymizeError && anonymizeError.code !== "PGRST202" && anonymizeError.code !== "42883") {
        console.error("[account/delete] 현장관리 익명화 실패:", anonymizeError.code, anonymizeError.message)
      }
    } catch (err) {
      console.error("[account/delete] 현장관리 익명화 실패:", err)
    }

    // Cascade deletes for user data (farms → tanks → water_quality, etc.) are handled by DB FK ON DELETE CASCADE
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[account/delete] Error:", err)
    return NextResponse.json({ error: "계정 삭제에 실패했습니다." }, { status: 500 })
  }
}
