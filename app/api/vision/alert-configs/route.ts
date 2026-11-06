import { NextRequest } from "next/server"
import { NOT_FOUND, UNAUTHORIZED, ownsCamera, passThrough, requireSession, visionFetch } from "@/lib/vision-server"

// 개체수 경보 설정 목록·등록.
//
// 목록은 Supabase 에서 바로 읽는다(RLS 가 본인 것만 돌려준다). 등록은 비전
// 서비스로 넘긴다 — 저장과 동시에 판정 엔진의 설정 캐시를 비워야 해서다.
// 여기서 DB 에 바로 넣으면 최대 15초 동안 새 설정이 안 먹는다.

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return UNAUTHORIZED()

  const { data, error } = await session.supabase
    .from("vision_alert_configs")
    .select("*")
    .order("created_at", { ascending: true })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return UNAUTHORIZED()

  const body = await req.json().catch(() => null)
  if (!body) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 })
  if (body.camera_id && !(await ownsCamera(session.supabase, body.camera_id))) {
    return NOT_FOUND()
  }

  const res = await visionFetch("/api/v1/alerts/configs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // 주인은 세션에서 정한다. 본문으로 받으면 남의 이름으로 설정을 만들 수 있다.
    body: JSON.stringify({ ...body, user_id: session.userId }),
  })
  return passThrough(res)
}
