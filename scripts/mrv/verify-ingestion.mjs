/**
 * 계측값 정규화 차분 검증 — TypeScript 이식본 vs 원본 Python.
 *
 * `lib/mrv/ingestion.ts::normalizeReadings` 가 정하는 값이 그대로 readings.value 에 앉고
 * KPI 엔진의 입력이 된다. 산식이 아무리 정확해도 이 계층이 어긋나면 결과가 통째로 틀리며,
 * 그런 오류는 화면 어디에도 표시를 남기지 않는다. 그래서 산식과 같은 방식으로 원본과
 * 대조해 둔다.
 *
 * 실행:
 *   python3 scripts/mrv/gen_ingestion_fixtures.py > scripts/mrv/ingestion-fixtures.json
 *   node scripts/mrv/verify-ingestion.mjs
 */

import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const outDir = mkdtempSync(join(tmpdir(), "mrv-ingest-"))

try {
  // 검증 대상인 normalizeReadings 는 순수 함수지만, 같은 파일의 processBatch 가 db.ts
  // (Supabase 클라이언트)를 import 한다. 원본 파일을 그대로 두고 임시 디렉터리에 복사한 뒤
  // 그 옆에 db 스텁을 놓아 함께 컴파일한다 — 검증 대상 코드는 한 글자도 바뀌지 않는다.
  copyFileSync(join(ROOT, "lib/mrv/ingestion.ts"), join(outDir, "ingestion.ts"))
  writeFileSync(
    join(outDir, "db.ts"),
    [
      "// 검증 전용 스텁. normalizeReadings 는 이 모듈을 쓰지 않으므로 타입만 느슨히 맞춘다",
      "// (같은 파일의 processBatch 가 컴파일은 되어야 emit 이 나온다).",
      "/* eslint-disable @typescript-eslint/no-explicit-any */",
      "export const T: Record<string, string> = {}",
      "export type MrvDb = any",
      "export async function fetchAll<T>(_build: unknown): Promise<T[]> { return [] }",
      "",
    ].join("\n"),
  )

  execFileSync(
    "npx",
    [
      "tsc",
      join(outDir, "ingestion.ts"),
      join(outDir, "db.ts"),
      "--outDir", join(outDir, "out"),
      "--module", "commonjs",
      "--target", "es2022",
      "--moduleResolution", "node",
      "--skipLibCheck",
    ],
    { stdio: "inherit", cwd: ROOT },
  )

  const require = createRequire(join(outDir, "x.cjs"))
  const { normalizeReadings } = require(join(outDir, "out", "ingestion.js"))

  const fixtures = JSON.parse(readFileSync(join(HERE, "ingestion-fixtures.json"), "utf8"))
  const failures = []
  let checkedBatches = 0
  let checkedRows = 0

  for (const c of fixtures.cases) {
    const raws = c.input.raws.map((r) => ({ ...r, ts: new Date(r.ts) }))
    const prior = new Map(
      Object.entries(c.input.prior).map(([k, v]) => [k, { ts: new Date(v.ts), value: v.value }]),
    )

    const actual = normalizeReadings(raws, prior)

    if (actual.length !== c.expected.length) {
      failures.push(
        `${c.name}: 출력 개수 ${actual.length} ≠ 기대 ${c.expected.length}`,
      )
      continue
    }

    for (let i = 0; i < c.expected.length; i += 1) {
      const a = actual[i]
      const e = c.expected[i]
      const where = `${c.name}[${i}]`
      if (a.meterId !== e.meterId) {
        failures.push(`${where}.meterId: ${a.meterId} ≠ ${e.meterId} (처리 순서가 다르다)`)
      }
      if (a.ts.toISOString() !== new Date(e.ts).toISOString()) {
        failures.push(`${where}.ts: ${a.ts.toISOString()} ≠ ${e.ts}`)
      }
      // 사다리꼴 적분·차분 모두 IEEE754 double 산술이라 비트 단위로 같아야 한다.
      const scale = Math.max(1, Math.abs(e.value))
      if (Math.abs(a.value - e.value) > 1e-12 * scale) {
        failures.push(`${where}.value: ${a.value} ≠ ${e.value}`)
      }
      if (a.qualityFlag !== e.qualityFlag) {
        failures.push(`${where}.qualityFlag: ${a.qualityFlag} ≠ ${e.qualityFlag}`)
      }
      checkedRows += 1
    }
    checkedBatches += 1
  }

  if (failures.length > 0) {
    console.error(`✗ 계측값 정규화 차분 검증 실패 — ${failures.length}건 불일치\n`)
    for (const f of failures.slice(0, 40)) console.error("  " + f)
    if (failures.length > 40) console.error(`  ... 외 ${failures.length - 40}건`)
    process.exitCode = 1
  } else {
    console.log(
      `✓ 계측값 정규화 차분 검증 통과 — ${checkedBatches}개 배치 / ${checkedRows}개 계측값이 원본 Python 과 일치`,
    )
  }
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
