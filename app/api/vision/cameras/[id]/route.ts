import { NextRequest } from "next/server"
import { NOT_FOUND, UNAUTHORIZED, ownsCamera, passThrough, requireSession, visionFetch } from "@/lib/vision-server"

// 카메라 단건 수정·삭제. 소유 확인을 통과한 요청만 비전 서비스로 넘긴다.

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const session = await requireSession(req)
  if (!session) return UNAUTHORIZED()
  if (!(await ownsCamera(session.supabase, id))) return NOT_FOUND()

  const body = await req.json().catch(() => null)
  if (!body) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 })
  // tank_id 는 바꿀 수 없다. 카메라를 다른 수조로 옮기면 그동안 쌓인 개체수
  // 기록이 어느 수조 것인지 어긋난다. 옮기려면 지우고 새로 단다.
  delete body.tank_id

  const res = await visionFetch(`/api/v1/cameras/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return passThrough(res)
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const session = await requireSession(req)
  if (!session) return UNAUTHORIZED()
  if (!(await ownsCamera(session.supabase, id))) return NOT_FOUND()

  const res = await visionFetch(`/api/v1/cameras/${id}`, { method: "DELETE" })
  return passThrough(res)
}
