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
        // PostgREST 의 `is.null` 은 "칸이 비어 있다" 다. 픽스처 행에는 그 칸 자체가
        // 없을 수 있으므로 undefined 도 null 로 본다(DB 에서는 둘이 같은 상태다).
        is(col, value) {
          if (value === null) {
            rows = rows.filter((r) => r[col] === null || r[col] === undefined)
          } else {
            rows = rows.filter((r) => r[col] === value)
          }
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
  for (const f of [
    "kpi-service.ts",
    "api-types.ts",
    "kpi-config-source.ts",
    // 자료유형 집계가 쓰는 두 모듈. 스텁으로 바꾸지 않는다 — 집계가 **실물 엔진에 다시
    // 넣어** 산입 건수를 세는 것이라(kpi-service.ts 의 tallyIncludedMeasurementBasis)
    // 스텁을 끼우면 정작 검증하려는 연결이 사라진다.
    "measurement-basis.ts",
    "measurement-basis-column.ts",
    // 분모(생산량)의 산정 근거. 위 두 모듈과 같은 이유로 실물을 쓴다 — kpi-service 가
    // **분모를 만든 두 점을 그 행에서 그대로 꺼내는지**(pickBiomassBasis)가 이 검증에서
    // 사라지면, 그 칸이 빈 채로 리포트에 얼려 들어가도 통과한다.
    "production-basis.ts",
    "production-basis-column.ts",
    // '산출 불가' 사유의 근거를 조립하는 쪽(kpi-service)과 그 근거로 문장을 만드는 쪽.
    // 스텁으로 바꾸지 않는다 — 임계값을 **산출에 실제로 쓰인 설정 객체**에서 꺼내는
    // 연결이 이 검증에서 사라지면, 그 칸이 비거나 0 으로 굳어도 통과한다.
    "metric-unavailability.ts",
    "metric-provenance.ts",
  ]) {
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
  const { computeSiteKpiResults, kpiComputationToResponse } = require(
    join(outDir, "out", "kpi-service.js"),
  )
  // 사유의 근거가 **엔진에 넘긴 설정과 같은 값**인지 대조하는 데 쓴다(활성 설정 파서).
  const kpiConfig = require(join(outDir, "out", "kpi", "config.js"))
  const metricUnavailability = require(join(outDir, "out", "metric-unavailability.js"))

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

    // org 는 픽스처에 없다. 픽스처의 kpi_config 행에는 org_id 가 없어 「플랫폼 기본값」
    // 이고(org_id is null), 그래서 어느 org 로 조회해도 그 행이 활성 설정이다 —
    // 원본 Python 과 같은 입력이라는 성질이 유지된다.
    const comp = await computeSiteKpiResults(
      db,
      "site-p",
      "org-p",
      new Date(c.period.from),
      new Date(c.period.to),
      // 활성 설정 선택의 기준 시각. 픽스처의 effective_from 보다 뒤여야 그 행이 고른다.
      new Date("2099-01-01T00:00:00Z"),
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

    // ── '산출 불가' 사유의 근거 — 원본에 없는 칸이므로 **불변식**으로 본다 ─────────
    //
    // 이 묶음은 화면·인쇄 리포트·API 가 사유를 확정하는 **유일한 근거**다. 한 칸이라도
    // 엔진 결과와 어긋나면 사람 앞에 틀린 사유가 나간다(그리고 그 쪽이 아무 말도 하지
    // 않던 종전보다 나쁘다 — 틀린 사실을 자신 있게 적는 것이니까).
    //
    // ★ 임계값은 **산출에 실제로 쓰인 설정**에서 와야 한다. 조직이 min_biomass_delta_kg
    //   를 덮으면 사유 문장의 숫자도 따라가야 하므로, 엔진에 넘긴 설정과 같은 값인지를
    //   활성 설정 파서로 다시 읽어 대조한다.
    {
      const ev = comp.unavailabilityEvidence
      const activeParams = comp.paramsOut
      const want = {
        biomass_delta_kg: comp.ei.biomassDeltaKg,
        biomass_record_count: r.harvest_logs.filter(
          (h) =>
            h.site_id === "site-p" &&
            String(h.ts) >= String(new Date(c.period.from).toISOString()) &&
            String(h.ts) <= String(new Date(c.period.to).toISOString()),
        ).length,
        ei_min_biomass_delta_kg: kpiConfig.eiConfigFromParams(activeParams).minBiomassDeltaKg,
        fcr_min_biomass_delta_kg: kpiConfig.fcrConfigFromParams(activeParams).minBiomassDeltaKg,
        oei_min_biomass_kg: kpiConfig.oeiConfigFromParams(activeParams).minBiomassKg,
        total_power_kwh: comp.ei.totalPowerKwh,
        aeration_power_kwh: comp.ei.aerationPowerKwh,
        oei_aeration_power_kwh: comp.oei === null ? null : comp.oei.aerationPowerKwh,
        included_reading_count: comp.ei.includedReadingCount,
        excluded_reading_count: comp.ei.excludedReadingCount,
        included_feed_count: comp.fcr.includedFeedCount,
        excluded_feed_count: comp.fcr.excludedFeedCount,
        stocked_count: comp.mortality.stockedCount,
        oei_applicable: comp.oei !== null,
        do_total_samples: comp.oei === null ? null : comp.oei.doTotalSamples,
        do_excluded_samples: comp.oei === null ? null : comp.oei.doExcludedSamples,
      }
      for (const k of Object.keys(want)) {
        if (!(k in ev)) {
          failures.push(`${c.name}.unavailabilityEvidence: ${k} 칸이 없다`)
          continue
        }
        cmp(`${c.name}.unavailabilityEvidence.${k}`, ev[k], want[k])
      }
      // 값이 null 인 지표에는 사유가 하나 이상 나와야 한다. 빈 배열이면 화면이 사유 칸을
      // 아예 그리지 않아 "이유 없는 산출 불가" 로 되돌아간다.
      const values = {
        ei_total: comp.ei.eiTotal,
        ei_aeration: comp.ei.eiAeration,
        fcr: comp.fcr.fcr,
        oei: comp.oei === null ? null : comp.oei.oei,
        mortality_rate: comp.mortality.cumulativeRatePct,
      }
      for (const key of Object.keys(values)) {
        if (values[key] !== null) continue
        const reasons = metricUnavailability.metricUnavailabilityReasons(key, ev)
        if (!Array.isArray(reasons) || reasons.length === 0) {
          failures.push(`${c.name}.${key}: 산출 불가인데 사유가 비어 있다`)
          continue
        }
        if (reasons.some((x) => typeof x.text !== "string" || x.text.trim().length === 0)) {
          failures.push(`${c.name}.${key}: 사유 문장이 비어 있다`)
        }
      }

      /*
       * GET /kpi 응답이 그 사유를 **실제로 싣는가.**
       *
       * ★ 원문에서 이름만 찾는 검사로는 모자란다 — 응답의 그 한 줄을 지워도
       *   `unavailability` 라는 낱말이 타입·헬퍼 이름으로 파일에 남아 통과한다
       *   (역검증에서 실제로 그랬다). 그래서 **응답 객체**를 만들어 들여다본다.
       *   화면들이 사유를 각자 지어내지 않는 근거가 이 칸 하나다.
       */
      const res = kpiComputationToResponse(
        comp,
        "site-p",
        "org-p",
        new Date(c.period.from),
        new Date(c.period.to),
      )
      if (res.unavailability === undefined || res.unavailability === null) {
        failures.push(`${c.name}: /kpi 응답에 산출 불가 사유가 실리지 않는다`)
      } else {
        for (const key of Object.keys(values)) {
          const slot = res.unavailability.metrics[key]
          if (values[key] === null) {
            if (slot === undefined || !Array.isArray(slot.reasons) || slot.reasons.length === 0) {
              failures.push(`${c.name}: /kpi 응답의 ${key} 사유가 비어 있다`)
            }
          } else if (slot !== undefined) {
            // 산출된 지표에 사유를 실으면 화면이 값 옆에 사유처럼 적는다.
            failures.push(`${c.name}: /kpi 응답이 산출된 ${key} 에도 사유를 싣는다`)
          }
        }
        cmp(`${c.name}.unavailability.evidence`, res.unavailability.evidence, {
          biomass_delta_kg: comp.ei.biomassDeltaKg,
          included_reading_count: comp.ei.includedReadingCount,
        })
      }
    }

    // ── 자료유형 집계 — 원본에 없는 칸이므로 차분이 아니라 **불변식**으로 본다 ──────
    //
    // 집계는 산입 판정을 베껴 적지 않고 **자료유형별로 나눈 묶음을 같은 엔진에 다시
    // 넣어** 센다(lib/mrv/kpi-service.ts). 그 방식이 성립하는 근거는 "산입 판정이 계측값
    // 하나하나에 독립적으로 걸린다" 하나뿐이고, 그것이 깨지면 리포트가 "실측 N건" 을
    // 틀리게 인쇄한다. 그래서 **합이 산입 건수와 같다**를 실물 엔진으로 확인한다.
    const basisSum =
      comp.eiMeasurementBasis.metered +
      comp.eiMeasurementBasis.calculated +
      comp.eiMeasurementBasis.estimated +
      comp.eiMeasurementBasis.unrecorded
    if (basisSum !== comp.ei.includedReadingCount) {
      failures.push(
        `${c.name}.eiMeasurementBasis: 합 ${basisSum} ≠ 산입 건수 ${comp.ei.includedReadingCount}`,
      )
    }
    // 픽스처 행에는 measurement_basis 칸이 없다(원본 Python 이 모르는 열이다) →
    // 산입된 건은 전부 '미기재' 로 세어야 한다. 'metered' 로 세면 **없는 사실을 만들어
    // 내는 것**이고, 그 거짓이 그대로 리포트에 인쇄된다.
    if (comp.eiMeasurementBasis.unrecorded !== comp.ei.includedReadingCount) {
      failures.push(
        `${c.name}.eiMeasurementBasis: 자료유형이 없는 행을 미기재로 세지 않았다 — ` +
          JSON.stringify(comp.eiMeasurementBasis),
      )
    }

    // 같은 입력에 자료유형만 'calculated' 로 적어 다시 돌린다. 두 가지를 본다:
    //   · 그 건들이 calculated 버킷으로 정확히 센다(버킷팅이 실제로 동작한다).
    //   · **KPI 수치는 한 글자도 달라지지 않는다** — 자료유형은 산출 입력이 아니라
    //     그 산출이 무엇으로 만들어졌는지를 적는 메타데이터다. 이것이 흔들리면 EI 가
    //     데이터의 성격에 따라 달라진다는 뜻이고, 그러면 리포트의 재현성이 깨진다.
    const stampedDb = makeFakeDb({
      meters: r.meters,
      readings: r.readings.map((row) => ({ ...row, measurement_basis: "calculated" })),
      harvest_logs: r.harvest_logs,
      tanks: r.tanks,
      batches: r.batches,
      feed_logs: r.feed_logs,
      mortality_logs: r.mortality_logs,
      kpi_config: r.kpi_config ? [r.kpi_config] : [],
    })
    const stamped = await computeSiteKpiResults(
      stampedDb,
      "site-p",
      "org-p",
      new Date(c.period.from),
      new Date(c.period.to),
      new Date("2099-01-01T00:00:00Z"),
    )
    cmp(`${c.name}.stamped.eiMeasurementBasis`, stamped.eiMeasurementBasis, {
      metered: 0,
      calculated: comp.ei.includedReadingCount,
      estimated: 0,
      unrecorded: 0,
    })
    cmp(`${c.name}.stamped.ei`, {
      eiTotal: stamped.ei.eiTotal,
      eiAeration: stamped.ei.eiAeration,
      totalPowerKwh: stamped.ei.totalPowerKwh,
      includedReadingCount: stamped.ei.includedReadingCount,
      excludedReadingCount: stamped.ei.excludedReadingCount,
    }, {
      eiTotal: comp.ei.eiTotal,
      eiAeration: comp.ei.eiAeration,
      totalPowerKwh: comp.ei.totalPowerKwh,
      includedReadingCount: comp.ei.includedReadingCount,
      excludedReadingCount: comp.ei.excludedReadingCount,
    })

    // ── 분모(생산량)의 산정 근거 — 같은 자리의 불변식 ────────────────────────
    //
    // 전력 자료유형이 **분자**에 대해 하는 일을 이것이 **분모**에 대해 한다. 다만 모양이
    // 다르다: 분자는 산입된 모든 건이 더해지므로 분포(건수)를 세고, 분모는 기간 양 끝
    // **두 점의 차이**이므로 그 두 점만 담는다. 기간에 수확 기록이 50건 있어도 분모를
    // 만든 것은 두 건뿐이고, 50건의 분포를 적으면 분모의 성질을 틀리게 적는다.
    //
    // 그래서 보는 것은 **엔진이 실제로 쓴 두 점을 가리키는가**다. 엔진이 들고 있는
    // `sourceBiomassRefs` 와 대조한다 — 이 값이 어긋나면 리포트가 분모로 쓰이지 않은
    // 행의 산정 근거를 인쇄한다.
    const harvestsInPeriod = r.harvest_logs.filter((h) => {
      const t = Date.parse(h.ts)
      return t >= Date.parse(c.period.from) && t <= Date.parse(c.period.to)
    })
    const sortedHarvests = [...harvestsInPeriod].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    const expectedStartRef = sortedHarvests.length > 0 ? sortedHarvests[0].id : null
    const expectedEndRef =
      sortedHarvests.length > 0 ? sortedHarvests[sortedHarvests.length - 1].id : null
    cmp(
      `${c.name}.eiBiomassBasis.refs`,
      {
        start: comp.eiBiomassBasis.start.source_ref,
        end: comp.eiBiomassBasis.end.source_ref,
      },
      { start: expectedStartRef, end: expectedEndRef },
    )
    // 기록이 없으면 **빈 점**이어야 한다. 엔진의 더미 `sourceRef: "none"` 을 그대로
    // 적으면 "none 이라는 행을 실측했다" 로 읽힌다.
    if (sortedHarvests.length === 0) {
      if (
        comp.eiBiomassBasis.start.biomass_kg !== null ||
        comp.eiBiomassBasis.end.biomass_kg !== null
      ) {
        failures.push(
          `${c.name}.eiBiomassBasis: 수확 기록이 없는데 0 kg 더미를 근거처럼 적었다 — ` +
            JSON.stringify(comp.eiBiomassBasis),
        )
      }
    }
    // 픽스처 행에는 production_basis 칸이 없다(원본 Python 이 모르는 열이다) →
    // 두 점 모두 **미기재(null)** 여야 한다. 'measured' 로 읽으면 없는 사실을 만들어
    // 내는 것이고, 그 거짓이 그대로 리포트에 인쇄된다.
    if (
      comp.eiBiomassBasis.start.basis !== null ||
      comp.eiBiomassBasis.end.basis !== null
    ) {
      failures.push(
        `${c.name}.eiBiomassBasis: 산정 근거가 없는 행을 미기재로 두지 않았다 — ` +
          JSON.stringify(comp.eiBiomassBasis),
      )
    }

    // 같은 입력에 산정 근거만 적어 다시 돌린다. 자료유형 쪽과 같은 두 가지를 본다:
    //   · 그 값이 두 점에 정확히 실린다(행에서 꺼내는 길이 실제로 동작한다).
    //   · **KPI 수치는 한 글자도 달라지지 않는다** — 산정 근거는 산출 입력이 아니라
    //     그 산출의 분모가 무엇으로 만들어졌는지를 적는 메타데이터다.
    const basisHarvests = r.harvest_logs.map((row) => ({
      ...row,
      production_basis: "calculated",
      production_basis_note: "입식수 × 최종평균개체중",
      survival_adjusted: false,
    }))
    const harvestStampedDb = makeFakeDb({
      meters: r.meters,
      readings: r.readings,
      harvest_logs: basisHarvests,
      tanks: r.tanks,
      batches: r.batches,
      feed_logs: r.feed_logs,
      mortality_logs: r.mortality_logs,
      kpi_config: r.kpi_config ? [r.kpi_config] : [],
    })
    const harvestStamped = await computeSiteKpiResults(
      harvestStampedDb,
      "site-p",
      "org-p",
      new Date(c.period.from),
      new Date(c.period.to),
      new Date("2099-01-01T00:00:00Z"),
    )
    cmp(
      `${c.name}.harvestStamped.eiBiomassBasis`,
      {
        startBasis: harvestStamped.eiBiomassBasis.start.basis,
        endBasis: harvestStamped.eiBiomassBasis.end.basis,
        startNote: harvestStamped.eiBiomassBasis.start.basis_note,
        startSurvival: harvestStamped.eiBiomassBasis.start.survival_adjusted,
      },
      sortedHarvests.length > 0
        ? {
            startBasis: "calculated",
            endBasis: "calculated",
            startNote: "입식수 × 최종평균개체중",
            startSurvival: false,
          }
        : { startBasis: null, endBasis: null, startNote: null, startSurvival: null },
    )
    cmp(`${c.name}.harvestStamped.ei`, {
      eiTotal: harvestStamped.ei.eiTotal,
      eiAeration: harvestStamped.ei.eiAeration,
      biomassDeltaKg: harvestStamped.ei.biomassDeltaKg,
    }, {
      eiTotal: comp.ei.eiTotal,
      eiAeration: comp.ei.eiAeration,
      biomassDeltaKg: comp.ei.biomassDeltaKg,
    })

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
