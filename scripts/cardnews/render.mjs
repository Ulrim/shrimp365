#!/usr/bin/env node
/**
 * 카드뉴스 이미지 렌더러
 *
 *   npm run cardnews scripts/cardnews/data/<slug>.json
 *
 * JSON을 template.html에 주입해 Chromium으로 열고, 카드 한 장씩
 * public/cardnews/<slug>/01.png … 08.png 로 캡처한다.
 *
 * 폰트는 public/fonts/PretendardVariable.woff2 를 data URI로 심는다.
 * 네트워크 폰트를 쓰면 오프라인에서 한글이 두부(□)로 나오고 렌더가 비결정적이 된다.
 */

import { chromium } from "playwright"
import { readFile, mkdir, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..")
const SIZE = 1080

function die(msg) {
  console.error(`\n  ✗ ${msg}\n`)
  process.exit(1)
}

/**
 * 이 컨테이너에는 Chromium이 /opt/pw-browsers 에 미리 깔려 있지만,
 * playwright 버전이 기대하는 빌드 번호와 다를 수 있다. 기본 실행이 실패하면
 * 설치된 빌드를 직접 찾아 쓴다.
 */
async function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!base || !existsSync(base)) return undefined
  const entries = await readdir(base).catch(() => [])
  const candidates = entries
    .filter((e) => e.startsWith("chromium-"))
    .sort()
    .reverse()
    .map((e) => path.join(base, e, "chrome-linux", "chrome"))
  return candidates.find((p) => existsSync(p))
}

async function launch() {
  try {
    return await chromium.launch()
  } catch (err) {
    const executablePath = await findChromium()
    if (!executablePath) throw err
    console.log(`  · 설치된 Chromium 사용: ${executablePath}`)
    return await chromium.launch({ executablePath })
  }
}

function validate(data) {
  if (!data.slug || typeof data.slug !== "string") die("JSON에 slug가 없습니다.")
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(data.slug)) {
    die(`slug는 영문 소문자 kebab-case여야 합니다: "${data.slug}"`)
  }
  if (data.slug.length > 80) die("slug는 80자를 넘을 수 없습니다. (API normalize 제약)")
  if (!Array.isArray(data.cards) || data.cards.length === 0) die("JSON에 cards 배열이 없습니다.")
  if (data.cards.length > 30) die("카드는 30장을 넘을 수 없습니다. (API normalize 제약)")

  const first = data.cards[0]
  const last = data.cards[data.cards.length - 1]
  if (first.type !== "cover") console.warn("  ! 첫 장이 cover가 아닙니다.")
  if (last.type !== "outro") console.warn("  ! 마지막 장이 outro가 아닙니다.")
}

async function main() {
  const input = process.argv[2]
  if (!input) die("사용법: npm run cardnews <카드 JSON 경로>")

  const jsonPath = path.resolve(process.cwd(), input)
  if (!existsSync(jsonPath)) die(`파일을 찾을 수 없습니다: ${jsonPath}`)

  const data = JSON.parse(await readFile(jsonPath, "utf8"))
  validate(data)

  const fontPath = path.join(ROOT, "public", "fonts", "PretendardVariable.woff2")
  if (!existsSync(fontPath)) die(`폰트가 없습니다: ${fontPath}`)
  const fontUri = `data:font/woff2;base64,${(await readFile(fontPath)).toString("base64")}`

  const html = (await readFile(path.join(HERE, "template.html"), "utf8"))
    .replace("__FONT_URI__", fontUri)
    // JSON을 <script> 안에 넣으므로 </script> 조기 종료만 막으면 된다.
    .replace("__CARDS_JSON__", JSON.stringify(data).replace(/<\//g, "<\\/"))

  const outDir = path.join(ROOT, "public", "cardnews", data.slug)
  await mkdir(outDir, { recursive: true })

  const browser = await launch()
  try {
    const page = await browser.newPage({
      viewport: { width: SIZE, height: SIZE },
      deviceScaleFactor: 1,
    })
    await page.setContent(html, { waitUntil: "load" })
    await page.evaluate(() => document.fonts.ready)

    const sections = await page.locator("section.card").all()
    if (sections.length !== data.cards.length) {
      die(`카드 렌더 개수가 맞지 않습니다: ${sections.length} / ${data.cards.length}`)
    }

    // 글자가 많으면 카드 밖으로 밀려나는데, 캡처는 1080px에서 잘리기 때문에
    // 결과 PNG만 봐서는 놓치기 쉽다. 렌더 시점에 넘침을 잡는다.
    const overflows = await page.evaluate((size) =>
      [...document.querySelectorAll("section.card")].flatMap((el, i) => {
        const pad = 88
        const bottom = Math.max(
          0,
          ...[...el.querySelectorAll("*")].map((c) => c.getBoundingClientRect().bottom)
        )
        const top = el.getBoundingClientRect().top
        const used = bottom - top
        return used > size - pad / 2 ? [{ card: i + 1, used: Math.round(used) }] : []
      }), SIZE)

    for (const o of overflows) {
      console.warn(`  ! ${String(o.card).padStart(2, "0")}번 카드가 넘칩니다 (${o.used}px / ${SIZE}px) — 글자를 줄이세요`)
    }

    for (const [i, section] of sections.entries()) {
      const name = `${String(i + 1).padStart(2, "0")}.png`
      await section.screenshot({ path: path.join(outDir, name) })
      console.log(`  ✓ ${path.relative(ROOT, path.join(outDir, name))}`)
    }

    if (overflows.length) {
      die(`카드 ${overflows.length}장이 넘쳤습니다. 위 경고를 보고 글자를 줄인 뒤 다시 렌더하세요.`)
    }
  } finally {
    await browser.close()
  }

  console.log(`\n  카드 ${data.cards.length}장 완료 → public/cardnews/${data.slug}/`)

  // 시드 SQL의 images 배열에 그대로 붙여 넣을 수 있게 출력한다.
  const images = data.cards.map((_, i) => `/cardnews/${data.slug}/${String(i + 1).padStart(2, "0")}.png`)
  console.log(`\n  images:\n  array[${images.map((p) => `$cn$${p}$cn$`).join(",")}]::text[]`)
  console.log(`\n  다음: 이미지를 눈으로 확인한 뒤 시드 SQL을 작성하세요. (cardnews-publish 스킬)\n`)
}

main().catch((err) => die(err.stack || err.message))
