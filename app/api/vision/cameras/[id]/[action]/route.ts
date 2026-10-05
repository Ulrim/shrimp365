import { NextRequest } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { NOT_FOUND, UNAUTHORIZED, cameraHost, passThrough, requireSession, visionFetch } from "@/lib/vision-server"

// 카메라 동작: start / stop (POST), status / snapshot / frame (GET).
//
// 한 파일에 두는 이유는 소유 확인과 오류 처리가 완전히 같기 때문이다.
// 허용 목록을 명시해 임의의 경로가 비전 서비스로 흘러가지 않게 한다.
//
// snapshot 과 frame 은 **다른 길**이다. 헷갈리면 방향을 물으면 된다.
//
//   snapshot  지금 장비에 **물어본다**(브라우저 → 서버 → 장비). 가장 최신이지만
//             장비에 들어갈 수 있어야 한다 — 농장 공유기 뒤에서는 막힌다(NAT).
//   frame     장비가 **올려 둔** 사진을 DB 에서 읽는다. 최대 15초 늦지만
//             나가는 연결만 쓰므로 공유기를 그대로 두고 쓸 수 있다.
//
// 그래서 화면은 영상이 안 열릴 때 frame 으로 내려앉는다. frame 은 장비를
// 부르지 않으므로, 장비가 닿지 않는 곳에 있어도 10초짜리 타임아웃을 기다리지
// 않는다 — 몇 초마다 묻는 화면에서 그 차이가 전부다.

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string; action: string }> }

const POST_ACTIONS = new Set(["start", "stop"])
const GET_ACTIONS = new Set(["status", "snapshot", "frame"])

/** 로그인·소유 확인을 하고, 이 카메라를 맡은 장비의 주소를 돌려준다. */
async function authorize(req: NextRequest, id: string) {
  const session = await requireSession(req)
  if (!session) return { error: UNAUTHORIZED(), baseUrl: null, supabase: null }
  const baseUrl = await cameraHost(session.supabase, id)
  if (!baseUrl) return { error: NOT_FOUND(), baseUrl: null, supabase: null }
  return { error: null, baseUrl, supabase: session.supabase }
}

/**
 * 장비가 올려 둔 최신 사진. 없으면 204.
 *
 * 사진과 함께 찍힌 숫자를 헤더로 돌려준다 — 화면이 한 번 받아 사진과 개체수를
 * 같이 갱신할 수 있다. 본문을 JSON 으로 싸서 base64 를 담으면 전송량이 3분의 1
 * 늘고, `<img>` 에 바로 물릴 수도 없다.
 */
async function storedFrame(supabase: SupabaseClient, cameraId: string): Promise<Response> {
  // RLS 가 남의 카메라를 걸러 낸다(vision_snapshots_select_own). 위에서 이미
  // 소유를 확인했지만, 조회를 세션 클라이언트로 하면 그 판단이 한 곳에 더
  // 걸려 있게 된다 — 손으로 적은 조건이 언젠가 어긋나는 것보다 낫다.
  const { data, error } = await supabase
    .from("vision_snapshots")
    .select("image, taken_at, count, length_cm, width, height")
    .eq("camera_id", cameraId)
    .maybeSingle()

  if (error) {
    // 마이그레이션을 아직 안 돌렸으면 테이블이 없다. 화면은 "사진 없음"과
    // 똑같이 다루면 되므로(터널 안내를 띄운다) 204 로 조용히 내려앉는다.
    return new Response(null, { status: 204 })
  }
  if (!data?.image) return new Response(null, { status: 204 })

  const bytes = Buffer.from(data.image as string, "base64")
  const headers = new Headers({
    "Content-Type": "image/jpeg",
    // 캐시가 끼면 멈춘 사진을 본다. 몇 초마다 묻는 화면에서는 치명적이다.
    "Cache-Control": "no-store",
    "X-Frame-At": String(data.taken_at ?? ""),
  })
  if (data.count !== null && data.count !== undefined) {
    headers.set("X-Frame-Count", String(data.count))
  }
  if (data.length_cm !== null && data.length_cm !== undefined) {
    headers.set("X-Frame-Length-Cm", String(data.length_cm))
  }
  if (data.width && data.height) {
    headers.set("X-Frame-Size", `${data.width}x${data.height}`)
  }
  return new Response(bytes, { status: 200, headers })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id, action } = await params
  if (!POST_ACTIONS.has(action)) return NOT_FOUND()
  const { error, baseUrl } = await authorize(req, id)
  if (error) return error

  const res = await visionFetch(`/api/v1/cameras/${id}/${action}`, {
    method: "POST", baseUrl: baseUrl!,
  })
  return passThrough(res)
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id, action } = await params
  if (!GET_ACTIONS.has(action)) return NOT_FOUND()
  const { error, baseUrl, supabase } = await authorize(req, id)
  if (error) return error

  // 올려 둔 사진은 장비를 부르지 않는다. 장비가 닿지 않는 곳에 있을 때 이
  // 경로가 쓰이는 것이므로, 부르면 매번 타임아웃을 기다리게 된다.
  if (action === "frame") return storedFrame(supabase!, id)

  const res = await visionFetch(`/api/v1/cameras/${id}/${action}`, { baseUrl: baseUrl! })
  if (action !== "snapshot") return passThrough(res)

  // 스냅샷은 JPEG 이다. 실패했을 때만 JSON 이 온다.
  if (!res.ok) return passThrough(res)
  return new Response(await res.arrayBuffer(), {
    status: 200,
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
  })
}
