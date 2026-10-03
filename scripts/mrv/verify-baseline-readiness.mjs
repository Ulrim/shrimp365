/**
 * 기준선 잠금 충분성 판정 검증 — `lib/mrv/baseline-readiness.ts`.
 *
 * **성격**: verify-csv 와 같이 **사양 기반 단위 검증**이다. 원본(FastAPI)에는 이 판정이
 * 아예 없었으므로(잠금 라우트가 기간 유효성만 보았다) 대조할 상대가 없다. 차분 검증과
 * 같은 무게로 읽히면 안 되므로 통과 메시지에도 그렇게 적는다.
 *
 * **이 검증이 지키는 것**
 *   · 되돌릴 수 없는 잠금을 막아야 할 때 실제로 막는가(차단 항목이 blocking 으로 잡히는가)
 *   · 막지 말아야 할 때 막지 않는가(경고·정보는 ok 를 깨지 않는다)
 *   · '5종 지표 전부 산출 불가'는 **강행으로도 못 넘기는** 상태(fatal)로 잡히는가
 *   · 임계값이 kpi_config 에서 오고, 없으면 기본값이며, 그 출처가 결과에 적히는가
 *   · 가드를 **조용히 끄는 설정값**(null·""·[]·false·음수·범위 밖)을 거부하는가
 *   · 판정이 **KPI 산식을 재계산하지 않는가** — 엔진이 준 수와 결론을 그대로 쓰는가
 *   · `params_json.baseline` 블록이 **지표 산출을 세우지 않는가**(⑪ — 실물 파서로 확인)
 *
 * `SiteKpiComputation` 은 `import type` 이라 실행 시 사라지므로 타입 전용 스텁으로
 * 대체한다. 반면 `kpi/config` 는 **실물을 컴파일해 쓴다** — 판정이 그 파서로 엔진과 같은
 * 설정을 읽기 때문에 스텁으로 바꾸면 검증하려는 연결이 사라진다.
 * 실제 타입이 어긋나는지는 `npx tsc --noEmit` 가 본다 — 역할이 다르다.
 *
 * 실행: node scripts/mrv/verify-baseline-readiness.mjs
 */

import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { cpSync, copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..")
const outDir = mkdtempSync(join(tmpdir(), "mrv-baseline-"))

const failures = []
let checked = 0

function check(name, actual, expected) {
  checked += 1
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) failures.push(`${name}\n      실제: ${a}\n      기대: ${e}`)
}
function checkTrue(name, condition, detail = "") {
  checked += 1
  if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ""}`)
}

/** 모든 검사를 넉넉히 통과하는 기준 산출 결과. 각 시험은 여기서 한 군데씩만 망가뜨린다. */
function healthyComp(overrides = {}) {
  const base = {
    ei: {
      eiTotal: 3.1,
      eiAeration: 1.8,
      biomassDeltaKg: 560,
      aerationPowerKwh: 980.4,
      includedReadingCount: 4321,
      excludedReadingCount: 12,
    },
    fcr: { fcr: 1.35, includedFeedCount: 28 },
    oei: { oei: 72.5, doTotalSamples: 2880, doInBandSamples: 2101 },
    mortality: { cumulativeRatePct: 4.2, stockedCount: 120000 },
    configVersion: "2026.1.0",
    paramsOut: {},
    tankId: null,
  }
  return {
    ...base,
    ...overrides,
    ei: { ...base.ei, ...(overrides.ei ?? {}) },
    fcr: { ...base.fcr, ...(overrides.fcr ?? {}) },
    oei: overrides.oei === null ? null : { ...base.oei, ...(overrides.oei ?? {}) },
    mortality: { ...base.mortality, ...(overrides.mortality ?? {}) },
  }
}

const DAY = 86_400_000
/** 기본 정책(7일)을 넉넉히 넘기는 30일 기간. */
const PERIOD = { from: new Date("2026-08-01T00:00:00Z"), to: new Date("2026-08-31T00:00:00Z") }

function idsOf(readiness, predicate) {
  return readiness.checks.filter(predicate).map((c) => c.id).sort()
}
function failedBlockingIds(readiness) {
  return idsOf(readiness, (c) => c.severity === "blocking" && !c.passed)
}

try {
  copyFileSync(
    join(ROOT, "lib/mrv/baseline-readiness.ts"),
    join(outDir, "baseline-readiness.ts"),
  )
  // 타입 전용 스텁. 실행 코드가 없으므로 판정 로직에 영향을 주지 않는다.
  writeFileSync(
    join(outDir, "kpi-service.ts"),
    [
      "// 검증용 타입 스텁(실제 타입 검사는 tsc --noEmit 가 한다).",
      "/* eslint-disable @typescript-eslint/no-explicit-any */",
      "export type SiteKpiComputation = any",
      "",
    ].join("\n"),
  )
  // kpi/* 는 **스텁이 아니라 실물**을 쓴다. 판정이 `eiConfigFromParams`·
  // `fcrConfigFromParams` 로 엔진과 같은 설정을 읽고 `KpiValueError` 를 던지므로,
  // 스텁으로 바꿔 두면 정작 검증하려는 연결이 사라진다. 덤으로 "baseline 블록이 지표
  // 파서를 세우지 않는가"(⑪)를 실물로 확인할 수 있다.
  cpSync(join(ROOT, "lib/mrv/kpi"), join(outDir, "kpi"), { recursive: true })

  execFileSync(
    "npx",
    [
      "tsc",
      join(outDir, "baseline-readiness.ts"),
      join(outDir, "kpi", "config.ts"),
      "--outDir", join(outDir, "out"),
      "--module", "commonjs",
      "--target", "es2022",
      "--moduleResolution", "node",
      "--skipLibCheck",
    ],
    { stdio: "inherit", cwd: ROOT },
  )

  const require = createRequire(join(outDir, "x.cjs"))
  const {
    assessBaselineReadiness,
    baselinePolicyFromParams,
    DEFAULT_BASELINE_POLICY,
    failedBlockingSummary,
  } = require(join(outDir, "out", "baseline-readiness.js"))
  const kpiConfig = require(join(outDir, "out", "kpi", "config.js"))

  // ── ① 건강한 기준선은 통과한다 ──────────────────────────────────────────
  const healthy = assessBaselineReadiness(healthyComp(), PERIOD, {})
  check("① 충분한 입력은 통과", healthy.ok, true)
  check("① fatal 아님", healthy.fatal, false)
  check("① 차단 미달 없음", failedBlockingIds(healthy), [])
  check("① 검사 항목은 9개다", healthy.checks.length, 9)
  checkTrue(
    "① 모든 검사에 id·severity·message 가 있다",
    healthy.checks.every(
      (c) => typeof c.id === "string" && c.id && ["blocking", "warning", "info"].includes(c.severity) && typeof c.message === "string" && c.message,
    ),
  )

  // ── ② 지표가 하나도 없으면 강행으로도 못 넘긴다 ─────────────────────────
  const empty = assessBaselineReadiness(
    healthyComp({
      ei: { eiTotal: null, eiAeration: null },
      fcr: { fcr: null },
      oei: null,
      mortality: { cumulativeRatePct: null },
    }),
    PERIOD,
    {},
  )
  check("② 전 지표 null 은 ok 가 아니다", empty.ok, false)
  check("② 전 지표 null 은 fatal 이다", empty.fatal, true)
  checkTrue("② all_metrics_null 이 차단으로 잡힌다", failedBlockingIds(empty).includes("all_metrics_null"))
  // 지표가 하나라도 있으면 fatal 이 아니다 — 막더라도 사유를 적으면 넘길 수 있어야 한다.
  const onlyMortality = assessBaselineReadiness(
    healthyComp({
      ei: { eiTotal: null, eiAeration: null },
      fcr: { fcr: null },
      oei: null,
    }),
    PERIOD,
    {},
  )
  check("② 지표가 하나라도 있으면 fatal 이 아니다", onlyMortality.fatal, false)

  // ── ③ 기간이 짧으면 막는다 ──────────────────────────────────────────────
  const shortPeriod = assessBaselineReadiness(healthyComp(), {
    from: new Date("2026-08-01T00:00:00Z"),
    to: new Date("2026-08-04T00:00:00Z"), // 3일
  }, {})
  check("③ 3일 기간은 막힌다", shortPeriod.ok, false)
  checkTrue("③ period_too_short 가 잡힌다", failedBlockingIds(shortPeriod).includes("period_too_short"))
  check("③ 그래도 fatal 은 아니다(사유로 넘길 수 있다)", shortPeriod.fatal, false)
  // 경계: 정확히 7일이면 통과해야 한다(>= 비교).
  const exactly7 = assessBaselineReadiness(healthyComp(), {
    from: new Date("2026-08-01T00:00:00Z"),
    to: new Date("2026-08-08T00:00:00Z"),
  }, {})
  check("③ 정확히 7일은 통과(경계 포함)", failedBlockingIds(exactly7).includes("period_too_short"), false)

  // ── ④ 근거 건수가 모자라면 막는다 ───────────────────────────────────────
  const fewReadings = assessBaselineReadiness(
    healthyComp({ ei: { includedReadingCount: 3, excludedReadingCount: 0 } }),
    PERIOD,
    {},
  )
  checkTrue("④ 전력 계측값 3건은 막힌다", failedBlockingIds(fewReadings).includes("power_readings_low"))
  checkTrue(
    "④ 메시지에 실제 건수가 들어간다",
    fewReadings.checks.find((c) => c.id === "power_readings_low").message.includes("3건"),
  )
  check(
    "④ 관측값·기준값을 그대로 싣는다",
    fewReadings.checks.find((c) => c.id === "power_readings_low").observed,
    3,
  )

  const fewFeed = assessBaselineReadiness(
    healthyComp({ fcr: { includedFeedCount: 1 } }),
    PERIOD,
    {},
  )
  checkTrue("④ 급이 기록 1건은 막힌다", failedBlockingIds(fewFeed).includes("feed_logs_low"))

  // ── ⑤ 제외 비율 ────────────────────────────────────────────────────────
  // 산입 100 / 제외 900 = 90% 제외. 값은 나오지만 믿을 수 없다.
  const mostlyExcluded = assessBaselineReadiness(
    healthyComp({ ei: { includedReadingCount: 100, excludedReadingCount: 900 } }),
    PERIOD,
    {},
  )
  checkTrue("⑤ 제외율 90% 는 막힌다", failedBlockingIds(mostlyExcluded).includes("excluded_ratio_high"))
  check(
    "⑤ 제외율을 비율 그대로 싣는다",
    mostlyExcluded.checks.find((c) => c.id === "excluded_ratio_high").observed,
    0.9,
  )
  // 경계: 정확히 50% 는 통과(<= 비교).
  const half = assessBaselineReadiness(
    healthyComp({ ei: { includedReadingCount: 500, excludedReadingCount: 500 } }),
    PERIOD,
    {},
  )
  check("⑤ 정확히 50% 는 통과(경계 포함)", failedBlockingIds(half).includes("excluded_ratio_high"), false)
  // 계측값이 아예 0건이면 0으로 나누지 않는다(제외율 0 으로 본다 — 건수 검사가 따로 막는다).
  const noReadings = assessBaselineReadiness(
    healthyComp({ ei: { includedReadingCount: 0, excludedReadingCount: 0 } }),
    PERIOD,
    {},
  )
  check("⑤ 0건이어도 NaN 이 나오지 않는다", noReadings.checks.find((c) => c.id === "excluded_ratio_high").observed, 0)
  checkTrue("⑤ 0건은 건수 검사가 막는다", failedBlockingIds(noReadings).includes("power_readings_low"))

  // ── ⑥ Δbiomass — 임계값을 복제하지 않고 엔진의 결론을 읽는다 ───────────
  // 엔진은 `biomassDeltaKg <= minBiomassDeltaKg` 일 때 EI·FCR 을 null 로 낸다. 판정은
  // 그 null 을 읽는다. 아래 스텁은 엔진이 실제로 내는 조합(delta 미달 → 지표 null)이다.
  const noGrowth = assessBaselineReadiness(
    healthyComp({ ei: { biomassDeltaKg: 0, eiTotal: null, eiAeration: null }, fcr: { fcr: null } }),
    PERIOD,
    {},
  )
  checkTrue("⑥ Δbiomass 0 은 막힌다", failedBlockingIds(noGrowth).includes("biomass_delta_nonpositive"))
  const shrank = assessBaselineReadiness(
    healthyComp({ ei: { biomassDeltaKg: -12.5, eiTotal: null, eiAeration: null }, fcr: { fcr: null } }),
    PERIOD,
    {},
  )
  checkTrue("⑥ Δbiomass 음수도 막힌다", failedBlockingIds(shrank).includes("biomass_delta_nonpositive"))

  // 핵심: 임계값이 0 이 아닌 사이트. delta=2 는 양수지만 min_biomass_delta_kg=5 이므로
  // 엔진은 지표를 null 로 낸다. 0 을 하드코딩했다면 여기서 "통과 + 지표 null" 이 된다.
  const aboveZeroBelowThreshold = assessBaselineReadiness(
    healthyComp({ ei: { biomassDeltaKg: 2, eiTotal: null, eiAeration: null }, fcr: { fcr: null } }),
    PERIOD,
    { ei: { min_biomass_delta_kg: 5 }, fcr: { min_biomass_delta_kg: 5 } },
  )
  checkTrue(
    "⑥ Δ 양수라도 엔진 임계값 미달이면 막힌다(0 하드코딩 금지)",
    failedBlockingIds(aboveZeroBelowThreshold).includes("biomass_delta_nonpositive"),
  )
  check(
    "⑥ 보고되는 기준은 엔진 설정값이다",
    aboveZeroBelowThreshold.checks.find((c) => c.id === "biomass_delta_nonpositive").threshold,
    5,
  )
  // 반대로 임계값이 음수라서 엔진이 산출해 낸 경우는 막지 않는다.
  const negativeThresholdOk = assessBaselineReadiness(
    healthyComp({ ei: { biomassDeltaKg: 0.5 } }),
    PERIOD,
    { ei: { min_biomass_delta_kg: 0.1 }, fcr: { min_biomass_delta_kg: 0.1 } },
  )
  check("⑥ 엔진이 산출해 냈으면 막지 않는다", negativeThresholdOk.ok, true)

  // ── ⑥-2 폭기 전력 0 — null 이 아니라 0 이므로 ① 도 ③ 도 잡지 못한다 ────
  const noAeration = assessBaselineReadiness(
    healthyComp({ ei: { aerationPowerKwh: 0, eiAeration: 0 } }),
    PERIOD,
    {},
  )
  check("⑥-2 폭기 전력 0 은 막힌다", noAeration.ok, false)
  checkTrue(
    "⑥-2 aeration_power_zero 가 차단으로 잡힌다",
    failedBlockingIds(noAeration).includes("aeration_power_zero"),
  )
  check("⑥-2 그래도 fatal 은 아니다(사유로 넘길 수 있다)", noAeration.fatal, false)
  // 분모가 없어 폭기 EI 자체가 null 인 경우는 ⑥ 이 이미 막으므로 중복 경고하지 않는다.
  const aerationNullNotFlagged = assessBaselineReadiness(
    healthyComp({
      ei: { aerationPowerKwh: 0, eiAeration: null, eiTotal: null, biomassDeltaKg: 0 },
      fcr: { fcr: null },
    }),
    PERIOD,
    {},
  )
  check(
    "⑥-2 폭기 EI 가 null 이면 이 항목은 중복 경고하지 않는다",
    failedBlockingIds(aerationNullNotFlagged).includes("aeration_power_zero"),
    false,
  )

  // ── ⑦ 경고·정보는 ok 를 깨지 않는다 ────────────────────────────────────
  const noStock = assessBaselineReadiness(
    healthyComp({ mortality: { stockedCount: 0, cumulativeRatePct: null } }),
    PERIOD,
    {},
  )
  check("⑦ 입식 0 은 경고일 뿐 막지 않는다", noStock.ok, true)
  checkTrue(
    "⑦ mortality_no_stock 이 warning 으로 잡힌다",
    noStock.checks.find((c) => c.id === "mortality_no_stock").severity === "warning" &&
      noStock.checks.find((c) => c.id === "mortality_no_stock").passed === false,
  )
  const noOei = assessBaselineReadiness(healthyComp({ oei: null }), PERIOD, {})
  check("⑦ OEI 미적용은 막지 않는다", noOei.ok, true)
  checkTrue(
    "⑦ oei_not_applicable 은 info 이고 언제나 passed",
    noOei.checks.find((c) => c.id === "oei_not_applicable").severity === "info" &&
      noOei.checks.find((c) => c.id === "oei_not_applicable").passed === true,
  )

  // ── ⑧ 정책 출처와 덮어쓰기 ─────────────────────────────────────────────
  check("⑧ baseline 블록이 없으면 기본값", baselinePolicyFromParams({}).source, "default")
  check("⑧ 기본값 내용", baselinePolicyFromParams({}).policy, DEFAULT_BASELINE_POLICY)
  check("⑧ null 도 기본값", baselinePolicyFromParams(null).source, "default")
  check("⑧ undefined 도 기본값", baselinePolicyFromParams(undefined).source, "default")

  /** 이 호출이 KpiValueError 를 던지는가. */
  function rejects(params) {
    try {
      baselinePolicyFromParams(params)
      return false
    } catch (err) {
      return err?.name === "KpiValueError"
    }
  }
  checkTrue("⑧ 객체가 아닌 블록은 거부", rejects({ baseline: "짧게" }))
  checkTrue("⑧ null 블록은 거부", rejects({ baseline: null }))
  checkTrue("⑧ 배열 블록은 거부", rejects({ baseline: [] }))
  checkTrue("⑧ 모르는 키는 거부(오탈자 조기 발견)", rejects({ baseline: { min_perio_days: 7 } }))

  const custom = baselinePolicyFromParams({
    baseline: { min_period_days: 30, min_power_readings: 10_000 },
  })
  check("⑧ 설정이 있으면 출처가 kpi_config", custom.source, "kpi_config")
  check("⑧ 적은 키만 덮어쓴다", custom.policy.minPeriodDays, 30)
  check("⑧ 안 적은 키는 기본값 유지", custom.policy.minFeedLogs, DEFAULT_BASELINE_POLICY.minFeedLogs)

  // ── ⑧-2 가드를 '조용히 끄는' 값은 전부 거부한다 ────────────────────────
  // Number(null)·Number("")·Number([])·Number(false) 는 모두 0 이다. 강제변환에 기대면
  // `min_power_readings: null` 한 줄이 임계값을 0 으로 만들어 가드를 끈다. 되돌릴 수 없는
  // 잠금의 임계값이라 조용히 기본값으로 메우지도, 0 으로 떨어지지도 않아야 한다.
  for (const [label, value] of [
    ["문자열", "일주일"],
    ["null", null],
    ["빈 문자열", ""],
    ["빈 배열", []],
    ["false", false],
    ["객체", {}],
    ["NaN 문자열", "NaN"],
  ]) {
    checkTrue(
      `⑧-2 min_power_readings 가 ${label} 이면 거부한다`,
      rejects({ baseline: { min_power_readings: value } }),
    )
  }
  checkTrue("⑧-2 음수 임계값은 거부", rejects({ baseline: { min_power_readings: -1 } }))
  checkTrue("⑧-2 음수 기간도 거부", rejects({ baseline: { min_period_days: -7 } }))
  checkTrue("⑧-2 비율 1 초과는 거부", rejects({ baseline: { max_excluded_reading_ratio: 100 } }))
  checkTrue("⑧-2 비율 음수도 거부", rejects({ baseline: { max_excluded_reading_ratio: -0.1 } }))
  checkTrue("⑧-2 Infinity 는 거부", rejects({ baseline: { min_feed_logs: Infinity } }))
  // 0 은 명시적 선택이므로 허용한다(그 선택은 config_version·감사 로그에 남는다).
  check(
    "⑧-2 0 은 허용한다(명시적으로 '보지 않겠다')",
    baselinePolicyFromParams({ baseline: { min_power_readings: 0 } }).policy.minPowerReadings,
    0,
  )
  check(
    "⑧-2 비율 경계 0·1 은 허용",
    [
      baselinePolicyFromParams({ baseline: { max_excluded_reading_ratio: 0 } }).policy
        .maxExcludedReadingRatio,
      baselinePolicyFromParams({ baseline: { max_excluded_reading_ratio: 1 } }).policy
        .maxExcludedReadingRatio,
    ],
    [0, 1],
  )

  // 설정으로 기준을 올리면 통과하던 기준선이 막혀야 한다.
  const strict = assessBaselineReadiness(healthyComp(), PERIOD, {
    baseline: { min_power_readings: 999_999 },
  })
  check("⑧ 설정이 실제로 판정에 적용된다", strict.ok, false)
  check("⑧ 적용된 정책이 결과에 실린다", strict.policy.minPowerReadings, 999_999)
  check("⑧ 출처도 결과에 실린다", strict.policySource, "kpi_config")

  // 설정을 느슨하게 하면 막히던 것이 통과해야 한다(양방향 확인).
  const lenient = assessBaselineReadiness(
    healthyComp({ ei: { includedReadingCount: 3, excludedReadingCount: 0 } }),
    { from: PERIOD.from, to: new Date(PERIOD.from.getTime() + 2 * DAY) },
    { baseline: { min_period_days: 1, min_power_readings: 1, min_feed_logs: 1 } },
  )
  check("⑧ 느슨한 설정이면 통과한다", lenient.ok, true)

  // ── ⑨ 요약 문구 ────────────────────────────────────────────────────────
  const summary = failedBlockingSummary(fewReadings)
  checkTrue("⑨ 요약에 미달 사유가 담긴다", summary.includes("전력 계측값"), summary)
  check("⑨ 통과한 판정의 요약은 빈 문자열", failedBlockingSummary(healthy), "")
  // fatal 일 때는 그 항목만 싣는다. 호출부가 "이 항목은 강행할 수 없습니다" 를 뒤에
  // 붙이므로, 함께 걸린 강행 가능 항목까지 이어 붙이면 그것들도 강행 불가로 읽힌다.
  const fatalSummary = failedBlockingSummary(
    assessBaselineReadiness(
      healthyComp({
        ei: { eiTotal: null, eiAeration: null, biomassDeltaKg: 0, includedReadingCount: 1 },
        fcr: { fcr: null, includedFeedCount: 0 },
        oei: null,
        mortality: { cumulativeRatePct: null },
      }),
      { from: PERIOD.from, to: new Date(PERIOD.from.getTime() + DAY) },
      {},
    ),
  )
  checkTrue("⑨ fatal 요약에 그 사유가 담긴다", fatalSummary.includes("산출 불가"), fatalSummary)
  checkTrue(
    "⑨ fatal 요약에 강행 가능한 항목은 섞이지 않는다",
    !fatalSummary.includes("기준선 기간") && !fatalSummary.includes("급이 기록"),
    fatalSummary,
  )

  // ── ⑩ 재계산하지 않는다 ────────────────────────────────────────────────
  // 엔진이 준 수를 그대로 쓰는지 — 말이 안 되는 조합을 줘도 그 값을 그대로 판정에 쓴다.
  // (판정 모듈이 몰래 다시 세기 시작하면 이 시험이 깨진다.)
  const weird = assessBaselineReadiness(
    healthyComp({ ei: { includedReadingCount: 7, excludedReadingCount: 3 } }),
    PERIOD,
    { baseline: { min_power_readings: 5 } },
  )
  check("⑩ 산입 건수를 그대로 쓴다", weird.checks.find((c) => c.id === "power_readings_low").observed, 7)
  check("⑩ 제외율도 준 값으로만 계산한다", weird.checks.find((c) => c.id === "excluded_ratio_high").observed, 0.3)

  // ── ⑪ baseline 블록이 지표 산출을 세우지 않는다 ────────────────────────
  // 이 판정의 임계값은 `kpi_config.params_json.baseline` 에 산다. 그런데 엔진의 설정
  // 파서는 "지표 서브키가 하나도 없으면 평면 EI 문서"로 보고 **최상위 문서 전체를**
  // 모르는 키 검사에 넘긴다. 그래서 `kpi/config.ts` 의 EXTENSION_KEYS 에 baseline 이
  // 등재되어 있지 않으면, 그 블록만 적은 설정 한 줄이 6종 파서 전부를 KpiValueError 로
  // 세우고 그 org 의 /kpi·리포트·알림이 통째로 422 가 된다. 실물 파서로 못박아 둔다.
  const PARSERS = {
    ei: kpiConfig.eiConfigFromParams,
    fcr: kpiConfig.fcrConfigFromParams,
    oei: kpiConfig.oeiConfigFromParams,
    mortality: kpiConfig.mortalityConfigFromParams,
    alerting: kpiConfig.alertingConfigFromParams,
    recommend: kpiConfig.recommendConfigFromParams,
  }
  const BASELINE_ONLY = { baseline: { min_period_days: 14 } }
  const WITH_FLAT_KEY = { included_quality_flags: ["ok"], baseline: { min_feed_logs: 9 } }
  for (const [metric, parse] of Object.entries(PARSERS)) {
    for (const [label, doc] of [
      ["baseline 블록만 있는 문서", BASELINE_ONLY],
      ["지표 서브키와 함께 있는 문서", { ei: {}, ...BASELINE_ONLY }],
    ]) {
      let threw = null
      try {
        parse(doc)
      } catch (err) {
        threw = err?.message ?? String(err)
      }
      checkTrue(`⑪ ${label}를 ${metric} 파서가 거부하지 않는다`, threw === null, threw ?? "")
    }
  }
  // 평면 키와 섞인 문서는 '중첩 문서'로 판정되어 평면 키가 조용히 무시된다. 기존 혼합
  // 문서(`{included_quality_flags, ei:{...}}`)와 같은 동작이므로 새 함정이 아니지만,
  // 적어도 **거부로 터지지는 않는다**는 사실을 고정해 둔다.
  checkTrue(
    "⑪ 평면 키와 섞여도 터지지 않는다",
    (() => {
      try {
        PARSERS.ei(WITH_FLAT_KEY)
        return true
      } catch {
        return false
      }
    })(),
  )
  // 블록의 내용 검증은 판정 모듈의 몫이다 — 엔진 파서는 들여다보지 않는다.
  checkTrue(
    "⑪ 엔진 파서는 baseline 내용을 검사하지 않는다(소비자가 검사한다)",
    (() => {
      try {
        PARSERS.ei({ baseline: { 모르는키: 1 } })
        return true
      } catch {
        return false
      }
    })(),
  )
  checkTrue(
    "⑪ 그 잘못된 블록은 판정 모듈이 거부한다",
    rejects({ baseline: { 모르는키: 1 } }),
  )

  if (failures.length > 0) {
    console.error(`✗ 기준선 충분성 판정 검증 실패 — ${failures.length}건\n`)
    for (const f of failures) console.error("  " + f)
    process.exitCode = 1
  } else {
    console.log(
      `✓ 기준선 충분성 판정 검증 통과 — ${checked}개 항목 ` +
        `(원본에 없던 판정이라 차분 검증이 아니라 사양 기반 단위 검증이다)`,
    )
  }
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
