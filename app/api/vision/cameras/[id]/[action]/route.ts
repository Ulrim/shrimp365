import { NextRequest } from "next/server"
import { NOT_FOUND, UNAUTHORIZED, ownsCamera, passThrough, requireSession, visionFetch } from "@/lib/vision-server"

// 카메라 동작: start / stop (POST), status / snapshot (GET).
//
// 네 갈래를 한 파일에 두는 이유는 소유 확인과 오류 처리가 완전히 같기 때문이다.
// 허용 목록을 명시해 임의의 경로가 비전 서비스로 흘러가지 않게 한다.

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string; action: string }> }

const POST_ACTIONS = new Set(["start", "stop"])
const GET_ACTIONS = new Set(["status", "snapshot"])

async function authorize(req: NextRequest, id: string) {
  const session = await requireSession(req)
  if (!session) return { error: UNAUTHORIZED() }
  if (!(await ownsCamera(session.supabase, id))) return { error: NOT_FOUND() }
  return { error: null }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id, action } = await params
  if (!POST_ACTIONS.has(action)) return NOT_FOUND()
  const { error } = await authorize(req, id)
  if (error) return error

  const res = await visionFetch(`/api/v1/cameras/${id}/${action}`, { method: "POST" })
  return passThrough(res)
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id, action } = await params
  if (!GET_ACTIONS.has(action)) return NOT_FOUND()
  const { error } = await authorize(req, id)
  if (error) return error

  const res = await visionFetch(`/api/v1/cameras/${id}/${action}`)
  if (action !== "snapshot") return passThrough(res)

  // 스냅샷은 JPEG 이다. 실패했을 때만 JSON 이 온다.
  if (!res.ok) return passThrough(res)
  return new Response(await res.arrayBuffer(), {
    status: 200,
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
  })
}
