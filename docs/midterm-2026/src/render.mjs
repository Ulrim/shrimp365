#!/usr/bin/env node
/**
 * 중간점검 첨부 이미지 렌더러
 *
 *   node docs/midterm-2026/src/render.mjs
 *
 * 같은 폴더의 HTML 을 Chromium 으로 열어 ../assets/*.png 로 캡처한다.
 * 폰트는 public/fonts/PretendardVariable.woff2 를 data URI 로 심는다 —
 * 네트워크 폰트를 쓰면 오프라인에서 한글이 두부(□)로 나온다.
 *
 * 3번(모니터링 화면)만 앞에 한 단계가 더 붙는다. 화면 그림을 손으로 그리면
 * 실제 장비와 어긋나므로, raspberry-pi/make-preview.py 로 **장비의 화면 코드를
 * 그대로** 띄운 뒤 상태별로 찍어서 그 PNG 를 판에 붙인다. 장비 화면을 고치면
 * 이 스크립트를 다시 돌리는 것만으로 첨부 이미지가 따라온다.
 */
import { chromium } from "playwright-core"
import { readFile, mkdir, mkdtemp } from "node:fs/promises"
import { existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..", "..")
const OUT = path.resolve(HERE, "..", "assets")

/** 장비 화면 6컷. state 는 make-preview.py 의 STATES 순서, act 는 화면 안에서 부를 함수. */
const SCREENS = [
  { key: "A", state: 0, act: null },                          // 정상 수집
  { key: "B", state: 5, act: `openChart("do_level")` },       // 24시간 그래프
  { key: "C", state: 5, act: null },                          // 용존산소 위험
  { key: "D", state: 3, act: null },                          // 통신 두절
  { key: "E", state: 6, act: null },                          // 센서 오류
  { key: "F", state: 0, act: `openSettings();openSensors();setTimeout(scanBus,150)` },
]

const PAGES = [
  ["01_구성및기능설계.html", "01_구성및기능설계.png", 1600],
  ["02_부품사양검토확정.html", "02_부품사양검토확정.png", 1600],
  ["03_모니터링프로그램화면.html", "03_모니터링프로그램화면.png", 2000],
]

/** 설치된 Chromium 찾기 — 카드뉴스 렌더러와 같은 후보 목록. */
function findChromium() {
  return [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean).find((p) => existsSync(p))
}

const font = await readFile(path.join(ROOT, "public/fonts/PretendardVariable.woff2"))
const fontUri = `data:font/woff2;base64,${font.toString("base64")}`

await mkdir(OUT, { recursive: true })
const tmp = await mkdtemp(path.join(tmpdir(), "midterm-"))
const browser = await chromium.launch({ executablePath: findChromium() })

// ── 1단계: 장비 화면 6컷 ────────────────────────────────────────────────
//
// 미리보기는 장비가 쓰는 Noto Sans CJK KR 을 찾지만 렌더 환경에는 없다.
// 없는 채로 찍으면 한글이 중국어 글꼴로 나오므로 Pretendard 를 넣어 준다.
const preview = path.join(tmp, "kiosk-preview.html")
execFileSync("python3", [path.join(ROOT, "raspberry-pi/make-preview.py"), preview], { stdio: "inherit" })

const shot = {}
{
  const page = await browser.newPage({ viewportSize: { width: 1000, height: 900 }, deviceScaleFactor: 2 })
  await page.goto("file://" + preview, { waitUntil: "networkidle" })
  await page.waitForTimeout(600)

  const frame = page.frames().find((f) => f !== page.mainFrame())
  await frame.addStyleTag({
    content: `@font-face{font-family:PretendardX;src:url(${fontUri}) format("woff2");font-weight:100 900;font-display:block}
              body,button,input{font-family:PretendardX,system-ui,sans-serif !important}`,
  })
  await page.waitForTimeout(300)

  for (const s of SCREENS) {
    await page.evaluate((i) => pick(i), s.state)
    await page.waitForTimeout(350)
    if (s.act) { await frame.evaluate(s.act); await page.waitForTimeout(500) }
    const buf = await page.locator("#dev").screenshot()
    shot[s.key] = `data:image/png;base64,${buf.toString("base64")}`
    // 다음 컷에 겹치지 않게 열어 둔 화면을 닫는다.
    await frame.evaluate(`if(typeof closeChart==="function")closeChart();if(typeof closeSettings==="function")closeSettings()`)
    await page.waitForTimeout(250)
  }
  await page.close()
}

// ── 2단계: 판 세 장 ─────────────────────────────────────────────────────
for (const [src, out, width] of PAGES) {
  let html = (await readFile(path.join(HERE, src), "utf8")).replace("__FONT__", fontUri)
  for (const [key, uri] of Object.entries(shot)) html = html.replace(`__${key}__`, uri)

  // 3번 판은 이미 화면 PNG 가 2배로 들어가 있어 1.5배면 충분하다.
  // 나머지는 2배 — 한글 문서에 A4 가로 절반으로 넣어도 깨지지 않는 밀도.
  const scale = src.startsWith("03") ? 1.5 : 2
  const page = await browser.newPage({ viewportSize: { width, height: 1200 }, deviceScaleFactor: scale })
  await page.setContent(html, { waitUntil: "networkidle" })
  await page.evaluate(() => document.fonts.ready)
  await (await page.$("#sheet")).screenshot({ path: path.join(OUT, out) })
  console.log("✓", out)
  await page.close()
}

await browser.close()
