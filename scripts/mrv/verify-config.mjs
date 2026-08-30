/**
 * KPI config 매핑 차분 검증 — TypeScript 이식본 vs 원본 Python.
 *
 * `lib/mrv/kpi/config.ts` 는 DB 의 params_json 을 산출 파라미터로 옮기는 길목이다.
 * 산식이 멀쩡해도 이 계층이 어긋나면 KPI 값이 통째로 달라지는데, 그런 오류는 화면에
 * 아무 표시도 남기지 않는다. 그래서 정상 파싱뿐 아니라 **어떤 문서를 거부하는가**까지
 * 원본과 맞춰 둔다 — 잘못된 설정을 조용히 기본값으로 메우면 그 자체가 오염이다.
 *
 * 실행:
 *   python3 scripts/mrv/gen_config_fixtures.py > scripts/mrv/config-fixtures.json
 *   node scripts/mrv/verify-config.mjs
 */

import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const outDir = mkdtempSync(join(tmpdir(), "mrv-config-"))

try {
  execFileSync(
    "npx",
    [
      "tsc",
      ...["config", "status", "types", "internal"].map((m) =>
        join(ROOT, "lib/mrv/kpi", `${m}.ts`),
      ),
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
  const config = require(join(outDir, "config.js"))

  const PARSERS = {
    ei: config.eiConfigFromParams,
    fcr: config.fcrConfigFromParams,
    oei: config.oeiConfigFromParams,
    mortality: config.mortalityConfigFromParams,
    alerting: config.alertingConfigFromParams,
    recommend: config.recommendConfigFromParams,
  }
  const SERIALIZERS = {
    ei: config.eiConfigToParams,
    fcr: config.fcrConfigToParams,
    oei: config.oeiConfigToParams,
    mortality: config.mortalityConfigToParams,
    alerting: config.alertingConfigToParams,
    recommend: config.recommendConfigToParams,
  }

  const fixtures = JSON.parse(readFileSync(join(HERE, "config-fixtures.json"), "utf8"))
  const failures = []

  function cmp(path, actual, expected) {
    if (expected === null || expected === undefined) {
      if (actual !== null && actual !== undefined) {
        failures.push(`${path}: expected null, got ${JSON.stringify(actual)}`)
      }
      return
    }
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual) || actual.length !== expected.length) {
        failures.push(
          `${path}: array mismatch (${JSON.stringify(actual)} vs ${JSON.stringify(expected)})`,
        )
        return
      }
      expected.forEach((v, i) => cmp(`${path}[${i}]`, actual[i], v))
      return
    }
    if (typeof expected === "object") {
      for (const k of Object.keys(expected)) cmp(`${path}.${k}`, actual?.[k], expected[k])
      return
    }
    if (typeof expected === "number") {
      if (typeof actual !== "number" || Math.abs(actual - expected) > 1e-12) {
        failures.push(`${path}: expected ${expected}, got ${JSON.stringify(actual)}`)
      }
      return
    }
    if (actual !== expected) {
      failures.push(
        `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      )
    }
  }

  let checked = 0
  for (const c of fixtures.cases) {
    const parse = PARSERS[c.metric]
    const serialize = SERIALIZERS[c.metric]

    let parsed
    let threw = false
    try {
      parsed = parse(c.params)
    } catch {
      threw = true
    }

    if (c.rejects) {
      if (!threw) {
        failures.push(
          `${c.name}: 원본은 거부하는 문서인데 이식본은 통과시킴 → ${JSON.stringify(parsed)}`,
        )
      }
      checked += 1
      continue
    }

    if (threw) {
      failures.push(`${c.name}: 원본은 통과하는 문서인데 이식본이 거부함`)
      checked += 1
      continue
    }

    cmp(c.name, parsed, c.expected)

    // 라운드트립: 설정을 저장했다 다시 읽어도 산출 파라미터가 같아야 한다.
    try {
      const roundTripped = parse({ [c.metric]: serialize(parsed) })
      cmp(`${c.name}(roundtrip)`, roundTripped, c.roundTrip)
    } catch {
      failures.push(`${c.name}: 라운드트립(to∘from)에서 거부됨`)
    }
    checked += 1
  }

  if (failures.length > 0) {
    console.error(`✗ config 매핑 차분 검증 실패 — ${failures.length}건 불일치\n`)
    for (const f of failures.slice(0, 40)) console.error("  " + f)
    if (failures.length > 40) console.error(`  ... 외 ${failures.length - 40}건`)
    process.exitCode = 1
  } else {
    console.log(
      `✓ config 매핑 차분 검증 통과 — ${checked}개 문서가 원본 Python 과 동일하게 해석됨`,
    )
  }
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
