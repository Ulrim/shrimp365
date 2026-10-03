/**
 * 알림 배치 평가 차분 검증 — TypeScript 이식본 vs 원본 Python.
 *
 * 같은 DB 행을 양쪽에 넣고 "어떤 알림이 만들어지는가"를 비교한다. 원본은 SQLite 에
 * SQLAlchemy 로, 이식본은 Supabase 질의 빌더를 흉내 낸 가짜 클라이언트로. 이식본 코드는
 * 한 글자도 바꾸지 않는다.
 *
 * 이 검증이 지키는 것: 트리거 3종의 켜짐/안 켜짐, 구독 스위치의 생성 차단, 중복 억제,
 * kpi_red 의 type 단위 dedup, 사이트별 독립 판정, 그리고 payload 의 모든 숫자.
 *
 * 실행:
 *   python3 scripts/mrv/gen_alert_fixtures.py > scripts/mrv/alert-fixtures.json
 *   node scripts/mrv/verify-alerts.mjs
 */

import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const outDir = mkdtempSync(join(tmpdir(), "mrv-alerts-"))

/**
 * 가짜 Supabase 질의 빌더. PostgREST 와 같은 의미로 동작해야 검증이 성립한다
 * (range 는 양끝 포함, order 는 안정 정렬). insert 는 테이블에 실제로 행을 붙여,
 * 뒤이은 중복 검사가 방금 만든 알림을 보게 한다 — 원본의 flush 와 같은 자리다.
 */
function makeFakeDb(tables) {
  return {
    from(table) {
      let rows = [...(tables[table] ?? [])]
      const builder = {
        select() {
          return builder
        },
        insert(row) {
          if (!tables[table]) tables[table] = []
          tables[table].push({ ...row })
          return Promise.resolve({ data: null, error: null })
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
          rows = rows
            .map((r, i) => [r, i])
            .sort(([a, ai], [b, bi]) => {
              const av = a[col]
              const bv = b[col]
              if (av === bv) return ai - bi
              return (av < bv ? -1 : 1) * (asc ? 1 : -1)
            })
            .map(([r]) => r)
          return builder
        },
        limit(n) {
          rows = rows.slice(0, n)
          return builder
        },
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
  for (const f of ["alert-jobs.ts", "kpi-service.ts", "api-types.ts"]) {
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
      "  sites: 'sites', alerts: 'alerts',",
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
      "let n = 0",
      "export function newId(p: string) { n += 1; return p + '-' + n }",
      "",
    ].join("\n"),
  )
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
      join(outDir, "alert-jobs.ts"),
      "--outDir", join(outDir, "out"),
      "--module", "commonjs",
      "--target", "es2022",
      "--moduleResolution", "node",
      "--skipLibCheck",
    ],
    { stdio: "inherit", cwd: ROOT },
  )

  const require = createRequire(join(outDir, "x.cjs"))
  const { jobEvaluateAlerts } = require(join(outDir, "out", "alert-jobs.js"))

  const fixtures = JSON.parse(readFileSync(join(HERE, "alert-fixtures.json"), "utf8"))
  const failures = []
  let checkedScenarios = 0
  let checkedAlerts = 0

  const EPS = 1e-9

  function sameNumber(a, b) {
    if (typeof a !== "number" || typeof b !== "number") return false
    return Math.abs(a - b) <= EPS * Math.max(1, Math.abs(b))
  }

  /**
   * 시각은 문자열이 아니라 **가리키는 순간**으로 비교한다.
   *
   * 원본의 `ts` 는 `datetime.isoformat()` 인데, 이 기준값을 만든 SQLite 는 timestamptz 를
   * naive datetime 으로 돌려주므로 "2026-06-20T07:31:00"(오프셋 없음)이 된다. 실제
   * Postgres 였다면 "+00:00" 이 붙는다. 이식본은 `toISOString()` 이라 "…Z" 다.
   * 셋 다 같은 순간이고, 다른 것은 표기뿐이다 — 기준값 생성 환경의 산물이지 이식 오류가
   * 아니므로 순간으로 맞춘다(오프셋이 없으면 UTC 로 읽는다. 생성기가 전부 UTC 로 썼다).
   */
  function sameInstant(a, b) {
    const parse = (v) =>
      Date.parse(/[Z+]|-\d\d:\d\d$/.test(v) ? v : `${v}Z`)
    const ta = parse(a)
    const tb = parse(b)
    return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb
  }

  /** payload 는 원본이 만든 dict 그대로여야 한다(키 집합까지 같아야 한다). */
  function comparePayload(path, actual, expected) {
    const ak = Object.keys(actual ?? {}).sort()
    const ek = Object.keys(expected ?? {}).sort()
    if (ak.join(",") !== ek.join(",")) {
      failures.push(`${path}: payload 키가 다름 [${ak}] ≠ [${ek}]`)
      return
    }
    for (const k of ek) {
      const av = actual[k]
      const ev = expected[k]
      if (typeof ev === "number") {
        if (!sameNumber(av, ev)) failures.push(`${path}.${k}: ${av} ≠ ${ev}`)
      } else if (k === "ts") {
        if (!sameInstant(av, ev)) failures.push(`${path}.${k}: ${av} ≠ ${ev}`)
      } else if (av !== ev) {
        failures.push(`${path}.${k}: ${JSON.stringify(av)} ≠ ${JSON.stringify(ev)}`)
      }
    }
  }

  for (const c of fixtures.cases) {
    const r = c.rows
    const db = makeFakeDb({
      sites: r.sites,
      tanks: r.tanks,
      meters: r.meters,
      readings: r.readings,
      batches: r.batches,
      feed_logs: r.feed_logs,
      mortality_logs: r.mortality_logs,
      harvest_logs: r.harvest_logs,
      alerts: [...r.alerts],
      kpi_config: r.kpi_config ? [r.kpi_config] : [],
    })

    const res = await jobEvaluateAlerts(db, { evaluatedAt: new Date(c.evaluatedAt) })

    if (res.failures.length > 0) {
      failures.push(`${c.name}: 사이트 평가 중 오류 — ${res.failures.join(" | ")}`)
      continue
    }

    // 생성 순서는 사이트 순회 순서에 달렸다. 무엇이 만들어졌는가가 계약이므로
    // 원본과 같은 기준으로 정렬해 비교한다.
    const actual = [...res.created].sort((a, b) =>
      a.siteId === b.siteId
        ? a.type < b.type ? -1 : a.type > b.type ? 1 : 0
        : a.siteId < b.siteId ? -1 : 1,
    )
    const expected = c.expected

    if (actual.length !== expected.length) {
      failures.push(
        `${c.name}: 만들어진 알림 수 ${actual.length} ≠ ${expected.length}` +
          ` (이식 [${actual.map((a) => a.siteId + ":" + a.type)}]` +
          ` vs 원본 [${expected.map((a) => a.siteId + ":" + a.type)}])`,
      )
      continue
    }

    for (let i = 0; i < expected.length; i += 1) {
      const a = actual[i]
      const e = expected[i]
      const path = `${c.name}[${e.siteId}:${e.type}]`
      if (a.siteId !== e.siteId) failures.push(`${path}: siteId ${a.siteId} ≠ ${e.siteId}`)
      if (a.type !== e.type) failures.push(`${path}: type ${a.type} ≠ ${e.type}`)
      if (a.severity !== e.severity) {
        failures.push(`${path}: severity ${a.severity} ≠ ${e.severity}`)
      }
      comparePayload(path, a.payload, e.payload)
      checkedAlerts += 1
    }
    checkedScenarios += 1
  }

  if (failures.length > 0) {
    console.error(`✗ 알림 배치 차분 검증 실패 — ${failures.length}건 불일치\n`)
    for (const f of failures.slice(0, 40)) console.error("  " + f)
    if (failures.length > 40) console.error(`  ... 외 ${failures.length - 40}건`)
    process.exitCode = 1
  } else {
    console.log(
      `✓ 알림 배치 차분 검증 통과 — ${checkedScenarios}개 시나리오 / ` +
        `${fixtures.meta.sites}개 사이트에서 알림 ${checkedAlerts}건이 원본과 일치`,
    )
  }
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
