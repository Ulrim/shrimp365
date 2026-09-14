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
 * 카드뉴스 렌더러(scripts/cardnews/render.mjs)와 같은 방식이며,
 * 마찬가지로 이미 설치된 Chromium 을 찾아 쓴다.
 */
import { chromium } from "playwright-core"
import { readFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..", "..")
const OUT = path.resolve(HERE, "..", "assets")

const PAGES = [
  ["01_시스템구성도.html", "01_시스템구성도.png"],
  ["02_부품사양표.html", "02_부품사양표.png"],
]

/** 설치된 Chromium 찾기 — 카드뉴스 렌더러와 같은 후보 목록. */
function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p))
}

const font = await readFile(path.join(ROOT, "public/fonts/PretendardVariable.woff2"))
const fontUri = `data:font/woff2;base64,${font.toString("base64")}`

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: findChromium() })

for (const [src, out] of PAGES) {
  const html = (await readFile(path.join(HERE, src), "utf8")).replace("__FONT__", fontUri)
  // deviceScaleFactor 2 — 한글 문서에 A4 가로 절반으로 넣어도 깨지지 않는 밀도.
  const page = await browser.newPage({ viewportSize: { width: 1600, height: 1200 }, deviceScaleFactor: 2 })
  await page.setContent(html, { waitUntil: "networkidle" })
  await page.evaluate(() => document.fonts.ready)
  await (await page.$("#sheet")).screenshot({ path: path.join(OUT, out) })
  console.log("✓", out)
  await page.close()
}

await browser.close()
