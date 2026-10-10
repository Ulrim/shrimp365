/**
 * KPI 조립 계층 차분 검증 — TypeScript 이식본 vs 원본 Python.
 *
 * 엔진(산식)과 config(설정 해석)는 각각 따로 대조해 두었다. 이 검증은 그 사이 구간,
 * 즉 **DB 행을 골라 엔진 입력으로 옮기는 조립 계층**을 본다. 계측값 기간을 어떻게 자르는지,
 * 폭기 서브미터를 어떻게 가르는지, 생체량 개시/마감을 어느 행으로 잡는지 — 여기가
 * 어긋나면 산식이 정확해도 KPI 가 틀린다.
 *
 * 같은 DB 행을 양쪽에 넣는다. 원본은 SQLite 에 SQLAlchemy 로, 이식본은 Supabase 질의
 * 빌더를 흉내 낸 가짜 클라이언트로. 이식본 코드는 한 글자도 바꾸지 않는다.
 *
 * 실행:
 *   python3 scripts/mrv/gen_pipeline_fixtures.py > scripts/mrv/pipeline-fixtures.json
 *   node scripts/mrv/verify-pipeline.mjs
 */

import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const outDir = mkdtempSync(join(tmpdir(), "mrv-pipeline-"))

/**
 * 가짜 Supabase 질의 빌더. kpi-service 가 실제로 쓰는 연산만 구현한다
 * (select/eq/in/gte/lte/order/range/limit/maybeSingle). PostgREST 와 같은 의미로 동작해야
 * 검증이 성립하므로, range 는 끝 인덱스를 포함하고 order 는 안정 정렬이다.
 */
function makeFakeDb(tables) {
  return {
    from(table) {
      let rows = [...(tables[table] ?? [])]
      const builder = {
        select() {
          return builder
        },
        eq(col, value) {
          rows = rows.filter((r) => r[col] === value)
          return builder
        },
        in(col, values) {
          const set = new Set(values)
          rows = rows.filter((r) => set.has(r[col]))
          return builder
        },
        gte(col, value) {
          rows = rows.filter((r) => String(r[col]) >= String(value))
          return builder
        },
        lte(col, value) {
          rows = rows.filter((r) => String(r[col]) <= String(value))
          return builder
        },
        lt(col, value) {
          rows = rows.filter((r) => String(r[col]) < String(value))
          return builder
        },
        order(col, opts = {}) {
          const asc = opts.ascending !== false
          // 안정 정렬: 이미 적용된 정렬을 뒤엎지 않아야 다중 order 가 PostgREST 와 같다.
          rows = rows
            .map((r, i) => [r, i])
            .sort(([a, ai], [b, bi]) => {
              const av = a[col]
              const bv = b[col]
              if (av === bv) return ai - bi
              const cmp = av < bv ? -1 : 1
              return asc ? cmp : -cmp
            })
            .map(([r]) => r)
          return builder
        },
        limit(n) {
          rows = rows.slice(0, n)
          return builder
        },
        // PostgREST 의 range 는 [from, to] 양끝 포함이다.
        range(from, to) {
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null })
        },
        maybeSingle() {
          return Promise.resolve({ data: rows[0] ?? null, error: null })
        },
        then(resolve, reject) {
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
        },
      }
      return builder
    },
  }
}

try {
  // kpi-service.ts 는 db.ts(Supabase 클라이언트)를 import 한다. 원본 파일은 그대로 두고
  // 임시 디렉터리에 복사한 뒤 그 옆에 fetchAll 만 살린 db 모듈을 놓아 함께 컴파일한다.
  for (const f of ["kpi-service.ts", "api-types.ts"]) {
    copyFileSync(join(ROOT, "lib/mrv", f), join(outDir, f))
  }
  writeFileSync(
    join(outDir, "db.ts"),
    [
      "// 검증용 db 모듈. fetchAll 은 실제 구현과 같은 페이지네이션 규약을 그대로 쓴다.",
      "/* eslint-disable @typescript-eslint/no-explicit-any */",
      "export type MrvDb = any",
      "export const T = {",
      "  meters: 'meters', readings: 'readings', harvestLogs: 'harvest_logs',",
      "  tanks: 'tanks', batches: 'batches', feedLogs: 'feed_logs',",
      "  mortalityLogs: 'mortality_logs', kpiConfig: 'kpi_config',",
      "}",
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
      "export function newId(p: string) { return p + '-x' }",
      "",
    ].join("\n"),
  )
  // kpi-service 는 "./kpi" 배럴에서 엔진을 가져온다. 실제 엔진 파일을 그대로 복사한다.
  execFileSync("mkdir", ["-p", join(outDir, "kpi")])
  for (const f of [
    "index.ts", "types.ts", "status.ts", "internal.ts", "config.ts",
    "energy.ts", "feed.ts", "oxygen.ts", "mortality.ts", "recommend.ts",
    "scope2.ts", "comparison.ts",
  ]) {
    copyFileSync(join(ROOT, "lib/mrv/kpi", f), join(outDir, "kpi", f))
  }

  execFileSync(
    "npx",
    [
      "tsc",
      join(outDir, "kpi-service.ts"),
      "--outDir", join(outDir, "out"),
      "--module", "commonjs",
      "--target", "es2022",
      "--moduleResolution", "node",
      "--skipLibCheck",
    ],
    { stdio: "inherit", cwd: ROOT },
  )

  const require = createRequire(join(outDir, "x.cjs"))
  const { computeSiteKpiResults } = require(join(outDir, "out", "kpi-service.js"))

  const fixtures = JSON.parse(readFileSync(join(HERE, "pipeline-fixtures.json"), "utf8"))
  const failures = []
  let checked = 0

  const EPS = 1e-9

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
          `${path}: 길이 ${actual?.length} ≠ ${expected.length}`,
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
      if (typeof actual !== "number") {
        failures.push(`${path}: expected ${expected}, got ${JSON.stringify(actual)}`)
        return
      }
      const scale = Math.max(1, Math.abs(expected))
      if (Math.abs(actual - expected) > EPS * scale) {
        failures.push(`${path}: ${actual} ≠ ${expected}`)
      }
      return
    }
    if (actual !== expected) {
      failures.push(
        `${path}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`,
      )
    }
  }

  for (const c of fixtures.cases) {
    const r = c.rows
    const db = makeFakeDb({
      meters: r.meters,
      readings: r.readings,
      harvest_logs: r.harvest_logs,
      tanks: r.tanks,
      batches: r.batches,
      feed_logs: r.feed_logs,
      mortality_logs: r.mortality_logs,
      kpi_config: r.kpi_config ? [r.kpi_config] : [],
    })

    const comp = await computeSiteKpiResults(
      db,
      "site-p",
      new Date(c.period.from),
      new Date(c.period.to),
    )

    const e = c.expected
    cmp(`${c.name}.configVersion`, comp.configVersion, e.configVersion)
    cmp(`${c.name}.tankId`, comp.tankId, e.tankId)

    cmp(`${c.name}.ei`, {
      eiTotal: comp.ei.eiTotal,
      eiAeration: comp.ei.eiAeration,
      totalPowerKwh: comp.ei.totalPowerKwh,
      aerationPowerKwh: comp.ei.aerationPowerKwh,
      biomassStartKg: comp.ei.biomassStartKg,
      biomassEndKg: comp.ei.biomassEndKg,
      biomassDeltaKg: comp.ei.biomassDeltaKg,
      includedReadingCount: comp.ei.includedReadingCount,
      excludedReadingCount: comp.ei.excludedReadingCount,
      sourceMeterIds: [...comp.ei.sourceMeterIds],
      sourceBiomassRefs: [...comp.ei.sourceBiomassRefs],
    }, e.ei)

    cmp(`${c.name}.fcr`, {
      fcr: comp.fcr.fcr,
      totalFeedKg: comp.fcr.totalFeedKg,
      includedFeedCount: comp.fcr.includedFeedCount,
      excludedFeedCount: comp.fcr.excludedFeedCount,
      sourceFeedRefs: [...comp.fcr.sourceFeedRefs],
    }, e.fcr)

    if (e.oei === null) {
      if (comp.oei !== null) {
        failures.push(`${c.name}.oei: 원본은 OEI 대상 수조가 없다고 판단했는데 이식본은 산출함`)
      }
    } else if (comp.oei === null) {
      failures.push(`${c.name}.oei: 원본은 산출했는데 이식본은 대상 수조를 찾지 못함`)
    } else {
      cmp(`${c.name}.oei`, {
        oei: comp.oei.oei,
        doInBandFraction: comp.oei.doInBandFraction,
        doTotalSamples: comp.oei.doTotalSamples,
        doInBandSamples: comp.oei.doInBandSamples,
        doExcludedSamples: comp.oei.doExcludedSamples,
        aerationPowerKwh: comp.oei.aerationPowerKwh,
        bandMin: comp.oei.bandMin,
        bandMax: comp.oei.bandMax,
        oeiRaw: comp.oei.oeiRaw,
        scaleFactor: comp.oei.scaleFactor,
        sourceDoMeterIds: [...comp.oei.sourceDoMeterIds],
        sourceAerationMeterIds: [...comp.oei.sourceAerationMeterIds],
      }, e.oei)
    }

    cmp(`${c.name}.mortality`, {
      cumulativeRatePct: comp.mortality.cumulativeRatePct,
      totalDeadCount: comp.mortality.totalDeadCount,
      stockedCount: comp.mortality.stockedCount,
      daily: comp.mortality.daily.map((d) => ({
        date: d.date, deadCount: d.deadCount, dailyRatePct: d.dailyRatePct,
      })),
      movingAvg: comp.mortality.movingAvg.map((p) => ({
        date: p.date, maRatePct: p.maRatePct,
      })),
      sourceRefs: [...comp.mortality.sourceRefs],
    }, e.mortality)

    checked += 1
  }

  if (failures.length > 0) {
    console.error(`✗ 조립 계층 차분 검증 실패 — ${failures.length}건 불일치\n`)
    for (const f of failures.slice(0, 40)) console.error("  " + f)
    if (failures.length > 40) console.error(`  ... 외 ${failures.length - 40}건`)
    process.exitCode = 1
  } else {
    console.log(
      `✓ 조립 계층 차분 검증 통과 — ${checked}개 시나리오가 원본 Python 과 동일한 KPI 를 냄`,
    )
  }
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
