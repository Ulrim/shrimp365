import { NextRequest } from "next/server"
import { UNAUTHORIZED, ownsCamera, passThrough, requireSession, visionFetch } from "@/lib/vision-server"
import type { SupabaseClient } from "@supabase/supabase-js"

// 경보 설정 수정·삭제.

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

const CONFIG_NOT_FOUND = () =>
  Response.json({ error: "경보 설정을 찾을 수 없습니다." }, { status: 404 })

/** 내 설정인가. RLS 가 남의 것을 걸러 주므로 조회되면 내 것이다. */
async function ownsConfig(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await supabase
    .from("vision_alert_configs")
    .select("id")
    .eq("id", id)
    .maybeSingle()
  return !!data
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params
  const session = await requireSession(req)
  if (!session) return UNAUTHORIZED()
  if (!(await ownsConfig(session.supabase, id))) return CONFIG_NOT_FOUND()

  const body = await req.json().catch(() => null)
  if (!body) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 })
  if (body.camera_id && !(await ownsCamera(session.supabase, body.camera_id))) {
    return CONFIG_NOT_FOUND()
  }

  const res = await visionFetch(`/api/v1/alerts/configs/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, user_id: session.userId }),
  })
  return passThrough(res)
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const session = await requireSession(req)
  if (!session) return UNAUTHORIZED()
  if (!(await ownsConfig(session.supabase, id))) return CONFIG_NOT_FOUND()

  const res = await visionFetch(`/api/v1/alerts/configs/${id}`, { method: "DELETE" })
  return passThrough(res)
}
