import { NextRequest } from "next/server"
import { UNAUTHORIZED, isVisionConfigured, ownedCameraIds, requireSession } from "@/lib/vision-server"
import { STREAM_TOKEN_TTL_SECONDS, signStreamToken } from "@/lib/vision-token"

// 영상·실시간 연결에 필요한 준비물을 한 번에 내려 준다.
//
// 배포 형태에 따라 브라우저가 붙는 곳이 달라진다. 그 판단을 화면이 아니라
// 여기서 하고, 화면은 받은 주소를 그대로 쓴다.
//
//  · **직결(direct)** — 비전 서비스가 공개 주소를 갖는 경우.
//    Vercel 처럼 서버리스에 올린 배포는 이쪽이어야 한다. 서버리스 함수는
//    실행 시간 상한이 있어 끝나지 않는 MJPEG 응답을 중계할 수 없고(도중에
//    잘린다), WebSocket 은 아예 중계하지 못한다.
//
//  · **중계(proxy)** — 웹과 비전이 같은 호스트에 있는 경우(NAS·자체 서버).
//    영상은 같은 출처라 <img> 가 쿠키를 보내므로 웹이 중계하고, 실시간
//    연결만 리버스 프록시가 넘긴다.
//
// 어느 쪽이든 자격 증명은 같다 — 이 사용자가 가진 카메라 id 만 담은 3분짜리
// 서명 토큰이다. 비전 서비스는 그 집합을 벗어난 요청을 잘라 내므로, 토큰이
// 새어 나가도 남의 수조는 볼 수 없다.

export const dynamic = "force-dynamic"

/** 비전 서비스의 공개 주소(https://vision.example.com). 없으면 중계 방식이다. */
function publicOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_VISION_PUBLIC_URL?.trim()
  if (!raw) return null
  // 끝의 / 를 떼어 둔다. 붙어 있으면 주소를 이을 때 //stream 이 된다.
  return raw.replace(/\/+$/, "")
}

export async function GET(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return UNAUTHORIZED()

  if (!isVisionConfigured()) {
    // 설정 전에는 화면이 "준비 안 됨"을 조용히 보여 주면 된다. 오류가 아니다.
    return Response.json({
      enabled: false, cameraIds: [], token: null,
      mode: "proxy", streamBase: null, wsUrl: null,
    })
  }

  const cameraIds = await ownedCameraIds(session.supabase)
  const token = signStreamToken(cameraIds, session.userId)
  const origin = publicOrigin()

  return Response.json(
    {
      enabled: !!token,
      cameraIds,
      token,
      mode: origin ? "direct" : "proxy",
      // 직결이면 영상도 비전 호스트에서 바로 받는다. 중계면 null —
      // 화면이 같은 출처의 /api/vision/stream 을 쓴다.
      streamBase: origin,
      // 직결이면 절대 주소(wss://…), 중계면 같은 출처의 경로.
      wsUrl: origin
        ? `${origin.replace(/^http/, "ws")}/ws`
        : (process.env.NEXT_PUBLIC_VISION_WS_PATH || "/vision-ws"),
      expiresIn: STREAM_TOKEN_TTL_SECONDS,
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
