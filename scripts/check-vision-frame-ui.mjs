// 영상이 안 열릴 때 **화면에 수조 사진이 실제로 뜨는지** 본다.
//
// 왜 이 점검이 있나
// -----------------
// 사용자가 본 증상은 하나였다 — "개체수는 보이는데 실시간으로 확인이 안 된다".
// 농장 공유기 뒤에 있는 장비에는 바깥에서 들어갈 수 없어 MJPEG 가 열리지
// 않는다. 그 자리에 장비가 올려 둔 사진을 띄우도록 고쳤는데, 그것이 되려면
// 사슬이 전부 맞아야 한다.
//
//   <img> 가 영상에 실패한다 → onError 가 뜬다 → 사진을 받으러 간다
//   → blob 주소를 만든다 → 그림이 그려진다 → "N초 전"이 붙는다
//
// 타입 검사와 빌드는 이 사슬을 하나도 확인하지 못한다. 중간 한 칸만 끊겨도
// 화면은 예전처럼 "이 장비는 아직 바깥에서 볼 수 없습니다"에 머문다 — 고쳤는데
// 고쳐지지 않은 것으로 보이는, 가장 알아채기 어려운 실패다.
//
// 데이터는 전부 가로채 고정값을 준다(Supabase 는 흉내 서버, 나머지는 브라우저
// 수준에서 가로챔). 그래서 결과가 흔들리지 않는다.
//
// 실행 (저장소 루트에서):
//
//     node scripts/check-vision-frame-ui.mjs
//
// **이 점검은 .next 를 다시 빌드한다.** NEXT_PUBLIC_* 는 빌드할 때 묶음에
// 박히므로, 흉내 서버 주소로 빌드하지 않으면 브라우저에서 Supabase 클라이언트가
// 만들어지지 않아 화면이 통째로 안 뜬다. 끝난 뒤 평소 빌드로 되돌리려면
// `npx next build` 를 한 번 더 돌리면 된다. 이미 흉내 주소로 빌드해 두었다면
// SKIP_BUILD=1 로 건너뛸 수 있다.
//
// CI 에는 넣지 않았다 — 브라우저가 필요해 다른 검사와 함께 돌릴 수 없다.
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { readdirSync } from "node:fs"
import { chromium } from "playwright-core"

/** 크로미움을 찾는다. 경로에 버전이 박혀 있어(chromium-1194) 그대로 적으면
 *  업데이트 한 번에 점검이 죽는다. 있는 것 중 아무거나 쓴다. */
function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM
  const root = "/opt/pw-browsers"
  try {
    for (const dir of readdirSync(root)) {
      if (!dir.startsWith("chromium-")) continue
      return `${root}/${dir}/chrome-linux/chrome`
    }
  } catch { /* 설치 위치가 다르면 playwright 가 알아서 찾게 둔다 */ }
  return undefined
}

const STUB_PORT = 54330
const APP_PORT = 3130
const SERVICE_KEY = "test-service-role-key"
const ANON_KEY = "test-anon-key"
const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const CAMERA_ID = "11111111-1111-1111-1111-111111111111"
const TANK_ID = "33333333-3333-3333-3333-333333333333"
const FARM_ID = "44444444-4444-4444-4444-444444444444"

/** 테스트용 사진 — 640×360, 박스 세 개가 그려져 있다(장비가 보내는 모양). */
const FRAME_B64 = process.env.FRAME_B64 ?? ""

const camera = {
  id: CAMERA_ID, tank_id: TANK_ID, name: "1호 수조 카메라", camera_type: "csi",
  stream_url: null, resolution_w: 1280, resolution_h: 720, fps_target: 1,
  is_active: true, api_key: "k", host_url: null, created_at: new Date().toISOString(),
  tank_area_m2: null, install_height: null, last_seen_at: new Date().toISOString(),
  agent_version: "1.0.0", tanks: { name: "1호 수조", farm_id: FARM_ID, farms: { name: "시험 농장" } },
}

// ── 흉내 낸 Supabase (서버 쪽에서만 쓰인다) ─────────────────────────────────
const stub = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${STUB_PORT}`)
  req.resume()  // 본문은 쓰지 않는다. 읽어 버리지 않으면 연결이 안 닫힌다.
  const json = (code, value) => {
    res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" })
    res.end(JSON.stringify(value))
  }
  if (url.pathname === "/auth/v1/user") {
    const auth = req.headers.authorization ?? ""
    if (!auth.startsWith("Bearer ") || auth === `Bearer ${ANON_KEY}`) return json(401, { message: "no session" })
    return json(200, { id: USER_ID, aud: "authenticated", email: "t@example.com",
                       app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() })
  }
  if (url.pathname === "/rest/v1/vision_cameras") return json(200, [camera])
  json(200, [])
})

function sessionCookieValue() {
  const session = {
    access_token: "test-access-token", token_type: "bearer", expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "test-refresh",
    user: { id: USER_ID, aud: "authenticated", email: "t@example.com",
            app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  }
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`
}

let failures = 0
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${ok || !detail ? "" : ` — ${detail}`}`)
  if (!ok) failures++
}

/** 빌드 때 박히는 값과 띄울 때 읽는 값을 한곳에 둔다. 두 쪽이 어긋나면
 *  브라우저가 엉뚱한 주소로 Supabase 를 부르고, 증상은 "화면이 안 뜬다"뿐이다. */
const APP_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  VISION_SERVICE_KEY: "test-vision-key",
  // 실제 배포(Vercel)와 같은 모양으로 빌드·실행한다. 이 변수가 없으면
  // next.config 가 output: "standalone" 으로 바뀌어 `next start` 가 안 된다.
  VERCEL: "1",
}

if (!process.env.SKIP_BUILD) {
  console.log("흉내 서버 주소로 다시 빌드합니다(1~2분)…")
  const build = spawn("npx", ["next", "build"], {
    env: { ...process.env, ...APP_ENV, NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "inherit"],
  })
  const [code] = await once(build, "exit")
  if (code !== 0) {
    console.error("빌드가 실패했습니다.")
    process.exit(1)
  }
}

stub.listen(STUB_PORT)
await once(stub, "listening")

// detached 로 띄우고 **프로세스 묶음 전체**를 죽인다. npx 는 next-server 를
// 따로 띄우므로, npx 만 죽이면 next-server 가 포트를 쥐고 남는다 — 다음 실행이
// EADDRINUSE 로 죽고, 그 원인이 보이지 않는다.
const server = spawn("npx", ["next", "start", "--port", String(APP_PORT)], {
  detached: true,
  env: { ...process.env, ...APP_ENV, NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
})
const serverLog = []
server.stdout.on("data", (d) => serverLog.push(String(d)))
server.stderr.on("data", (d) => serverLog.push(String(d)))

const app = (path) => `http://127.0.0.1:${APP_PORT}${path}`
async function waitForApp(timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try { await fetch(app("/api/vision/session")); return true }
    catch { await new Promise((r) => setTimeout(r, 400)) }
  }
  return false
}

let browser
try {
  if (!(await waitForApp())) {
    console.error("서버가 뜨지 않았습니다.")
    console.error(serverLog.join(""))
    process.exitCode = 1
  } else {
    browser = await chromium.launch({
      executablePath: findChromium(),
      // --no-proxy-server 가 없으면 크로미움이 환경의 HTTPS_PROXY 를 집어
      // 127.0.0.1 까지 프록시로 보내려 하고, 페이지가 통째로 안 열린다.
      args: ["--no-sandbox", "--no-proxy-server"],
    })
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      // 이 앱의 CSP 는 connect-src 를 'self' 와 *.supabase.co 로 묶어 둔다
      // (맞는 설정이다). 흉내 서버는 127.0.0.1 이라 그 목록에 들 수 없으므로
      // 점검에서만 CSP 를 비켜 간다. 검사 대상은 CSP 가 아니라 사진이 뜨는지다.
      bypassCSP: true,
    })
    await context.addCookies([{
      name: "sb-127-auth-token", value: sessionCookieValue(),
      domain: "127.0.0.1", path: "/", httpOnly: false, secure: false, sameSite: "Lax",
    }])

    const page = await context.newPage()
    let frameRequests = 0

    // 브라우저가 Supabase 로 직접 가는 조회(개체수·수조·집계)는 빈 값으로.
    await page.route(`http://127.0.0.1:${STUB_PORT}/**`, (route) => {
      const u = route.request().url()
      if (u.includes("/auth/v1/user")) {
        return route.fulfill({ status: 200, contentType: "application/json",
          body: JSON.stringify({ id: USER_ID, aud: "authenticated", email: "t@example.com",
            app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }) })
      }
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
    })

    await page.route("**/api/vision/session", (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ enabled: true, cameraIds: [CAMERA_ID], token: null,
                             mode: "direct", streamBase: null, hosts: [] }),
    }))
    await page.route("**/api/vision/cameras", (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify([camera]),
    }))
    await page.route("**/api/vision/alert-configs", (route) => route.fulfill({
      status: 200, contentType: "application/json", body: "[]",
    }))

    // 영상은 **실패해야 한다.** 농장 공유기 뒤의 장비가 바로 이 상태다.
    await page.route("**/api/vision/stream/**", (route) => route.fulfill({
      status: 503, contentType: "application/json",
      body: JSON.stringify({ error: "개체수 분석 서비스에 연결할 수 없습니다." }),
    }))

    // 장비가 올려 둔 사진.
    await page.route("**/api/vision/cameras/*/frame", (route) => {
      frameRequests++
      route.fulfill({
        status: 200, contentType: "image/jpeg",
        headers: {
          "X-Frame-At": new Date(Date.now() - 12_000).toISOString(),
          "X-Frame-Count": "3",
          "X-Frame-Length-Cm": "11.5",
          "Cache-Control": "no-store",
        },
        body: Buffer.from(FRAME_B64, "base64"),
      })
    })

    // 바깥 인터넷은 막는다. 프록시 환경에서 인증서 오류가 콘솔을 채우고,
    // 점검과 아무 상관이 없다.
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort())

    // 404 는 콘솔 글만 보면 어느 주소인지 알 수 없다. 응답을 따로 적어 둔다 —
    // "뭔지 모를 404" 를 소리로 치부하고 넘기면 진짜 문제를 그렇게 넘긴다.
    const notFound = []
    page.on("response", (r) => { if (r.status() === 404) notFound.push(r.url()) })

    const consoleErrors = []
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()) })

    if (process.env.DEBUG_UI) {
      page.on("requestfailed", (r) => console.log("실패한 요청:", r.url(), r.failure()?.errorText))
      page.on("pageerror", (e) => console.log("페이지 예외:", e.message))
      page.on("console", (m) => console.log(`[${m.type()}]`, m.text().slice(0, 300)))
    }
    const nav = await page.goto(app("/vision"), { waitUntil: "domcontentloaded" }).catch((e) => {
      console.log("goto 실패:", e.message)
      return null
    })
    await page.waitForTimeout(2_000)
    if (process.env.DEBUG_UI) {
      console.log("응답:", nav ? `${nav.status()} ${nav.statusText()}` : "없음")
      console.log("주소:", page.url())
      console.log("본문:", (await page.locator("body").innerText()).slice(0, 1200))
      console.log("서버 로그:", serverLog.join("").slice(-3000))
    }
    // 실시간 탭으로 간다.
    await page.getByRole("tab", { name: "실시간" }).click({ timeout: 20_000 })

    // 사진이 뜨기를 기다린다. 사슬 어디가 끊겨도 여기서 멈춘다.
    const shot = page.locator('img[alt*="수조 사진"]').first()
    let appeared = true
    try { await shot.waitFor({ state: "visible", timeout: 20_000 }) }
    catch { appeared = false }

    check("영상이 실패하면 수조 사진으로 내려앉는다", appeared,
          appeared ? "" : "사진 <img> 가 나타나지 않았다")
    check("사진을 실제로 받아 갔다", frameRequests > 0, `요청 ${frameRequests}건`)

    if (appeared) {
      const box = await shot.boundingBox()
      check("사진이 눈에 보이는 크기로 그려졌다",
            !!box && box.width > 200 && box.height > 100,
            box ? `${Math.round(box.width)}×${Math.round(box.height)}` : "크기 없음")
      const loaded = await shot.evaluate((img) => img.complete && img.naturalWidth > 0)
      check("브라우저가 사진을 해독했다(blob 주소가 살아 있다)", loaded)
      const natural = await shot.evaluate((img) => `${img.naturalWidth}x${img.naturalHeight}`)
      check("장비가 보낸 크기 그대로다", natural === "640x360", natural)

      const body = await page.locator("body").innerText()
      check("몇 초 전 사진인지 적혀 있다", /사진 \d+초 전/.test(body),
            body.match(/사진 .{0,10}/)?.[0] ?? "그런 문구 없음")
      check("개체수가 사진과 함께 보인다", /\b3\b/.test(body))
      check("터널 안내는 더 이상 뜨지 않는다", !body.includes("아직 올라온 수조 사진이 없습니다"))
      check("\"바깥에서 볼 수 없습니다\" 라는 옛 문구가 없다",
            !body.includes("바깥에서 볼 수 없습니다"))

      // 사진을 계속 갱신하는지. 5초 주기이므로 6초면 한 번은 더 와야 한다.
      const before = frameRequests
      await page.waitForTimeout(6_000)
      check("사진을 주기적으로 다시 받아 온다", frameRequests > before,
            `${before} → ${frameRequests}`)
    }

    // 점검 환경이 내는 소리는 뺀다. 전부 이 길과 상관이 없다 —
    //   · _vercel/* : Vercel 바깥에서는 없는 스크립트다(404)
    //   · ERR_FAILED: 위에서 일부러 막은 바깥 인터넷 요청
    //   · 503       : 영상 경로를 일부러 실패시킨 것(이 점검의 전제다)
    //   · 404       : 콘솔 글에는 주소가 없어 가릴 수 없다. 바로 아래의
    //                  "찾지 못한 주소가 없다" 가 응답 단위로 제대로 본다.
    const NOISE = /favicon|adsbygoogle|analytics|sentry|_vercel|googletagmanager|ERR_FAILED|ERR_CERT|503 \(Service Unavailable\)|404 \(Not Found\)/i
    const real = consoleErrors.filter((t) => !NOISE.test(t))
    check("콘솔에 오류가 없다", real.length === 0, real.slice(0, 3).join(" | "))
    const badPaths = notFound.filter((u) => !/_vercel|favicon|\.map$/.test(u))
    check("찾지 못한 주소가 없다", badPaths.length === 0, badPaths.join(" | "))

    const out = process.env.SHOT_OUT
    if (out) { await page.screenshot({ path: out, fullPage: false }); console.log(`\n화면: ${out}`) }
  }
} finally {
  if (browser) await browser.close()
  try { process.kill(-server.pid, "SIGTERM") } catch { server.kill("SIGTERM") }
  stub.close()
}

console.log(failures === 0 ? "\n전부 통과했습니다." : `\n${failures}건 실패했습니다.`)
if (failures > 0) process.exitCode = 1
