// diagrams.html 의 그림 세 장을 PNG 로 굽는다.
//
// docs/midterm-2026/src/render.mjs 와 같은 방식이다 — 폰트를 data URI 로 심고
// 2배 배율로 찍는다. 네트워크 폰트를 쓰면 오프라인에서 한글이 두부(□)로 나오고,
// 1배로 찍으면 한글 문서에 넣었을 때 글자가 뭉갠다.
//
// 실행 (저장소 뿌리에서):
//
//     node docs/result-03-bluestartup/src/render-diagrams.mjs
import { chromium } from "playwright-core"
import { readFile, mkdir } from "node:fs/promises"
import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..", "..")
const OUT = path.resolve(HERE, "..", "assets")

const SHEETS = [
  ["#s1", "01_시스템구성도.png"],
  ["#s2", "02_공유기뒤_수조보기.png"],
  ["#s3", "03_원격업데이트_흐름.png"],
]

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM
  try {
    const dir = readdirSync("/opt/pw-browsers").find((d) => d.startsWith("chromium-"))
    if (dir) return `/opt/pw-browsers/${dir}/chrome-linux/chrome`
  } catch { /* 아래 후보로 */ }
  return ["/opt/pw-browsers/chromium", "/usr/bin/chromium", "/usr/bin/google-chrome"]
    .find((p) => existsSync(p))
}

const font = await readFile(path.join(ROOT, "public/fonts/PretendardVariable.woff2"))
const html = (await readFile(path.join(HERE, "diagrams.html"), "utf8"))
  .replace("__FONT__", `data:font/woff2;base64,${font.toString("base64")}`)

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch({
  executablePath: findChromium(),
  args: ["--no-sandbox", "--no-proxy-server"],
})
const page = await browser.newPage({
  viewport: { width: 1180, height: 1200 },
  deviceScaleFactor: 2,
})
await page.setContent(html, { waitUntil: "load" })
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(400)

for (const [selector, out] of SHEETS) {
  await (await page.$(selector)).screenshot({ path: path.join(OUT, out) })
  console.log("  구움 ", out)
}
await browser.close()
console.log(`\n세 장을 ${path.relative(ROOT, OUT)} 에 넣었습니다.`)
