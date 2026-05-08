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
    // Cascade deletes for user data (farms → tanks → water_quality, etc.) are handled by DB FK ON DELETE CASCADE
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "계정 삭제에 실패했습니다."
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
