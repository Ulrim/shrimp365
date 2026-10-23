// 장비가 수조 사진 한 장을 올리는 길.
//
// 왜 사진을 "올리는"가 — 영상을 "받아 오면" 되지 않나
// --------------------------------------------------
// 방향이 다르다. 영상(MJPEG)은 브라우저가 장비로 **들어가는** 연결이고,
// 농장 공유기는 들어오는 연결을 막는다(NAT). 개체수는 장비가 서버로
// **나가는** 연결이라 막히지 않는다. 그래서 개체수는 보이는데 영상은 안 보인다.
//
// 터널(Cloudflare Tunnel)을 깔면 들어오는 길이 열리지만, 장비가 열 대를 넘고
// 남의 농장에도 있는 상황에서 그것을 전부 깔고 관리하는 것은 지금 할 일이
// 아니다. 사진을 개체수와 같은 방향으로 내보내면 공유기를 그대로 두고 쓸 수
// 있다. 15초에 한 장이라 진짜 실시간은 아니지만, 수조에 무슨 일이 있는지
// 눈으로 확인하는 데는 충분하다.
//
// 본문은 **JPEG 바이트 그대로** 받는다. JSON 에 base64 로 실으면 전송량이
// 3분의 1 늘고, 농장 회선에서 그 차이는 공짜가 아니다. 사진에 딸린 숫자는
// 헤더로 온다.
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase-server"
import {
  camerasOf,
  deviceUnauthorized as unauthorized,
  serviceUnavailable,
  touch,
} from "@/lib/vision-device"

export const dynamic = "force-dynamic"

/** 받아 주는 사진 크기 상한(바이트).
 *
 *  장비는 640px 폭·품질 60 으로 줄여 보내므로 보통 20~40 KB 다. 300 KB 는
 *  그보다 열 배 — 설정을 잘못 만져 원본을 그대로 올리는 경우를 여기서 끊는다.
 *  테이블에도 같은 뜻의 제약이 걸려 있지만(base64 400 KB), 거기까지 가기 전에
 *  막아야 쓸데없이 메모리에 올리지 않는다. */
const MAX_IMAGE_BYTES = 300_000

/** JPEG 인가. 확장자나 Content-Type 을 믿지 않고 앞 두 바이트를 본다. */
function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8
}

function numberHeader(req: NextRequest, name: string): number | null {
  const raw = req.headers.get(name)
  if (raw === null || raw.trim() === "") return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export async function POST(req: NextRequest) {
  const key = req.headers.get("X-Device-Key")?.trim()
  if (!key) return unauthorized()
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return serviceUnavailable()

  const cameraId = req.headers.get("X-Camera-Id")?.trim()
  if (!cameraId) {
    return NextResponse.json({ error: "X-Camera-Id 헤더가 없습니다." }, { status: 400 })
  }

  const admin = createAdminClient()
  const mine = await camerasOf(admin, key)
  if (mine.length === 0) return unauthorized()
  // 남의 camera_id 를 실어 보내도 통과시키면, 기기 키 하나로 남의 수조 화면을
  // 제 사진으로 덮어쓸 수 있다. 개체수 경로와 같은 기준으로 막는다.
  if (!mine.some((c) => c.id === cameraId)) return unauthorized()

  const body = new Uint8Array(await req.arrayBuffer())
  if (body.length === 0) {
    return NextResponse.json({ error: "본문이 비어 있습니다." }, { status: 400 })
  }
  if (body.length > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `사진이 너무 큽니다(${body.length} 바이트). ${MAX_IMAGE_BYTES} 이하로 줄여 보내세요.` },
      { status: 413 }
    )
  }
  if (!looksLikeJpeg(body)) {
    return NextResponse.json({ error: "JPEG 이 아닙니다." }, { status: 400 })
  }

  const takenAtHeader = req.headers.get("X-Taken-At")?.trim()
  const parsed = takenAtHeader ? Date.parse(takenAtHeader) : NaN
  // 장비 시계가 틀어져 있어도 사진이 사라지지 않게, 못 읽으면 지금으로 적는다.
  const takenAt = Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString()

  const count = numberHeader(req, "X-Count")
  const lengthCm = numberHeader(req, "X-Length-Cm")

  const { error } = await admin.from("vision_snapshots").upsert(
    {
      camera_id: cameraId,
      taken_at: takenAt,
      count: count === null ? null : Math.max(0, Math.round(count)),
      length_cm: lengthCm !== null && lengthCm > 0 && lengthCm <= 40 ? lengthCm : null,
      width: numberHeader(req, "X-Width"),
      height: numberHeader(req, "X-Height"),
      image: Buffer.from(body).toString("base64"),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "camera_id" }
  )

  // 살아 있음 보고는 사진이 저장됐든 안 됐든 한다. 사진 하나 때문에 화면에서
  // 장비가 죽은 것으로 보이면 안 된다.
  await touch(admin, key)

  if (error) {
    // 마이그레이션(vision_snapshot.sql)을 아직 안 돌린 서버에는 테이블이
    // 없다. 그때 500 을 주면 장비가 15초마다 사진을 올리고 계속 실패한다 —
    // 농장 회선을 그냥 태우는 일이다. 501 로 "이 서버는 아직 사진을 받지
    // 않는다"고 분명히 말해 주면 장비가 간격을 늘린다. 개체수는 그대로 쌓인다.
    const text = `${error.message} ${error.details ?? ""}`
    if (/vision_snapshots/.test(text) || error.code === "42P01") {
      console.warn(
        "[vision/device/snapshot] vision_snapshots 테이블이 없습니다 —" +
          " supabase/migrations/vision_snapshot.sql 을 실행하면 웹에서 수조 사진이 보입니다."
      )
      return NextResponse.json(
        { error: "이 서버는 아직 사진을 받지 않습니다(vision_snapshot.sql 미적용)." },
        { status: 501 }
      )
    }
    return NextResponse.json({ error: "사진을 저장하지 못했습니다." }, { status: 500 })
  }

  return NextResponse.json({ stored: true, bytes: body.length })
}
