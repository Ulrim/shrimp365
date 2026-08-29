/**
 * KPI 산식 차분 검증 — TypeScript 이식본 vs 원본 Python 엔진.
 *
 * `lib/mrv/kpi/*.ts` 는 `mrv-platform/packages/kpi/culiver_kpi` 의 이식본이다. 이 스크립트는
 * 원본 엔진이 만든 기준값(`kpi-fixtures.json`)과 이식본의 산출을 250여 건 대조해 산식이
 * 어긋나지 않았음을 증명한다. 산식을 고칠 때는 반드시 이 검증을 다시 통과시킬 것.
 *
 * 실행:
 *   python3 scripts/mrv/gen_kpi_fixtures.py > scripts/mrv/kpi-fixtures.json   # 기준값 갱신
 *   node scripts/mrv/verify-kpi.mjs
 *
 * TypeScript 를 그대로 실행할 수 없으므로 tsc 로 CommonJS 임시 산출물을 만들어 불러온다
 * (빌드 산출물은 검증이 끝나면 지운다 — 저장소에 남기지 않는다).
 */

import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const outDir = mkdtempSync(join(tmpdir(), "mrv-kpi-"))

try {
  execFileSync(
    "npx",
    [
      "tsc",
      ...["energy", "feed", "oxygen", "mortality", "scope2", "recommend", "comparison",
        "status", "config", "types", "internal"].map((m) => join(ROOT, "lib/mrv/kpi", `${m}.ts`)),
      "--outDir", outDir,
      "--module", "commonjs",
      "--target", "es2022",
      "--moduleResolution", "node",
      "--strict",
      "--skipLibCheck",
    ],
    { stdio: "inherit", cwd: ROOT },
  )

  const require = createRequire(join(outDir, "x.cjs"))
  const energy = require(join(outDir, "energy.js"))
  const feed = require(join(outDir, "feed.js"))
  const oxygen = require(join(outDir, "oxygen.js"))
  const mortality = require(join(outDir, "mortality.js"))
  const scope2 = require(join(outDir, "scope2.js"))
  const recommend = require(join(outDir, "recommend.js"))
  const comparison = require(join(outDir, "comparison.js"))
  const status = require(join(outDir, "status.js"))

  const fixtures = JSON.parse(
    readFileSync(join(HERE, "kpi-fixtures.json"), "utf8"),
  )

  const d = (s) => new Date(s)
  const power = (r) => ({ ...r, ts: d(r.ts) })
  const biomass = (p) => ({ ...p, ts: d(p.ts) })

  /** 부동소수 재현 오차 허용치. 두 언어 모두 IEEE754 double 이라 순수 산술은 비트 단위로
   *  같아야 하지만, 합산 순서가 같음을 전제로 하는 만큼 아주 작은 여유만 둔다. */
  const EPS = 1e-12

  const failures = []

  function cmp(path, actual, expected) {
    if (expected === null || expected === undefined) {
      if (actual !== null && actual !== undefined) {
        failures.push(`${path}: expected null, got ${JSON.stringify(actual)}`)
      }
      return
    }
    if (typeof expected === "number") {
      if (typeof actual !== "number") {
        failures.push(`${path}: expected number ${expected}, got ${JSON.stringify(actual)}`)
        return
      }
      const scale = Math.max(1, Math.abs(expected))
      if (Math.abs(actual - expected) > EPS * scale) {
        failures.push(`${path}: expected ${expected}, got ${actual}`)
      }
      return
    }
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual) || actual.length !== expected.length) {
        failures.push(`${path}: array mismatch (len ${actual?.length} vs ${expected.length})`)
        return
      }
      expected.forEach((v, i) => cmp(`${path}[${i}]`, actual[i], v))
      return
    }
    if (typeof expected === "object") {
      for (const k of Object.keys(expected)) cmp(`${path}.${k}`, actual?.[k], expected[k])
      return
    }
    if (actual !== expected) {
      failures.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    }
  }

  const THRESHOLDS = status.DEFAULT_KPI_THRESHOLDS

  let checked = 0
  for (const c of fixtures.cases) {
    const i = c.input
    let actual
    switch (c.kind) {
      case "ei":
        actual = energy.computeEi(
          i.powerReadings.map(power), biomass(i.biomassStart), biomass(i.biomassEnd),
          d(i.periodStart), d(i.periodEnd), i.config, i.configVersion,
        )
        break
      case "fcr":
        actual = feed.computeFcr(
          i.feedReadings.map(power), biomass(i.biomassStart), biomass(i.biomassEnd),
          d(i.periodStart), d(i.periodEnd), i.config, i.configVersion,
        )
        break
      case "oei":
        actual = oxygen.computeOei(
          i.doReadings.map(power), i.aerationReadings.map(power),
          biomass(i.biomassStart), biomass(i.biomassEnd), i.band,
          d(i.periodStart), d(i.periodEnd), i.config, i.configVersion,
        )
        break
      case "mortality":
        actual = mortality.computeMortality(
          i.mortalityReadings.map(power), i.stockedCount,
          d(i.periodStart), d(i.periodEnd), i.config, i.configVersion,
        )
        break
      case "scope2":
        actual = scope2.computeScope2Reduction(i)
        break
      case "status":
        actual = status.classifyMetricStatus(i.value, i.direction, THRESHOLDS[i.metric])
        break
      case "comparison":
        actual = comparison.compareMetric(i.baselineValue, i.currentValue, i.direction)
        break
      case "recommend":
        actual = recommend.computeRecommendation(
          {
            doLatest: i.doLatest ? power(i.doLatest) : null,
            doBand: i.doBand,
            waterTempLatest: i.waterTempLatest,
            biomassLatestKg: i.biomassLatestKg,
            feedHistory: i.feedHistory.map(power),
            aerationPowerRecentKwh: i.aerationPowerRecentKwh,
            periodStart: d(i.periodStart), periodEnd: d(i.periodEnd),
          },
          require(join(outDir, "types.js")).DEFAULT_RECOMMEND_CONFIG,
          i.configVersion,
        )
        break
      default:
        failures.push(`${c.name}: unknown kind ${c.kind}`)
        continue
    }
    cmp(c.name, actual, c.expected)
    checked += 1
  }

  if (failures.length > 0) {
    console.error(`✗ KPI 차분 검증 실패 — ${failures.length}건 불일치\n`)
    for (const f of failures.slice(0, 40)) console.error("  " + f)
    if (failures.length > 40) console.error(`  ... 외 ${failures.length - 40}건`)
    process.exitCode = 1
  } else {
    console.log(`✓ KPI 차분 검증 통과 — ${checked}개 시나리오가 원본 Python 엔진과 일치`)
  }
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
