// 수조 사진이 장비에서 웹까지 실제로 오는지 확인한다.
//
// 왜 이 검사가 있나
// -----------------
// 이 길에는 틀리기 쉽고 틀려도 조용한 곳이 여럿 있다 — 기기 키로 남의 카메라에
// 사진을 심을 수 있는가, JPEG 이 base64 를 왕복하며 한 바이트라도 바뀌는가,
// 로그인 안 한 사람이 남의 수조를 볼 수 있는가. 타입 검사와 빌드는 이런 것을
// 잡지 못한다. 그래서 **실제로 서버를 띄우고 HTTP 로 주고받아** 본다.
//
// Supabase 는 흉내 낸 서버로 세운다. 진짜 Supabase 에 붙으면 검사 때마다 남의
// 데이터를 건드리게 되고, 서비스 롤 키를 어딘가 두어야 한다. 흉내 서버는
// supabase-js 가 실제로 보내는 요청(PostgREST 문법)을 그대로 받아 처리한다.
//
//   실행:  node scripts/check-vision-snapshot.mjs
//   필요:  먼저 `VERCEL=1 npx next build` 를 한 번 돌려 둘 것
//          (VERCEL 없이 빌드하면 standalone 이 되어 `next start` 가 안 된다).
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { once } from "node:events"

const STUB_PORT = 54329
const APP_PORT = 3129
const SERVICE_KEY = "test-service-role-key"
const ANON_KEY = "test-anon-key"
const DEVICE_KEY = "device-key-mine"

const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const MY_CAMERA = "11111111-1111-1111-1111-111111111111"
const OTHER_CAMERA = "22222222-2222-2222-2222-222222222222"
const MY_TANK = "33333333-3333-3333-3333-333333333333"
const MY_FARM = "44444444-4444-4444-4444-444444444444"

// ── 흉내 낸 Supabase ────────────────────────────────────────────────────────
/** 카메라 두 대. 하나는 내 것(기기 키가 붙어 있다), 하나는 남의 것. */
const cameras = [
  { id: MY_CAMERA, tank_id: MY_TANK, name: "내 카메라", camera_type: "csi",
    stream_url: null, resolution_w: 1280, resolution_h: 720, fps_target: 1,
    is_active: true, api_key: DEVICE_KEY, host_url: null,
    tanks: { name: "내 수조", farm_id: MY_FARM } },
  { id: OTHER_CAMERA, tank_id: "99999999-9999-9999-9999-999999999999", name: "남의 카메라",
    camera_type: "csi", stream_url: null, resolution_w: 1280, resolution_h: 720,
    fps_target: 1, is_active: true, api_key: "device-key-theirs", host_url: null,
    tanks: { name: "남의 수조", farm_id: "88888888-8888-8888-8888-888888888888" } },
]
/** camera_id → 사진 한 줄. 진짜 테이블처럼 카메라당 하나만 둔다. */
const snapshots = new Map()

/** `col=eq.value` 를 푼다. 이 검사에 필요한 연산자는 eq 뿐이다. */
function eqFilters(url) {
  const out = {}
  for (const [key, raw] of url.searchParams) {
    if (key === "select" || key === "order" || key === "limit") continue
    if (raw.startsWith("eq.")) out[key] = raw.slice(3)
  }
  return out
}

const stub = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${STUB_PORT}`)
  const auth = req.headers.authorization ?? ""
  // 서비스 롤로 온 요청은 RLS 를 지나친다. 그 밖(= 로그인 사용자)은 자기
  // 농장 것만 보게 걸러 — 진짜 Supabase 의 RLS 자리다.
  const isAdmin = auth === `Bearer ${SERVICE_KEY}`
  let body = ""
  for await (const chunk of req) body += chunk

  const json = (code, value) => {
    res.writeHead(code, { "Content-Type": "application/json" })
    res.end(JSON.stringify(value))
  }

  if (url.pathname === "/auth/v1/user") {
    if (!auth.startsWith("Bearer ") || auth === `Bearer ${ANON_KEY}`) {
      return json(401, { message: "no session" })
    }
    return json(200, { id: USER_ID, aud: "authenticated", email: "t@example.com",
                       app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() })
  }

  const visible = (cam) => isAdmin || cam.tanks.farm_id === MY_FARM

  if (url.pathname === "/rest/v1/vision_cameras") {
    const filters = eqFilters(url)
    if (req.method === "GET") {
      const rows = cameras.filter(
        (c) => visible(c) &&
          (filters.api_key === undefined || c.api_key === filters.api_key) &&
          (filters.id === undefined || c.id === filters.id)
      )
      return json(200, rows)
    }
    if (req.method === "PATCH") return json(200, [])  // 살아 있음 보고
  }

  if (url.pathname === "/rest/v1/vision_snapshots") {
    if (req.method === "POST") {
      // supabase-js 는 한 줄이면 객체로, 여러 줄이면 배열로 보낸다.
      const parsed = JSON.parse(body)
      for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
        snapshots.set(row.camera_id, row)
      }
      return json(201, [])
    }
    if (req.method === "GET") {
      const { camera_id } = eqFilters(url)
      const cam = cameras.find((c) => c.id === camera_id)
      const row = cam && visible(cam) ? snapshots.get(camera_id) : undefined
      return json(200, row ? [row] : [])
    }
  }

  json(404, { message: `흉내 서버가 모르는 경로: ${req.method} ${url.pathname}` })
})

// ── 검사 ────────────────────────────────────────────────────────────────────
let failures = 0
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${ok || !detail ? "" : ` — ${detail}`}`)
  if (!ok) failures++
}

/** 로그인한 사람의 쿠키. @supabase/ssr 가 실제로 쓰는 모양이다
 *  (base64- 접두사 + base64url(JSON)), 키 이름은 주소의 첫 마디에서 온다. */
function sessionCookie() {
  const session = {
    access_token: "test-access-token", token_type: "bearer", expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "test-refresh",
    user: { id: USER_ID, aud: "authenticated", email: "t@example.com",
            app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  }
  const encoded = Buffer.from(JSON.stringify(session)).toString("base64url")
  return `sb-127-auth-token=base64-${encoded}`
}

/** 진짜 JPEG. 라우트가 앞 두 바이트를 보므로 흉내로는 통과하지 못한다. */
function jpeg(bytes = 2048) {
  const body = Buffer.alloc(bytes, 0x5a)
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), body, Buffer.from([0xff, 0xd9])])
}

const app = (path) => `http://127.0.0.1:${APP_PORT}${path}`

async function run() {
  const picture = jpeg()

  // ── 올리는 길 ──
  let res = await fetch(app("/api/vision/device/snapshot"), { method: "POST", body: picture })
  check("기기 키 없이 올리면 거절한다", res.status === 401, `받은 상태: ${res.status}`)

  res = await fetch(app("/api/vision/device/snapshot"), {
    method: "POST",
    headers: { "X-Device-Key": "unknown-device-key", "X-Camera-Id": MY_CAMERA },
    body: picture,
  })
  check("모르는 기기 키는 거절한다", res.status === 401, `받은 상태: ${res.status}`)

  res = await fetch(app("/api/vision/device/snapshot"), {
    method: "POST", headers: { "X-Device-Key": DEVICE_KEY }, body: picture,
  })
  check("카메라를 안 밝히면 거절한다", res.status === 400, `받은 상태: ${res.status}`)

  res = await fetch(app("/api/vision/device/snapshot"), {
    method: "POST",
    headers: { "X-Device-Key": DEVICE_KEY, "X-Camera-Id": OTHER_CAMERA },
    body: picture,
  })
  check("남의 카메라에는 심을 수 없다", res.status === 401, `받은 상태: ${res.status}`)
  check("남의 사진이 저장되지 않았다", !snapshots.has(OTHER_CAMERA))

  res = await fetch(app("/api/vision/device/snapshot"), {
    method: "POST",
    headers: { "X-Device-Key": DEVICE_KEY, "X-Camera-Id": MY_CAMERA },
    body: Buffer.from("이건 JPEG 이 아니다"),
  })
  check("JPEG 이 아니면 거절한다", res.status === 400, `받은 상태: ${res.status}`)

  res = await fetch(app("/api/vision/device/snapshot"), {
    method: "POST",
    headers: { "X-Device-Key": DEVICE_KEY, "X-Camera-Id": MY_CAMERA },
    body: jpeg(400_000),
  })
  check("너무 큰 사진은 거절한다", res.status === 413, `받은 상태: ${res.status}`)

  const takenAt = "2026-10-05T01:02:03.000Z"
  res = await fetch(app("/api/vision/device/snapshot"), {
    method: "POST",
    headers: {
      "X-Device-Key": DEVICE_KEY, "X-Camera-Id": MY_CAMERA, "X-Taken-At": takenAt,
      "X-Count": "7", "X-Length-Cm": "11.5", "X-Width": "640", "X-Height": "360",
    },
    body: picture,
  })
  check("내 카메라의 사진은 받아 준다", res.status === 200, `받은 상태: ${res.status}`)

  const stored = snapshots.get(MY_CAMERA)
  check("사진이 저장되었다", !!stored)
  if (stored) {
    check("한 바이트도 바뀌지 않았다", Buffer.from(stored.image, "base64").equals(picture))
    check("찍은 시각이 그대로다", stored.taken_at === takenAt, stored.taken_at)
    check("개체수가 함께 저장됐다", stored.count === 7, String(stored.count))
    check("체장이 함께 저장됐다", stored.length_cm === 11.5, String(stored.length_cm))
    check("크기가 함께 저장됐다", stored.width === 640 && stored.height === 360)
  }

  res = await fetch(app("/api/vision/device/snapshot"), {
    method: "POST",
    headers: { "X-Device-Key": DEVICE_KEY, "X-Camera-Id": MY_CAMERA, "X-Length-Cm": "900" },
    body: picture,
  })
  check("말도 안 되는 체장은 버린다", snapshots.get(MY_CAMERA)?.length_cm === null,
        String(snapshots.get(MY_CAMERA)?.length_cm))

  // ── 받아 보는 길 ──
  // 바로 위에서 체장이 없는 사진으로 덮어썼다. 읽는 쪽을 보기 전에 숫자가 다
  // 들어간 사진을 한 번 더 올려 둔다 — 덮어쓰기가 제대로 되는지도 함께 본다.
  res = await fetch(app("/api/vision/device/snapshot"), {
    method: "POST",
    headers: {
      "X-Device-Key": DEVICE_KEY, "X-Camera-Id": MY_CAMERA, "X-Taken-At": takenAt,
      "X-Count": "7", "X-Length-Cm": "11.5", "X-Width": "640", "X-Height": "360",
    },
    body: picture,
  })
  check("같은 카메라의 사진을 덮어쓴다", res.status === 200 && snapshots.size === 1,
        `상태 ${res.status} / 줄 ${snapshots.size}`)

  res = await fetch(app(`/api/vision/cameras/${MY_CAMERA}/frame`))
  check("로그인 없이 사진을 못 본다", res.status === 401, `받은 상태: ${res.status}`)

  const cookie = { Cookie: sessionCookie() }
  res = await fetch(app(`/api/vision/cameras/${OTHER_CAMERA}/frame`), { headers: cookie })
  check("남의 수조 사진은 못 본다", res.status === 404, `받은 상태: ${res.status}`)

  res = await fetch(app(`/api/vision/cameras/${MY_CAMERA}/frame`), { headers: cookie })
  check("내 수조 사진은 받아 온다", res.status === 200, `받은 상태: ${res.status}`)
  if (res.status === 200) {
    const got = Buffer.from(await res.arrayBuffer())
    check("받은 사진이 보낸 사진과 같다", got.equals(picture),
          `보낸 ${picture.length}바이트 / 받은 ${got.length}바이트`)
    check("JPEG 으로 온다", res.headers.get("content-type") === "image/jpeg")
    check("캐시가 끼지 않는다", /no-store/.test(res.headers.get("cache-control") ?? ""))
    check("찍은 시각이 헤더로 온다", !!res.headers.get("x-frame-at"),
          String(res.headers.get("x-frame-at")))
    check("개체수가 헤더로 온다", res.headers.get("x-frame-count") === "7",
          String(res.headers.get("x-frame-count")))
  }

  // 아직 사진이 안 올라온 카메라 — 오류가 아니라 "없음"이다.
  snapshots.delete(MY_CAMERA)
  res = await fetch(app(`/api/vision/cameras/${MY_CAMERA}/frame`), { headers: cookie })
  check("사진이 없으면 204 로 조용히 넘어간다", res.status === 204, `받은 상태: ${res.status}`)

  // 허용 목록에 없는 동작은 막혀 있어야 한다.
  res = await fetch(app(`/api/vision/cameras/${MY_CAMERA}/../../device`), { headers: cookie })
  check("허용 목록 밖의 동작은 막힌다", res.status === 404 || res.status === 401,
        `받은 상태: ${res.status}`)
}

// ── 띄우고 내리기 ───────────────────────────────────────────────────────────
stub.listen(STUB_PORT)
await once(stub, "listening")

// detached 로 띄우고 **프로세스 묶음 전체**를 죽인다. npx 는 next-server 를
// 따로 띄우므로, npx 만 죽이면 next-server 가 포트를 쥐고 남는다 — 다음 실행이
// EADDRINUSE 로 죽고, 그 원인이 보이지 않는다.
const server = spawn("npx", ["next", "start", "--port", String(APP_PORT)], {
  detached: true,
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    VISION_SERVICE_KEY: "test-vision-key",
    NODE_ENV: "production",
    // 실제 배포(Vercel)와 같은 모양으로 띄운다. 이 변수가 없으면 next.config
    // 가 output: "standalone" 으로 바뀌어 `next start` 가 페이지를 못 내보낸다.
    VERCEL: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
})
const log = []
server.stdout.on("data", (d) => log.push(String(d)))
server.stderr.on("data", (d) => log.push(String(d)))

async function waitForApp(timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      // 어떤 응답이든 오면 서버가 뜬 것이다(401 도 응답이다).
      await fetch(app("/api/vision/device/snapshot"), { method: "POST", body: "x" })
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 400))
    }
  }
  return false
}

try {
  if (!(await waitForApp())) {
    console.error("서버가 뜨지 않았습니다. `VERCEL=1 npx next build` 를 먼저 돌렸는지 확인하세요.")
    console.error(log.join(""))
    process.exitCode = 1
  } else {
    await run()
    console.log(failures === 0 ? "\n전부 통과했습니다." : `\n${failures}건 실패했습니다.`)
    if (failures > 0) process.exitCode = 1
  }
} finally {
  try { process.kill(-server.pid, "SIGTERM") } catch { server.kill("SIGTERM") }
  stub.close()
}
