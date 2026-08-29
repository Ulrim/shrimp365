import { NextRequest } from "next/server"
import { NOT_FOUND, UNAUTHORIZED, ownsCamera, requireSession, visionFetch } from "@/lib/vision-server"

// MJPEG 영상 중계 — <img src="/api/vision/stream/{id}"> 가 물고 있는 주소.
//
// 왜 중계하는가: <img> 는 헤더를 못 싣지만 **같은 출처의 쿠키는 보낸다.**
// 그래서 이 경로는 로그인 세션만으로 판정할 수 있다 — 브라우저에 토큰을
// 노출할 필요가 없다. (서명 토큰은 브라우저가 비전 서비스에 직접 붙는
// 경우에만 쓴다 — /api/vision/session 참고.)
//
// 응답은 multipart/x-mixed-replace 로 **끝나지 않는 스트림**이다. 그래서
// 타임아웃을 끄고(timeoutMs: 0) 본문을 그대로 흘려보낸다. Node 런타임이
// 필요하다 — Edge 에서는 이런 장시간 연결을 유지할 수 없다.

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const session = await requireSession(req)
  if (!session) return UNAUTHORIZED()
  if (!(await ownsCamera(session.supabase, id))) return NOT_FOUND()

  const res = await visionFetch(`/stream/${id}`, {
    timeoutMs: 0,
    // 브라우저가 탭을 닫으면 이 신호가 비전 서비스까지 전달돼 프레임 생산이
    // 멈춘다. 없으면 아무도 안 보는 스트림이 계속 흐른다.
    signal: req.signal,
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "")
    return new Response(text || JSON.stringify({ error: "영상을 가져올 수 없습니다." }), {
      status: res.status || 502,
      headers: { "Content-Type": "application/json" },
    })
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type":
        res.headers.get("Content-Type") ?? "multipart/x-mixed-replace; boundary=shrimpframe",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      // 중간 프록시가 이 스트림을 모아 두면 영상이 뭉텅이로 늦게 도착한다.
      "X-Accel-Buffering": "no",
    },
  })
}
