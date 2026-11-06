import { NextRequest } from "next/server"
import {
  NOT_FOUND, UNAUTHORIZED, ownedCameraIds, ownsTank, passThrough, requireSession, visionFetch,
} from "@/lib/vision-server"

// 카메라 목록·등록.
//
// 목록은 비전 서비스를 부르지 않고 Supabase 에서 바로 읽는다 — RLS 가 남의
// 카메라를 걸러 주므로 여기가 더 짧고 더 안전하다. 등록·수정처럼 **돌고 있는
// 스트림에 영향을 주는 일**만 비전 서비스로 넘긴다.

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return UNAUTHORIZED()

  const tankId = req.nextUrl.searchParams.get("tank_id")
  // ⚠ select("*") 를 쓰면 안 된다 — api_key(기기 키)까지 브라우저로 나간다.
  //   그 키를 쥔 쪽은 그 카메라 행세를 할 수 있다. 화면에 필요한 열만 고른다.
  let query = session.supabase
    .from("vision_cameras")
    .select(
      "id, tank_id, name, camera_type, stream_url, resolution_w, resolution_h," +
      " fps_target, is_active, install_height, tank_area_m2, serial, firmware," +
      " agent_version, last_seen_at, host_url, created_at," +
      " tanks(name, farm_id, farms(name))"
    )
    .order("created_at", { ascending: true })
  if (tankId) query = query.eq("tank_id", tankId)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return UNAUTHORIZED()

  const body = await req.json().catch(() => null)
  if (!body || typeof body.tank_id !== "string") {
    return Response.json({ error: "tank_id가 필요합니다." }, { status: 400 })
  }
  // 남의 수조에 카메라를 다는 것을 막는다. 비전 서비스는 수조가 존재하는지만
  // 보고 누구 것인지는 보지 않으므로, 소유 확인은 반드시 여기서 끝내야 한다.
  if (!(await ownsTank(session.supabase, body.tank_id))) return NOT_FOUND()

  const res = await visionFetch("/api/v1/cameras", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return passThrough(res)
}

// 화면이 실시간 연결을 열기 전에 "내 카메라가 몇 대인지"를 알아야 해서 열어 둔다.
export async function HEAD(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return new Response(null, { status: 401 })
  const ids = await ownedCameraIds(session.supabase)
  return new Response(null, { status: 200, headers: { "X-Camera-Count": String(ids.length) } })
}
