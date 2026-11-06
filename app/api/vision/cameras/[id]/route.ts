import { NextRequest } from "next/server"
import { NOT_FOUND, UNAUTHORIZED, cameraHost, passThrough, requireSession, visionFetch } from "@/lib/vision-server"

// 카메라 단건 수정·삭제. 소유 확인을 통과한 요청만 비전 서비스로 넘긴다.

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const session = await requireSession(req)
  if (!session) return UNAUTHORIZED()
  // 설정이 바뀌면 그 장비가 스트림을 다시 띄워야 한다 — 그 장비로 보낸다.
  const baseUrl = await cameraHost(session.supabase, id)
  if (!baseUrl) return NOT_FOUND()

  const body = await req.json().catch(() => null)
  if (!body) return Response.json({ error: "잘못된 요청입니다." }, { status: 400 })
  // tank_id 는 바꿀 수 없다. 카메라를 다른 수조로 옮기면 그동안 쌓인 개체수
  // 기록이 어느 수조 것인지 어긋난다. 옮기려면 지우고 새로 단다.
  delete body.tank_id

  const res = await visionFetch(`/api/v1/cameras/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    baseUrl,
  })
  return passThrough(res)
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const session = await requireSession(req)
  if (!session) return UNAUTHORIZED()
  // 삭제는 그 장비가 스트림을 멈춘 뒤 행을 지워야 한다. 다른 장비로 보내면
  // 행만 사라지고 실제 파이는 없는 카메라로 계속 기록을 시도한다.
  const baseUrl = await cameraHost(session.supabase, id)
  if (!baseUrl) return NOT_FOUND()

  const res = await visionFetch(`/api/v1/cameras/${id}`, { method: "DELETE", baseUrl })
  return passThrough(res)
}
