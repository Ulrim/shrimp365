// 엔진 코드 → 화면 문구 사전의 **전수 대조.**
//
//   node scripts/production/verify-i18n.mjs
//
// 왜 필요한가 — 엔진 넷은 문장을 만들지 않고 코드만 돌려준다. 화면이 그 코드를
// `t.engines.*` 사전으로 번역하는데, `ExclusionChip` 은 코드 유니온이 세 엔진에
// 걸쳐 있어 `Record<string, string | undefined>` 로 색인한다. **그래서 사전에
// 코드가 빠져 있어도 tsc 가 못 잡고, 화면에는 `price_elasticity_lower_bound`
// 같은 영문 코드가 그대로 찍힌다.** 농가 화면에 날것의 코드가 나가는 것은
// 번역이 없는 것보다 나쁘다 — 경고가 경고로 안 읽힌다.
//
// 테스트 프레임워크를 들이지 않는다(이 저장소에 없다). 엔진 verify 4종과 같은
// 방식이다. 사전은 .ts 라 Node 22 의 타입 스트리핑으로 그대로 불러 쓰고,
// **코드 목록은 소스의 유니온 선언에서 뽑는다** — 목록을 이 파일에 손으로 베껴
// 두면 엔진에 코드가 늘었을 때 이 검증이 같이 낡는다.

import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

// lib 안쪽 import 는 확장자가 없고(tsconfig "bundler"), `@/` 별칭을 쓴다.
// Node 는 둘 다 모르므로 여기서 메운다. **제품 코드를 검증 도구에 맞추지 않는다.**
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const abs = path.join(ROOT, specifier.slice(2))
      for (const cand of [abs, `${abs}.ts`, `${abs}.tsx`, path.join(abs, "index.ts")]) {
        try {
          return nextResolve(pathToFileURL(cand).href, context)
        } catch {
          // 다음 후보로
        }
      }
    }
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        try {
          return nextResolve(`${specifier}/index.ts`, context)
        } catch {
          // 원래 지정자로 되돌린다.
        }
      }
    }
    return nextResolve(specifier, context)
  },
})

/**
 * 소스의 유니온 선언에서 문자열 리터럴 멤버를 뽑는다.
 *
 * 템플릿 리터럴 멤버(`` `cost_${CostItem}` ``)는 따로 받는다 — 정규식으로
 * 펼칠 수 없고, 펼치는 규칙을 여기 적으면 그 규칙이 엔진과 어긋날 수 있다.
 */
function unionMembers(file, typeName) {
  const src = readFileSync(path.join(ROOT, file), "utf8")
  const start = src.indexOf(`export type ${typeName} =`)
  if (start < 0) throw new Error(`${typeName} 선언을 ${file} 에서 못 찾았다`)
  // 선언은 다음 `export ` 또는 빈 줄 두 개 전까지다.
  const rest = src.slice(start + `export type ${typeName} =`.length)
  const end = rest.search(/\n(?:export |const |function |\/\*\*\n(?=.*\n(?:export|const|function)))/)
  const body = end < 0 ? rest : rest.slice(0, end)
  // 주석을 먼저 지운다. JSDoc 본문에 따옴표가 들어 있으면 멤버로 잘못 잡힌다.
  const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  // **선두 `|` 를 요구하면 안 된다.** 인라인 유니온
  // (`export type X = "a" | "b"`)의 **첫 멤버에는 `|` 가 없어서** 조용히
  // 빠지고, 빠진 코드는 「통과」로 보고된다. 실제로 그렇게 네 개가 검사되지
  // 않고 있었다(price_basis_not_selected · live · wholesale · krw).
  const out = []
  for (const m of code.matchAll(/"([a-z0-9_]+)"/g)) out.push(m[1])
  if (out.length === 0) throw new Error(`${typeName} 에서 멤버를 하나도 못 뽑았다`)
  return out
}

const COST_ITEMS = ["pl", "feed", "electricity", "labor", "chemicals", "other"]

const EXPECTED = {
  // ── 사전별로 「어느 유니온을 덮어야 하는가」 ──────────────────────────
  exclusion: [
    ...unionMembers("lib/profitability/exclusions.ts", "ExclusionCode"),
    ...unionMembers("lib/pricing/exclusions.ts", "PricingExclusionCode"),
    ...unionMembers("lib/harvest/exclusions.ts", "HarvestExclusionCode"),
  ],
  fitFailure: unionMembers("lib/growth/gompertz.ts", "FitFailure"),
  cddFailure: unionMembers("lib/growth/gompertz.ts", "CddForAbwFailure"),
  growthExcluded: unionMembers("lib/growth/gompertz.ts", "ExclusionReason"),
  priceFailure: unionMembers("lib/profitability/channel.ts", "PriceFailure"),
  sizePriceFailure: unionMembers("lib/pricing/size-price.ts", "SizePriceFailure"),
  breakEvenFailure: unionMembers("lib/profitability/sensitivity.ts", "BreakEvenFailure"),
  decision: unionMembers("lib/harvest/window.ts", "HarvestDecisionCode"),
  windowFailure: [
    ...unionMembers("lib/harvest/window.ts", "HarvestWindowFailure"),
    // HarvestWindowFailure 는 HarvestAnchorFailure 를 품는다(유니온 확장).
    ...unionMembers("lib/harvest/price.ts", "HarvestAnchorFailure"),
  ],
  candidateFailure: unionMembers("lib/harvest/candidate.ts", "CandidateFailure"),
  marginalSign: unionMembers("lib/harvest/window.ts", "MarginalSign"),
  survivalSource: unionMembers("lib/harvest/survival.ts", "DailySurvivalSource"),
  stage: unionMembers("lib/pricing/constants.ts", "DistributionStage"),
  form: unionMembers("lib/pricing/constants.ts", "ProductForm"),
  unit: unionMembers("lib/profitability/exclusions.ts", "ExclusionUnit"),
  channel: unionMembers("lib/profitability/constants.ts", "SalesChannel"),
  attribution: [
    // AttributionCode 의 템플릿 리터럴 멤버는 정규식으로 못 펼친다. 비용 6항목을
    // COST_ITEMS 에서 직접 만든다 — 엔진의 CostItem 과 같은 목록이다.
    ...unionMembers("lib/harvest/candidate.ts", "AttributionCode"),
    ...COST_ITEMS.map(i => `cost_${i}`),
  ],
}

// exclusionDetail 은 exclusion 과 같은 키 집합이어야 한다.
EXPECTED.exclusionDetail = EXPECTED.exclusion
// groupHint 는 group 과 같다.
const GROUPS = ["quantified", "unquantified", "denominator"]
EXPECTED.group = GROUPS
EXPECTED.groupHint = GROUPS
EXPECTED.source = ["growth", "pricing", "profitability", "harvest"]
EXPECTED.bandSource = ["price_elasticity", "abw_uncertainty"]

const { ko, en, vi, id } = await import(pathToFileURL(path.join(ROOT, "lib/i18n/index.ts")).href)
const DICTS = { ko, en, vi, id }

let failures = 0
let checked = 0

for (const [dictName, codes] of Object.entries(EXPECTED)) {
  if (codes.length === 0) {
    console.log(`✗ ${dictName}: 유니온에서 코드를 하나도 못 뽑았다 — 추출 정규식이 낡았다`)
    failures++
    continue
  }
  for (const [lang, dict] of Object.entries(DICTS)) {
    const table = dict.engines?.[dictName]
    if (table === undefined) {
      console.log(`✗ ${lang}.engines.${dictName} 가 없다`)
      failures++
      continue
    }
    const missing = codes.filter(c => typeof table[c] !== "string" || table[c] === "")
    // 사전에만 있고 엔진에 없는 키 — 낡은 번역이다. 치명적이진 않지만 알린다.
    const extra = Object.keys(table).filter(k => !codes.includes(k))
    checked += codes.length
    if (missing.length > 0) {
      console.log(`✗ ${lang}.engines.${dictName}: 누락 ${missing.length}건 — ${missing.join(", ")}`)
      failures++
    }
    if (extra.length > 0) {
      console.log(`· ${lang}.engines.${dictName}: 엔진에 없는 키 ${extra.length}건 — ${extra.join(", ")}`)
    }
  }
}

// ── 비용 항목 이름 재사용 확인 ────────────────────────────────────────────
// cost_not_recorded 는 item 으로 t.production.costCategories[item] 을 쓴다.
for (const [lang, dict] of Object.entries(DICTS)) {
  const missing = COST_ITEMS.filter(i => typeof dict.production?.costCategories?.[i] !== "string")
  checked += COST_ITEMS.length
  if (missing.length > 0) {
    console.log(`✗ ${lang}.production.costCategories: 누락 — ${missing.join(", ")}`)
    failures++
  }
}

// ── {{n}} 보간 자리 확인 ──────────────────────────────────────────────────
// Tpl 접미사 키는 네 언어 모두 {{n}} 을 들고 있어야 한다. 빠지면 수가 사라진다.
for (const [lang, dict] of Object.entries(DICTS)) {
  for (const [section, table] of [["production", dict.production], ["engines", dict.engines]]) {
    for (const [key, value] of Object.entries(table ?? {})) {
      if (!key.endsWith("Tpl") || typeof value !== "string") continue
      checked++
      if (!value.includes("{{n}}")) {
        console.log(`✗ ${lang}.${section}.${key}: {{n}} 자리가 없다 — "${value}"`)
        failures++
      }
    }
  }
}

console.log("")
if (failures === 0) {
  console.log(`전부 통과 — ${checked}항목`)
  process.exit(0)
}
console.log(`실패 ${failures}건 — ${checked}항목 중`)
process.exit(1)
