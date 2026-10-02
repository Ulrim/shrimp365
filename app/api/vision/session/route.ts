import { NextRequest } from "next/server"
import { UNAUTHORIZED, isVisionConfigured, requireSession } from "@/lib/vision-server"
import { STREAM_TOKEN_TTL_SECONDS, signStreamToken } from "@/lib/vision-token"

// 영상·실시간 연결에 필요한 준비물을 한 번에 내려 준다.
//
// **파이가 여러 대면 붙을 곳도 여러 곳이다.** CSI 카메라는 보드에 리본으로
// 직접 붙어 있어 그 보드에서만 열린다. 그래서 카메라마다 자기 장비 주소
// (vision_cameras.host_url)를 갖고, 여기서 장비별로 묶어 내려 준다.
// 전역 주소 하나로 보내면 첫 번째 장비의 카메라만 동작한다.
//
// 배포 형태에 따라 붙는 방식도 갈린다.
//
//  · **직결(direct)** — 장비가 공개 주소를 갖는 경우. Vercel 처럼 서버리스에
//    올린 배포는 이쪽이어야 한다. 서버리스 함수는 실행 시간 상한이 있어
//    끝나지 않는 MJPEG 응답을 중계할 수 없고, WebSocket 은 아예 중계하지 못한다.
//
//  · **중계(proxy)** — 웹과 비전이 같은 호스트에 있는 경우(NAS·자체 서버).
//    영상은 같은 출처라 <img> 가 쿠키를 보내므로 웹이 중계하고, 실시간
//    연결만 리버스 프록시가 넘긴다.
//
// 어느 쪽이든 자격 증명은 같다 — 이 사용자가 가진 카메라 id 만 담은 3분짜리
// 서명 토큰이다. 비전 서비스는 그 집합을 벗어난 요청을 잘라 낸다.

export const dynamic = "force-dynamic"

/** 카메라에 host_url 이 없을 때 쓰는 공개 주소. 없으면 중계 방식이다. */
function fallbackOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_VISION_PUBLIC_URL?.trim()
  if (!raw) return null
  // 끝의 / 를 떼어 둔다. 붙어 있으면 주소를 이을 때 //stream 이 된다.
  return raw.replace(/\/+$/, "")
}

/** 같은 출처로 붙을 때의 실시간 경로(리버스 프록시가 /ws 로 넘긴다). */
function proxyWsPath(): string {
  return process.env.NEXT_PUBLIC_VISION_WS_PATH || "/vision-ws"
}

export async function GET(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return UNAUTHORIZED()

  const empty = {
    enabled: false, cameraIds: [], token: null,
    mode: "proxy" as const, streamBase: null, hosts: [],
  }
  if (!isVisionConfigured()) {
    // 설정 전에는 화면이 "준비 안 됨"을 조용히 보여 주면 된다. 오류가 아니다.
    return Response.json(empty)
  }

  // RLS 가 남의 카메라를 걸러 낸다.
  const { data, error } = await session.supabase
    .from("vision_cameras")
    .select("id, host_url")
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const cameras = data ?? []
  const cameraIds = cameras.map(c => c.id as string)
  const token = signStreamToken(cameraIds, session.userId)
  if (!token) return Response.json(empty)

  const fallback = fallbackOrigin()

  // 장비별로 묶는다. 파이가 한 대뿐이면 묶음도 하나 — 지금까지와 같다.
  const byHost = new Map<string, string[]>()
  for (const camera of cameras) {
    const base = ((camera.host_url as string | null)?.replace(/\/+$/, "")) || fallback || ""
    byHost.set(base, [...(byHost.get(base) ?? []), camera.id as string])
  }

  const hosts = [...byHost.entries()].map(([base, ids]) => ({
    // 절대 주소(wss://vision-1…/ws) 또는 같은 출처 경로(/vision-ws).
    wsUrl: base ? `${base.replace(/^http/, "ws")}/ws` : proxyWsPath(),
    cameraIds: ids,
  }))

  return Response.json(
    {
      enabled: true,
      cameraIds,
      token,
      mode: fallback || cameras.some(c => c.host_url) ? "direct" : "proxy",
      // 카메라에 host_url 이 없을 때 쓰는 기본 영상 주소.
      // 카메라별 주소는 화면이 camera.host_url 에서 직접 읽는다.
      streamBase: fallback,
      hosts,
      expiresIn: STREAM_TOKEN_TTL_SECONDS,
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
