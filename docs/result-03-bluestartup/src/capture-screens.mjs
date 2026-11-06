// 결과보고서에 붙일 **화면 캡처**를 실제 화면에서 뜬다.
//
// 왜 손으로 그리지 않나
// ---------------------
// 화면 시안을 그려 넣으면 그 순간부터 실물과 어긋나고, 점검위원이 실제 화면을
// 열어 보면 다른 그림이 나온다. 여기서는 **운영에 올라간 그 코드**를 그대로
// 띄워서 찍는다. 화면을 고치면 이 스크립트를 다시 돌리는 것만으로 첨부 이미지가
// 따라온다. (docs/midterm-2026/src/render.mjs 가 쓰는 방법과 같다.)
//
// 자료는 어디서 오나 — 그리고 왜 그것을 밝혀야 하나
// -------------------------------------------------
// 운영 Supabase 에 붙지 않는다. 남의 농장 실데이터를 보고서에 실을 수 없고,
// 서비스 롤 키를 여기 둘 수도 없다. 대신 **만들어 낸 자료**를 흉내 서버가
// 돌려준다 — 24시간 개체수 곡선, 수질 3종, 집계 버킷.
//
// 그래서 이 이미지들은 "화면이 이렇게 생겼다"의 증빙이지 "현장에서 이 값이
// 나왔다"의 증빙이 **아니다**. 캡션에 그렇게 쓰라고 README 에 적어 두었다.
// 수조 사진 한 장만은 장비와 같은 코드(app.services.rendering)로 구운 것이라
// 머리글 띠·세는 범위·탐지 박스가 현장과 같은 모양이다.
//
// 실행 (저장소 뿌리에서, 3~5분):
//
//     node docs/result-03-bluestartup/src/capture-screens.mjs
//     SKIP_BUILD=1 node docs/result-03-bluestartup/src/capture-screens.mjs
//
// 결과: docs/result-03-bluestartup/assets/1x_*.png  (인쇄용 2배 배율)
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { readFileSync, readdirSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..", "..")
const OUT = path.resolve(HERE, "..", "assets")
mkdirSync(OUT, { recursive: true })

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM
  try {
    const root = "/opt/pw-browsers"
    const dir = readdirSync(root).find((d) => d.startsWith("chromium-"))
    if (dir) return `${root}/${dir}/chrome-linux/chrome`
  } catch { /* playwright 가 알아서 찾게 둔다 */ }
  return undefined
}

const STUB_PORT = 54331
const APP_PORT = 3131
const ANON_KEY = "capture-anon-key"
const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const CAMERA_ID = "11111111-1111-1111-1111-111111111111"
const TANK_ID = "33333333-3333-3333-3333-333333333333"
const FARM_ID = "44444444-4444-4444-4444-444444444444"

const FRAME_BYTES = readFileSync(
  path.join(ROOT, "scripts/fixtures/vision-frame-640x360.jpg")
)

const tank = {
  id: TANK_ID, farm_id: FARM_ID, name: "1호 수조", capacity: 30, area_m2: 25,
  water_type: "해수", status: "active", created_at: "2026-08-01T00:00:00Z",
}
const camera = {
  id: CAMERA_ID, tank_id: TANK_ID, name: "1호 수조 카메라", camera_type: "picamera",
  stream_url: null, resolution_w: 1280, resolution_h: 720, fps_target: 1,
  is_active: true, api_key: "k", host_url: null, created_at: "2026-09-20T00:00:00Z",
  tank_area_m2: 25, install_height: 45, last_seen_at: new Date().toISOString(),
  agent_version: "1.1.2", serial: "10000000abcd1234", firmware: "Raspberry Pi 5",
  tanks: { name: "1호 수조", farm_id: FARM_ID, farms: { name: "시험 농장" } },
}

// ── 만들어 낸 자료 ──────────────────────────────────────────────────────────
// 하루 리듬을 준다. 새우는 야행성이라 밤에 바닥에서 올라와 더 많이 잡힌다 —
// 평평한 난수를 쓰면 그래프가 잡음 띠로 보여 화면 설명에 쓸 수 없다.
const NOW = Date.now()

/** 자리마다 늘 같은 값이 나오는 잡음(-1~1). 돌릴 때마다 그림이 달라지면
 *  보고서에 붙인 이미지와 다시 뜬 이미지가 어긋난다. */
function jitter(ms, salt) {
  const x = Math.sin(ms / 60000 * 12.9898 + salt * 78.233) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

function countAt(ms) {
  const hour = new Date(ms).getUTCHours() + 9            // 한국 시각
  const night = Math.cos(((hour - 3) / 24) * 2 * Math.PI) // 새벽 3시 최대
  const wave = Math.sin(ms / 3.1e6) * 18                  // 느린 흔들림
  return Math.round(1240 + night * 190 + wave + jitter(ms, 1) * 34)
}

/** 이력 탭 원본 기록 — 24시간, 10분 간격. */
function countRecords(hours = 24, stepMs = 600_000) {
  const rows = []
  for (let t = NOW - hours * 3600_000; t <= NOW; t += stepMs) {
    rows.push({
      time: new Date(t).toISOString(),
      camera_id: CAMERA_ID, tank_id: TANK_ID, farm_id: FARM_ID,
      count: countAt(t),
      confidence_avg: Number((0.79 + Math.sin(t / 7e6) * 0.05).toFixed(3)),
      model_version: "shrimp-y8n-416", inference_ms: 150 + (t % 37),
      length_cm: Number((10.4 + Math.sin(t / 9e6) * 0.7).toFixed(1)),
      frame_path: null,
    })
  }
  return rows
}

/** vision_count_history() 가 돌려주는 모양. */
function countBuckets(hours, bucketSeconds) {
  const rows = []
  const step = bucketSeconds * 1000
  for (let t = NOW - hours * 3600_000; t <= NOW; t += step) {
    const base = countAt(t)
    rows.push({
      bucket: new Date(t).toISOString(),
      avg_count: base,
      max_count: base + 34,
      min_count: base - 29,
      confidence_avg: Number((0.80 + Math.sin(t / 7e6) * 0.04).toFixed(3)),
      sample_count: Math.round(bucketSeconds / 10),
    })
  }
  return rows
}

/** vision_count_wq_series() 가 돌려주는 모양 — 개체수 + 수질 3종. */
function wqSeries(hours, bucketSeconds) {
  const rows = []
  const step = bucketSeconds * 1000
  for (let t = NOW - hours * 3600_000; t <= NOW; t += step) {
    const hour = new Date(t).getUTCHours() + 9
    rows.push({
      bucket: new Date(t).toISOString(),
      avg_count: countAt(t),
      count_samples: Math.round(bucketSeconds / 10),
      // 낮에 오르고 새벽에 내리는 수온, 그 반대로 움직이는 용존산소.
      //
      // 개체수와 **같은 모양으로 만들지 않는다.** 둘 다 깨끗한 코사인이면
      // 상관계수가 r=1.00 으로 떨어지는데, 그런 그림은 현장 자료에서 나오지
      // 않는다 — 보고서에 붙는 순간 "합성 자료"라고 읽힌다. 위상을 어긋나게
      // 두고 잡음을 섞어 0.6~0.8 대가 나오게 한다.
      avg_temperature: Number((28.4 + Math.cos(((hour - 15) / 24) * 2 * Math.PI) * 1.1
                               + jitter(t, 2) * 0.12).toFixed(2)),
      avg_do: Number((6.25 - Math.cos(((hour - 1) / 24) * 2 * Math.PI) * 0.55
                      + jitter(t, 3) * 0.09).toFixed(2)),
      avg_ph: Number((7.92 + Math.sin(t / 1.1e7) * 0.06 + jitter(t, 4) * 0.015).toFixed(2)),
      wq_samples: Math.round(bucketSeconds / 60),
    })
  }
  return rows
}

// ── 흉내 낸 Supabase ────────────────────────────────────────────────────────
function answer(pathname) {
  if (pathname === "/rest/v1/vision_cameras") return [camera]
  if (pathname === "/rest/v1/tanks") return [tank]
  if (pathname === "/rest/v1/farms") return [{ id: FARM_ID, name: "시험 농장", user_id: USER_ID }]
  if (pathname === "/rest/v1/count_records") return countRecords()
  if (pathname === "/rest/v1/rpc/vision_count_history") return countBuckets(24, 3600)
  if (pathname === "/rest/v1/rpc/vision_count_wq_series") return wqSeries(24, 3600)
  return []
}

const stub = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${STUB_PORT}`)
  req.resume()
  const json = (code, value) => {
    res.writeHead(code, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
    })
    res.end(JSON.stringify(value))
  }
  if (url.pathname === "/auth/v1/user") {
    const auth = req.headers.authorization ?? ""
    if (!auth.startsWith("Bearer ") || auth === `Bearer ${ANON_KEY}`) {
      return json(401, { message: "no session" })
    }
    return json(200, {
      id: USER_ID, aud: "authenticated", email: "t@example.com",
      app_metadata: {}, user_metadata: {}, created_at: "2026-08-01T00:00:00Z",
    })
  }
  json(200, answer(url.pathname))
})

function sessionCookieValue() {
  const session = {
    access_token: "capture-access-token", token_type: "bearer", expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "capture-refresh",
    user: {
      id: USER_ID, aud: "authenticated", email: "t@example.com",
      app_metadata: {}, user_metadata: {}, created_at: "2026-08-01T00:00:00Z",
    },
  }
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`
}

const APP_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: "capture-service-key",
  VISION_SERVICE_KEY: "capture-vision-key",
  VERCEL: "1",
}

if (!process.env.SKIP_BUILD) {
  console.log("흉내 서버 주소로 빌드합니다(1~2분)…")
  const build = spawn("npx", ["next", "build"], {
    cwd: ROOT, env: { ...process.env, ...APP_ENV, NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "inherit"],
  })
  const [code] = await once(build, "exit")
  if (code !== 0) { console.error("빌드 실패"); process.exit(1) }
}

stub.listen(STUB_PORT)
await once(stub, "listening")

const server = spawn("npx", ["next", "start", "--port", String(APP_PORT)], {
  cwd: ROOT, detached: true,
  env: { ...process.env, ...APP_ENV, NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
})
const serverLog = []
server.stdout.on("data", (d) => serverLog.push(String(d)))
server.stderr.on("data", (d) => serverLog.push(String(d)))

const app = (p) => `http://127.0.0.1:${APP_PORT}${p}`
async function waitForApp(timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try { await fetch(app("/api/vision/session")); return true }
    catch { await new Promise((r) => setTimeout(r, 400)) }
  }
  return false
}

const shots = []
let browser
try {
  if (!(await waitForApp())) {
    console.error("서버가 뜨지 않았습니다.\n" + serverLog.join(""))
    process.exitCode = 1
  } else {
    browser = await chromium.launch({
      executablePath: findChromium(),
      args: ["--no-sandbox", "--no-proxy-server"],
    })
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      // 인쇄 기준 300dpi 까지 견디도록 2배로 찍는다. 중간점검 첨부와 같은 규칙.
      deviceScaleFactor: 2,
      bypassCSP: true,
    })
    await context.addCookies([{
      name: "sb-127-auth-token", value: sessionCookieValue(),
      domain: "127.0.0.1", path: "/", httpOnly: false, secure: false, sameSite: "Lax",
    }])
    const page = await context.newPage()

    await page.route(`http://127.0.0.1:${STUB_PORT}/**`, (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === "/auth/v1/user") {
        return route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({
            id: USER_ID, aud: "authenticated", email: "t@example.com",
            app_metadata: {}, user_metadata: {}, created_at: "2026-08-01T00:00:00Z",
          }),
        })
      }
      route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify(answer(url.pathname)),
      })
    })
    await page.route("**/api/vision/session", (r) => r.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ enabled: true, cameraIds: [CAMERA_ID], token: null,
                             mode: "direct", streamBase: null, hosts: [] }),
    }))
    await page.route("**/api/vision/cameras", (r) => r.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify([camera]),
    }))
    await page.route("**/api/vision/alert-configs", (r) => r.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify([{
        id: "cfg-1", camera_id: CAMERA_ID, min_count: 900, max_count: 1800,
        drop_percent: 15, window_minutes: 30, is_enabled: true,
      }]),
    }))
    // 영상은 실패시킨다 — 농장 공유기 뒤의 장비가 실제로 이 상태이고,
    // 그래서 수조 사진으로 내려앉는 화면이 찍힌다.
    await page.route("**/api/vision/stream/**", (r) => r.fulfill({
      status: 503, contentType: "application/json",
      body: JSON.stringify({ error: "개체수 분석 서비스에 연결할 수 없습니다." }),
    }))
    await page.route("**/api/vision/cameras/*/frame", (r) => r.fulfill({
      status: 200, contentType: "image/jpeg",
      headers: {
        "X-Frame-At": new Date(Date.now() - 9_000).toISOString(),
        "X-Frame-Count": "1247",
        "X-Frame-Length-Cm": "10.8",
        "Cache-Control": "no-store",
      },
      body: FRAME_BYTES,
    }))
    // 바깥 인터넷은 막는다(프록시 인증서 오류가 화면에 끼어든다).
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort())

    await page.goto(app("/vision"), { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(2_500)
    // 쿠키 안내가 화면 아래를 덮는다 — 캡처 전에 닫는다.
    for (const label of ["Accept all", "모두 허용", "Essential only"]) {
      const btn = page.getByRole("button", { name: label })
      if (await btn.count()) { await btn.first().click().catch(() => {}); break }
    }
    await page.waitForTimeout(500)

    const TABS = [
      ["개요", "11_웹화면_개요"],
      ["실시간", "12_웹화면_실시간"],
      ["이력", "13_웹화면_이력"],
      ["통합 분석", "14_웹화면_통합분석"],
      ["설정", "15_웹화면_설정"],
    ]
    for (const [label, name] of TABS) {
      await page.getByRole("tab", { name: label }).click({ timeout: 20_000 })
      // 그래프가 그려지고 사진이 들어올 틈을 준다.
      await page.waitForTimeout(label === "실시간" ? 6_000 : 2_500)
      const file = path.join(OUT, `${name}.png`)
      // 탭 내용 아래의 빈 바탕을 잘라 낸다. 보고서에 넣으면 그 여백만큼
      // 그림이 작아져 글자가 안 읽힌다.
      const bottom = await page.evaluate(() => {
        // **보이는** 탭만 재야 한다. 탭 묶음은 숨은 칸도 전부 DOM 에 두므로,
        // 그냥 첫 칸을 재면 높이 0 이 나와 그림이 반 토막 난다(한 번 그랬다).
        const panel = document.querySelector('[role="tabpanel"][data-state="active"]')
          ?? [...document.querySelectorAll('[role="tabpanel"]')]
               .find((el) => el.getBoundingClientRect().height > 10)
        if (!panel) return null
        return Math.ceil(panel.getBoundingClientRect().bottom)
      })
      const height = Math.min(1000, Math.max(560, (bottom ?? 1000) + 28))
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1440, height } })
      shots.push(file)
      console.log(`  찍음  ${name}.png`)
    }
  }
} finally {
  if (browser) await browser.close()
  try { process.kill(-server.pid, "SIGTERM") } catch { server.kill("SIGTERM") }
  stub.close()
}

console.log(`\n${shots.length}장을 ${path.relative(ROOT, OUT)} 에 넣었습니다.`)
console.log("※ 화면 자료는 만들어 낸 값입니다 — 캡션에 그렇게 쓰십시오(README 참고).")
