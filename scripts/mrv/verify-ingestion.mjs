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
  // ingestion.ts 가 쓰는 두 모듈. **실물을 컴파일한다** — ② 절이 검증하는 것이
  // 「열이 없는 DB 를 어떻게 알아보고 무엇을 하는가」이고, 그 판정이 저 모듈에 있다.
  for (const f of ["measurement-basis.ts", "measurement-basis-column.ts"]) {
    copyFileSync(join(ROOT, "lib/mrv", f), join(outDir, f))
  }
  writeFileSync(
    join(outDir, "db.ts"),
    [
      "// 검증 전용 스텁. normalizeReadings 는 이 모듈을 쓰지 않지만, ② 절이 processBatch 를",
      "// 가짜 클라이언트로 실제로 돌리므로 fetchAll 은 실제 구현과 같은 페이지네이션 규약을 쓴다.",
      "/* eslint-disable @typescript-eslint/no-explicit-any */",
      "export const T = { meters: 'meters', readings: 'readings' } as Record<string, string>",
      "export type MrvDb = any",
      "export async function fetchAll<T>(",
      "  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,",
      "): Promise<T[]> {",
      "  const PAGE = 1000",
      "  const out: T[] = []",
      "  for (let from = 0; ; from += PAGE) {",
      "    const { data, error } = await build(from, from + PAGE - 1)",
      "    if (error) throw error",
      "    const rows = data ?? []",
      "    out.push(...rows)",
      "    if (rows.length < PAGE) break",
      "  }",
      "  return out",
      "}",
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
  const { normalizeReadings, processBatch } = require(join(outDir, "out", "ingestion.js"))
  const { resetMeasurementBasisColumnMemory } = require(
    join(outDir, "out", "measurement-basis-column.js"),
  )

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

  // ── ② 열이 아직 없는 DB — **계측값은 들어가야 한다** ──────────────────────
  //
  // `measurement_basis` 는 마이그레이션이 추가하고 실행은 사람 몫이라, 배포가 SQL 보다
  // 먼저 올라가는 창이 반드시 생긴다. 그 창에서 PostgREST 는 모르는 열이 섞인 insert 를
  // 거절한다. `processBatch` 는 **모든 계측값 쓰기의 공통 경로**(장비·세션·CSV, 전력뿐
  // 아니라 수질까지)이므로 그 거절이 500 이 되면 증빙 입력이 통째로 멈춘다.
  //
  // ★ 기준: **계측값은 증빙이고 자료유형은 그 증빙에 대한 메타데이터다. 메타데이터를
  //   적을 칸이 없는 것이 증빙을 받지 못할 이유가 되어서는 안 된다.**
  //
  // 가짜 PostgREST 는 그 열이 섞인 insert 를 PGRST204 로 거절한다(실제 PostgREST 가
  // 쓰는 코드다). 폴백이 살아 있으면 그 칸을 뺀 두 번째 insert 가 들어오고, 저장된 행은
  // 자료유형만 비어 있어야 한다.
  const basisFailures = []
  {
    resetMeasurementBasisColumnMemory()
    const inserted = []
    let rejected = 0
    const fakeDb = {
      from(table) {
        const api = {
          select: () => api,
          eq: () => api,
          in: () => api,
          order: () => api,
          range: async () => ({
            data: table === "meters"
              ? [{ id: "m1", org_id: "o1", site_id: "s1" }]
              : [],
            error: null,
          }),
          lte: () => api,
          gte: () => api,
          limit: () => api,
          maybeSingle: async () => ({ data: null, error: null }),
          // 실제 코드는 upsert 를 쓴다(PK 충돌 무시). 이름만 맞춰 둔다.
          async upsert(rows) { return api.insert(rows) },
          async insert(rows) {
            const list = Array.isArray(rows) ? rows : [rows]
            if (list.some((r) => "measurement_basis" in r)) {
              rejected += 1
              return {
                error: {
                  code: "PGRST204",
                  message: "Could not find the 'measurement_basis' column of 'mrv_readings'",
                },
              }
            }
            inserted.push(...list)
            return { error: null }
          },
        }
        return api
      },
    }

    const res = await processBatch(fakeDb, {
      orgId: "o1",
      siteId: "s1",
      source: "manual",
      raws: [{ index: 0, meterId: "m1", ts: new Date("2026-08-01T00:00:00Z"),
               value: 12.5, readingKind: "interval_kwh", measurementBasis: "metered" }],
    })

    if (rejected === 0) {
      basisFailures.push("② 가짜 DB 가 그 칸을 거절하지 않았다 — 검사가 아무것도 보지 않는다")
    }
    if (inserted.length !== 1) {
      basisFailures.push(
        `② 열이 없는 DB 에서 계측값이 저장되지 않았다(저장 ${inserted.length}건) — ` +
        "메타데이터 칸 하나 때문에 증빙이 유실된다",
      )
    } else {
      if ("measurement_basis" in inserted[0]) {
        basisFailures.push("② 두 번째 insert 에도 그 칸이 남아 있다")
      }
      if (inserted[0].value !== 12.5 || inserted[0].quality_flag !== "ok") {
        basisFailures.push(
          `② 저장된 값이 달라졌다: value=${inserted[0].value} flag=${inserted[0].quality_flag}`,
        )
      }
    }
    if (res && typeof res.accepted === "number" && res.accepted !== 1) {
      basisFailures.push(`② accepted 가 1 이 아니다: ${res.accepted} — 호출부가 실패로 읽는다`)
    }
    resetMeasurementBasisColumnMemory()
  }
  failures.push(...basisFailures)

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
