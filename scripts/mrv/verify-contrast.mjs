/**
 * MRV 화면의 글자·배경 대비를 **토큰 값에서 직접 계산해** 4.5:1 미만을 막는다.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 * `--mrv-muted` 는 흰 배경(4.75:1)에서만 AA 를 넘는다. 틴트 배경 넷에서는 전부 미달이다:
 *
 *     text-mrv-muted on bg-mrv-na-bg     4.13:1
 *     text-mrv-muted on bg-mrv-red-bg    4.18:1
 *     text-mrv-muted on bg-mrv-amber-bg  4.26:1
 *     text-mrv-muted on bg-mrv-green-bg  4.32:1
 *
 * 이 조합이 화면 11곳에 있었다. 주석으로 두 번 경고해 두었는데도 계속 다시 들어왔다 —
 * 사람 눈으로는 "흐린 글씨" 로 보여 의도한 것처럼 읽히기 때문이다. 그래서 글로 적는 대신
 * 계산해서 막는다.
 *
 * ── 무엇을 계산하는가 ───────────────────────────────────────────────────────
 * 색은 `app/globals.css` 의 `--mrv-*` 선언에서 읽는다. **값을 이 파일에 복사하지
 * 않는다** — 복사하면 토큰을 고쳤을 때 검사가 옛 값으로 통과한다. 토큰이 바뀌면 이
 * 검사의 판정도 같이 바뀌어야 한다.
 *
 * ── 무엇을 판정하고 무엇을 넘기는가 ─────────────────────────────────────────
 * **한 문자열 안에** `bg-mrv-*` 와 `text-mrv-*` 가 같이 있으면 그 쌍을 판정한다.
 * 삼항의 각 가지는 그 자체로 문자열이므로 가지마다 따로 걸린다.
 *
 * 두 가지는 **일부러 넉넉하게** 잡는다. 놓치는 것보다 헛울리는 편이 낫기 때문이다:
 *
 *   · 템플릿 리터럴은 통째로 한 덩이로 본다. `${cond ? "bg-a" : "text-b"}` 처럼 가지가
 *     갈려 있어도 같은 덩이로 치므로, **실제로는 같이 나오지 않는 쌍**이 보고될 수 있다.
 *     그런 보고를 보면 사람이 그 자리를 열어 보면 된다. 반대로 가지 안의 진짜 미달을
 *     놓치지는 않는다.
 *   · 반투명(`bg-mrv-primary/10`)은 아래 깔린 색을 알아야 하므로 판정하지 않고 따로
 *     적는다. 지금 걸리는 자리는 `components/mrv/shell.tsx` 의 상단 탭 하나뿐이고,
 *     손으로 계산해 두었다 — 켜진 탭은 `text-mrv-primary` 가 흰 배경 기준 7.44:1,
 *     `--mrv-bg` 기준 7.12:1 로 AA 를 넘는다. 꺼진 탭의 `text-mrv-muted` 는 그 틴트가
 *     아니라 흰 배경 위에 있다(4.75:1).
 *
 * 큰 글자(18.66px 굵게 / 24px)는 AA 가 3:1 이지만 **여기서는 구분하지 않는다.**
 * 클래스 문자열만 보고 실제 렌더 크기를 알 수 없고, MRV 화면의 틴트 배경은 전부 본문
 * ·배지라 4.5:1 로 잡는 편이 안전하다.
 *
 * 실행: node scripts/mrv/verify-contrast.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const AA = 4.5

// ── 색 계산 ─────────────────────────────────────────────────────────────────
/** CSS `hsl()` 의 H S% L% → sRGB 0..1. */
function hslToRgb(h, s, l) {
  s /= 100
  l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

/** WCAG 상대휘도. */
function luminance([r, g, b]) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(fg, bg) {
  const a = luminance(fg)
  const b = luminance(bg)
  const [hi, lo] = a >= b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

function hex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`
}

// ── 토큰 읽기 ───────────────────────────────────────────────────────────────
/**
 * `app/globals.css` 의 `--mrv-이름: H S% L%;` 를 모은다.
 *
 * 다크 모드 등 뒤쪽 블록이 같은 이름을 다시 선언하면 **나중 값이 이긴다** — CSS 와
 * 같은 순서다. 지금은 `/mrv` 화면이 라이트 전용이라 선언이 한 번뿐이지만, 나중에
 * 다크 블록이 생겨도 검사가 실제로 적용되는 값을 보게 된다.
 */
function readTokens() {
  const css = readFileSync(join(ROOT, "app/globals.css"), "utf8")
  const re = /--mrv-([a-z0-9-]+)\s*:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*;/g
  const out = new Map()
  for (const m of css.matchAll(re)) {
    out.set(m[1], hslToRgb(Number(m[2]), Number(m[3]), Number(m[4])))
  }
  if (out.size === 0) throw new Error("app/globals.css 에서 --mrv-* 토큰을 하나도 읽지 못했다")
  return out
}

// ── 화면 훑기 ───────────────────────────────────────────────────────────────
const DIRS = ["app/mrv", "components/mrv", "lib/mrv/ui"]

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(tsx|ts)$/.test(p)) acc.push(p)
  }
  return acc
}

/** 큰따옴표·작은따옴표·백틱 문자열을 통째로 하나씩 꺼낸다(줄바꿈 포함). */
const STRING_RE = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g
// 탐욕적으로 읽어야 `bg-mrv-na-bg` 가 `bg-mrv-na` 로 잘리지 않는다.
// `/10` 같은 알파 접미사는 따로 잡아 둔다 — 반투명은 아래 깔린 색을 알아야 하므로
// 정적으로 판정하지 않고 '판정 못 한 자리' 로 넘긴다.
const BG_RE = /\bbg-mrv-([a-z0-9-]+)(\/\d+)?(?![\w-])/g
const TEXT_RE = /\btext-mrv-([a-z0-9-]+)(\/\d+)?(?![\w-])/g

/** 주석 줄은 건너뛴다 — 이 파일처럼 금지 조합을 **설명하는** 글이 있다. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + m.slice(p.length).replace(/./g, " "))
}

const tokens = readTokens()
const failures = []
const unresolved = []
let pairsChecked = 0

for (const file of DIRS.flatMap((d) => walk(join(ROOT, d)))) {
  const rel = relative(ROOT, file)
  const src = stripComments(readFileSync(file, "utf8"))

  for (const m of src.matchAll(STRING_RE)) {
    const text = m[1] ?? m[2] ?? m[3] ?? ""
    const bgs = [...text.matchAll(BG_RE)].map((x) => (x[2] ? `${x[1]}${x[2]}` : x[1]))
    const fgs = [...text.matchAll(TEXT_RE)].map((x) => (x[2] ? `${x[1]}${x[2]}` : x[1]))
    if (bgs.length === 0 || fgs.length === 0) continue
    const line = src.slice(0, m.index).split("\n").length

    for (const bg of new Set(bgs)) {
      for (const fg of new Set(fgs)) {
        const bgRgb = tokens.get(bg)
        const fgRgb = tokens.get(fg)
        if (!bgRgb || !fgRgb) {
          const why = bg.includes("/") || fg.includes("/") ? "반투명" : "토큰 없음"
          unresolved.push(`${rel}:${line} — ${why}: bg-mrv-${bg} / text-mrv-${fg}`)
          continue
        }
        pairsChecked += 1
        const r = contrast(fgRgb, bgRgb)
        if (r < AA) {
          failures.push(
            `${rel}:${line}\n       text-mrv-${fg} (${hex(fgRgb)}) on ` +
              `bg-mrv-${bg} (${hex(bgRgb)}) = ${r.toFixed(2)}:1  (필요 ${AA}:1)`,
          )
        }
      }
    }
  }
}

// ── 결과 ────────────────────────────────────────────────────────────────────
console.log(`  토큰 ${tokens.size}개 · 같은 문자열 안의 배경·글자 쌍 ${pairsChecked}건 판정`)

if (unresolved.length) {
  console.log(`\n  판정하지 못한 자리 ${unresolved.length}건(토큰이 아닌 이름):`)
  for (const u of unresolved.slice(0, 20)) console.log(`    ${u}`)
}

if (failures.length) {
  console.error(`\n  대비 미달 ${failures.length}건:`)
  for (const f of failures) console.error(`    ${f}`)
  console.error(
    "\n  틴트 배경(bg-mrv-*-bg)의 보조 문구·배지에는 text-mrv-na 를,\n" +
      "  경고 본문에는 text-mrv-fg 를 쓴다. text-mrv-muted 는 흰 배경 전용이다.",
  )
  process.exit(1)
}

console.log("  모두 통과 — 4.5:1 미만 조합 없음")
