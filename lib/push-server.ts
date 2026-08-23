import webpush from "web-push"
import { createAdminClient } from "@/lib/supabase-server"

// 웹푸시 발송 — **서버 전용**.
//
// VAPID 개인키와 service-role 키를 쓰므로 클라이언트 컴포넌트에서 import 하지
// 말 것. "use client" 파일에서 이 모듈을 부르면 빌드는 통과할 수 있어도
// 개인키가 브라우저 번들로 흘러 들어간다.
//
// 설정이 없으면 아무것도 하지 않는다. 사장님이 VAPID 키를 넣기 전에도 앱은
// 지금까지처럼 그대로 돌아가야 하고, 그때 알림은 기존 인탭 방식으로 나간다.

/** 푸시로 알릴 최소 정보. 센서 API 가 만든 알림에서 이만큼만 떼어 온다. */
export interface PushAlert {
  type: "danger" | "warning"
  message: string
}

interface VapidDetails {
  subject: string
  publicKey: string
  privateKey: string
}

/** 환경변수는 **호출 시점에** 읽는다. 모듈 최상단에서 굳혀 두면 환경변수를
 *  넣고 재배포해도 값이 안 바뀌는 배포 형태가 있다(ai-advisor 와 같은 이유). */
function readVapid(): VapidDetails | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  // 하나라도 없으면 조용히 끈다. 로그도 남기지 않는다 — 설정 전에는 센서가
  // 1분마다 값을 올릴 때마다 같은 경고가 찍혀 로그가 못 쓰게 된다.
  if (!publicKey || !privateKey || !subject) return null
  return { subject, publicKey, privateKey }
}

/** 웹푸시가 설정되어 있는지. 화면·진단에서 쓰라고 열어 둔다. */
export function isPushConfigured(): boolean {
  return readVapid() !== null
}

interface SubscriptionRow {
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * 이 수조 주인의 모든 기기로 위험·주의 알림을 밀어 보낸다.
 *
 * 절대 throw 하지 않는다. 센서 수집 응답이 푸시 때문에 깨지면 수질 데이터가
 * 통째로 유실된다 — 알림보다 측정이 우선이다.
 *
 * @param tankId 알림이 발생한 수조 id
 * @param alert  등급과 문구
 */
export async function sendAlertPush(tankId: string, alert: PushAlert): Promise<void> {
  try {
    const vapid = readVapid()
    if (!vapid) return

    let admin
    try {
      admin = createAdminClient()
    } catch {
      // service-role 키가 없는 배포 — 여기까지 올 일은 거의 없다(센서 API 가
      // 이미 그 키로 동작 중이므로). 조용히 넘긴다.
      return
    }

    // 수조 → 양식장 → 주인. 알림은 수조 단위로 생기지만 구독은 사람 단위다.
    const { data: tank } = await admin
      .from("tanks")
      .select("name, farms!tanks_farm_id_fkey(user_id)")
      .eq("id", tankId)
      .maybeSingle()
    if (!tank) return

    const farm = (Array.isArray(tank.farms) ? tank.farms[0] : tank.farms) as
      | { user_id?: string }
      | undefined
    const userId = farm?.user_id
    if (!userId) return

    const { data: subs, error } = await admin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", userId)

    // 마이그레이션 전 DB 에는 테이블이 없다. 그래도 수집은 멈추면 안 된다.
    if (error || !subs || subs.length === 0) return

    const payload = JSON.stringify({
      title: `${alert.type === "danger" ? "🔴" : "🟡"} ${tank.name || "수조"}`,
      body: alert.message,
      url: `/water-quality?tank=${tankId}`,
    })

    const expired: string[] = []
    const delivered: string[] = []

    await Promise.all(
      (subs as SubscriptionRow[]).map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            {
              vapidDetails: vapid,
              // 기기가 꺼져 있어도 한 시간까지는 푸시 서비스가 들고 있다가
              // 켜지면 전달한다. 그보다 오래된 수질 알림은 이미 소용이 없다.
              TTL: 3600,
              urgency: alert.type === "danger" ? "high" : "normal",
            }
          )
          delivered.push(sub.endpoint)
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode
          // 410 Gone / 404 Not Found — 브라우저가 구독을 버렸다는 뜻이다.
          // 그대로 두면 이 사용자에게 알림이 갈 때마다 영원히 실패한다.
          if (status === 410 || status === 404) {
            expired.push(sub.endpoint)
            return
          }
          console.error(
            `[push] 발송 실패 status=${status ?? "?"} — ${e instanceof Error ? e.message : String(e)}`
          )
        }
      })
    )

    if (expired.length > 0) {
      await admin.from("push_subscriptions").delete().in("endpoint", expired)
    }
    if (delivered.length > 0) {
      await admin
        .from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .in("endpoint", delivered)
    }
  } catch (e) {
    // 여기까지 온 예외는 전부 삼킨다. 센서 수집 응답은 무조건 나가야 한다.
    console.error("[push] sendAlertPush 실패:", e instanceof Error ? e.message : e)
  }
}
