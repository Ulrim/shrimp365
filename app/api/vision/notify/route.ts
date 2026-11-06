import { NextRequest } from "next/server"
import { sendAlertPush } from "@/lib/push-server"
import { serviceKeyValid } from "@/lib/vision-token"

// 비전 서비스 → shrimp365 되부르기: 개체수 경보를 웹푸시로 내보낸다.
//
// 왜 파이썬이 직접 안 보내는가: VAPID 개인키와 구독 정보(push_subscriptions)가
// 여기에 있다. 그것을 비전 서비스에도 복사해 두면 비밀이 두 곳에 생기고,
// 푸시 형식이 두 벌로 갈라진다. 발송 창구는 하나로 둔다.
//
// 이 경로는 사람이 부르는 곳이 아니다. 로그인 세션이 아니라 서비스 공유 키로만
// 연다. 컨테이너 내부에서만 닿게 하고, 외부에 노출하지 않는다.

export const dynamic = "force-dynamic"

const TYPES = new Set(["danger", "warning"])

export async function POST(req: NextRequest) {
  if (!serviceKeyValid(req.headers.get("X-Vision-Key"))) {
    return Response.json({ error: "권한이 없습니다." }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const tankId = body?.tank_id
  const type = body?.type
  if (typeof tankId !== "string" || !TYPES.has(type) || typeof body?.message !== "string") {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 })
  }

  // 발송 실패는 삼킨다 — 경보 자체는 이미 alerts 에 적혀 화면에 뜬다.
  // 여기서 500 을 돌려주면 비전 서비스 로그만 시끄러워지고 얻는 것이 없다.
  try {
    await sendAlertPush(tankId, {
      type,
      message: body.message.slice(0, 300),
      parameter: typeof body.parameter === "string" ? body.parameter : null,
    })
  } catch {
    return Response.json({ delivered: false })
  }
  return Response.json({ delivered: true })
}
