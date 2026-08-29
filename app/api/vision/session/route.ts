import { NextRequest } from "next/server"
import { UNAUTHORIZED, isVisionConfigured, ownedCameraIds, requireSession } from "@/lib/vision-server"
import { STREAM_TOKEN_TTL_SECONDS, signStreamToken } from "@/lib/vision-token"

// 실시간 연결 준비물을 한 번에 내려 준다.
//
// WebSocket 은 Next.js 라우트로 중계할 수 없다(라우트 핸들러는 업그레이드를
// 처리하지 못한다). 그래서 브라우저가 비전 서비스에 **직접** 붙어야 하고,
// 그때 자격 증명으로 쓸 짧은 서명 토큰이 여기서 나온다.
//
// 토큰에는 이 사용자가 가진 카메라 id 만 담긴다. 비전 서비스는 그 집합을
// 벗어난 구독을 잘라 내므로, 토큰을 손에 넣어도 남의 수조는 볼 수 없다.

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return UNAUTHORIZED()

  if (!isVisionConfigured()) {
    // 설정 전에는 화면이 "준비 안 됨"을 조용히 보여 주면 된다. 오류가 아니다.
    return Response.json({ enabled: false, cameraIds: [], token: null, wsUrl: null })
  }

  const cameraIds = await ownedCameraIds(session.supabase)
  const token = signStreamToken(cameraIds, session.userId)

  return Response.json(
    {
      enabled: !!token,
      cameraIds,
      token,
      // 브라우저에서 보이는 주소. 리버스 프록시가 이 경로를 비전 서비스로
      // 넘긴다(nginx 설정은 docs/VISION_DEPLOY.md 참고).
      wsUrl: process.env.NEXT_PUBLIC_VISION_WS_PATH || "/vision-ws",
      expiresIn: STREAM_TOKEN_TTL_SECONDS,
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
