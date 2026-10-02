// 크기별 단가 모델 자체검증 — 구현이 설계대로이고 관측 사다리의 수를
// 재현하는지 확인한다. scripts/growth/verify.mjs ·
// scripts/profitability/verify.mjs 와 같은 방식·같은 역할이다.
//
//   node scripts/pricing/verify.mjs
//
// 테스트 프레임워크를 들이지 않는다(이 저장소에 없다). Node 22 의 타입
// 스트리핑으로 lib/pricing 의 .ts 를 그대로 불러 쓰므로 새 의존성도 없다.
// **데이터 파일이 필요 없다** — 관측 4점이 상수로 들어 있어서 누구나 돌릴 수 있다.
//
// 검증은 네 층이다.
//
//   (가) **사다리 재현** — 전구간 탄력성 0.632 · 구간별 0.556/0.613/0.718 ·
//        단조 증가 · 택배 고정비를 뺀 상한 0.73.
//   (나) **앵커 외삽** — 17,000 원/kg @28.57 g 에서 31.6 g 이 약 18,100 원인가.
//   (다) **섞임 방지** — 프리미엄 점을 섞으면 거부되는가. 네 겹이 각각 걸리는가.
//   (라) **설계 규칙 검사** — 소매→산지 ÷2.2 인가, 범위 밖 계수가 거부되는가,
//        냉동 계수로 활 단가를 계산할 수 있는가, 계절항이 0 이고 그 사실이
//        반환값에 드러나는가.
//
// (다)·(라)가 이 스크립트의 절반이다. 수가 맞는지는 (가)·(나)로 끝나는데,
// **수가 맞는 채로 조용히 틀리는 쪽**이 이 모델의 실제 위험이다 — 판매처를
// 섞어 기울기 부호를 뒤집거나, 냉동 계수로 활 단가를 계산하거나, 계절 보정이
// 들어간 줄 알고 추계 출하 판정을 맡기는 쪽.

import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

// lib 안쪽의 import 는 확장자가 없고(tsconfig 의 moduleResolution "bundler"),
// 디렉토리 간에는 "@/lib/..." 별칭을 쓴다(저장소 규약). Node 는 둘 다 모르므로
// 그 차이를 여기서 메운다. **제품 코드를 검증 도구에 맞춰 바꾸지 않는다.**
const ROOT = fileURLToPath(new URL("../../", import.meta.url))

registerHooks({
  resolve(specifier, context, nextResolve) {
    const candidates = []
    if (specifier.startsWith("@/")) {
      const base = pathToFileURL(ROOT + specifier.slice(2)).href
      candidates.push(`${base}.ts`, `${base}/index.ts`, base)
    } else if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
      candidates.push(`${specifier}.ts`, `${specifier}/index.ts`)
    }
    for (const candidate of candidates) {
      try {
        return nextResolve(candidate, context)
      } catch {
        // 다음 후보로.
      }
    }
    return nextResolve(specifier, context)
  },
})

const {
  DEFAULT_SIZE_ELASTICITY,
  FARM_PRICE_ANCHOR,
  FROZEN_SIZE_ELASTICITY,
  PENDING_OFFICIAL_SOURCES,
  RETAIL_SHIPPING_FIXED_KRW_PER_KG,
  RETAIL_TO_FARMGATE_DIVISOR,
  RETAIL_TO_FARMGATE_DIVISOR_RANGE,
  SEASONAL_ADJUSTMENT,
  SIZE_ELASTICITY_BAND,
  SIZE_ELASTICITY_DEFAULT,
  SIZE_PRICE_LADDER,
  SIZE_PRICE_LADDER_RUNGS,
  STAGE_MULTIPLIER,
  anchorFromCountPerKg,
  buildLadders,
  convertStage,
  estimateSizePrice,
  farmgateToRetail,
  fitSizeElasticity,
  fitSizeElasticityFromObservations,
  retailToFarmgate,
  sizePriceTable,
  stageReferenceKrwPerKg,
} = await import("../../lib/pricing/index.ts")

const { SIZE_PRICE_ANCHOR } = await import("../../lib/profitability/constants.ts")

// ── 기대값 ────────────────────────────────────────────────────────────────
// 지시서의 수. 전구간 0.632 · 구간별 0.556 / 0.613 / 0.718.
//
// **구간 2 만 0.0008 어긋난다.** 지시서는 0.613 인데 1000/countPerKg 를 ABW 로
// 쓴 정확한 계산은 0.6122 다(ln(31900/29800) / ln(38/34) = 0.0680977/0.1112256).
// 0.613 이 되려면 중간 반올림이 들어가야 한다. 다른 세 수(0.5567·0.7181·0.6324)는
// 소수 네 자리까지 그대로 재현되므로 **모델이 아니라 그 한 수의 반올림 단계가
// 다른 것으로 본다.** 허용 오차 ±0.005 안이고, 아래에서 두 수를 같이 출력한다.
const EXPECT = {
  endToEnd: 0.632,
  segments: [0.556, 0.613, 0.718],
  segmentsExact: [0.556693, 0.612247, 0.718109],
  endToEndExact: 0.632438,
  ols: 0.631521,
  strippedEndToEnd: 0.7255,
  anchorAbwG: 1000 / 35,
  targetAbwG: 31.6,
  targetKrwPerKg: 18100,
  perGradeStepPct: 0.076,
  fullRangePct: 0.246,
}
const TOL = 0.005

const fails = []
let checks = 0

function check(label, ok, detail = "") {
  checks++
  if (!ok) fails.push(label)
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `\n        ${detail}`}`)
}

function checkEqual(label, got, want) {
  check(label, got === want, `받음 ${JSON.stringify(got)} / 기대 ${JSON.stringify(want)}`)
}

function checkClose(label, got, want, tol) {
  const ok = typeof got === "number" && Number.isFinite(got) && Math.abs(got - want) <= tol
  check(label, ok, `받음 ${got} / 기대 ${want} ±${tol}`)
}

const krw = (v) => (typeof v === "number" ? Math.round(v).toLocaleString("ko-KR") : String(v))
const hasCode = (list, code) => (list ?? []).some((e) => e.code === code)
const findCode = (list, code) => (list ?? []).find((e) => e.code === code)

const vendorListing = (vendor, productId) => ({
  kind: "vendor_listing",
  vendor,
  marketplace: "11번가",
  productId,
})

/** 사다리 4점을 느슨한 관측 배열로. (다) 에서 여기에 점을 더해 섞는다. */
function ladderObservations(overrides = {}) {
  return SIZE_PRICE_LADDER_RUNGS.map((r) => ({
    vendor: "이순신수산",
    stage: "online_retail",
    form: "live",
    premium: false,
    observedAt: "2026-10",
    grade: "A",
    source: vendorListing("이순신수산", "8549532487"),
    countPerKg: r.countPerKg,
    krwPerKg: r.krwPerKg,
    label: r.label,
    ...overrides,
  }))
}

// ── (가) 사다리 재현 ──────────────────────────────────────────────────────

function ladderChecks() {
  console.log("\n[가] 동일 판매처 4단 사다리 재현 — 이순신수산/11번가 8549532487, 2026-10\n")

  const fit = fitSizeElasticity(SIZE_PRICE_LADDER)
  checkEqual("가-1 적합이 성공한다", fit.failure, null)
  checkEqual("가-2 사다리는 4점이다", SIZE_PRICE_LADDER.points.length, 4)
  checkEqual("가-3 구간은 3개다", fit.segments.length, 3)

  checkClose("가-4 전구간 탄력성 0.632", fit.endToEnd, EXPECT.endToEnd, TOL)
  checkClose("가-5 전구간 정확값 0.632438", fit.endToEnd, EXPECT.endToEndExact, 1e-5)
  checkClose("가-6 로그-로그 OLS 0.631521", fit.ols, EXPECT.ols, 1e-5)

  for (let i = 0; i < 3; i++) {
    const seg = fit.segments[i].elasticity
    checkClose(`가-7-${i + 1} 구간 ${i + 1} 탄력성 ${EXPECT.segments[i]}`, seg, EXPECT.segments[i], TOL)
    checkClose(`가-8-${i + 1} 구간 ${i + 1} 정확값 ${EXPECT.segmentsExact[i]}`, seg, EXPECT.segmentsExact[i], 1e-5)
  }

  // 탄력성이 크기와 함께 커진다 — 상수 가정이 큰 개체를 과소평가한다는 근거.
  checkEqual("가-9 구간 탄력성이 단조 증가한다", fit.segmentsMonotoneIncreasing, true)
  checkEqual("가-10 그 사실이 경고로 올라온다", hasCode(fit.exclusions, "price_elasticity_size_dependent"), true)
  checkClose(
    "가-11 경고 수량은 최대 구간 탄력성",
    findCode(fit.exclusions, "price_elasticity_size_dependent").quantity,
    EXPECT.segmentsExact[2],
    1e-5,
  )

  // 근거의 약점을 적합 결과가 들고 나간다.
  checkEqual("가-12 잠정값임을 알린다", hasCode(fit.exclusions, "price_elasticity_provisional"), true)
  checkEqual("가-13 단일 판매처 근거임을 알린다", hasCode(fit.exclusions, "price_elasticity_single_vendor"), true)
  checkEqual("가-14 판매처 수는 1", fit.vendorCount, 1)
  checkEqual("가-15 기본 탄력성도 잠정값이다", DEFAULT_SIZE_ELASTICITY.provisional, true)

  // 기본값은 0.6324 가 아니라 두 자리로 자른 0.63 이다 — 정밀도로 읽히지 않게.
  checkEqual("가-16 기본 탄력성 설정값은 0.63", SIZE_ELASTICITY_DEFAULT, 0.63)
  checkEqual("가-17 기본 탄력성 value 도 0.63", DEFAULT_SIZE_ELASTICITY.value, 0.63)
  check(
    "가-18 설정값 0.63 과 적합값 0.6324 의 차이는 0.005 미만",
    Math.abs(SIZE_ELASTICITY_DEFAULT - fit.endToEnd) < TOL,
    `${SIZE_ELASTICITY_DEFAULT} vs ${fit.endToEnd}`,
  )

  // 등급 한 단계(약 4미/kg) 당 +7.6% · 전구간 +24.6%.
  const rungs = SIZE_PRICE_LADDER_RUNGS
  const stepPcts = rungs.slice(1).map((r, i) => r.krwPerKg / rungs[i].krwPerKg - 1)
  const meanStep = stepPcts.reduce((a, b) => a + b, 0) / stepPcts.length
  checkClose("가-19 등급 한 단계당 평균 +7.6%", meanStep, EXPECT.perGradeStepPct, 0.002)
  checkClose(
    "가-20 전구간 +24.6%",
    rungs[3].krwPerKg / rungs[0].krwPerKg - 1,
    EXPECT.fullRangePct,
    0.001,
  )

  // 경고 2 — 택배 고정비 4,000 원/kg 을 빼면 탄력성이 0.73 으로 올라간다.
  const stripped = fitSizeElasticity({
    ...SIZE_PRICE_LADDER,
    points: SIZE_PRICE_LADDER.points.map((p) => ({
      ...p,
      krwPerKg: p.krwPerKg - RETAIL_SHIPPING_FIXED_KRW_PER_KG,
    })),
  })
  checkEqual("가-21 택배비 4,000원", RETAIL_SHIPPING_FIXED_KRW_PER_KG, 4000)
  checkClose("가-22 고정비를 빼면 탄력성 0.7255", stripped.endToEnd, EXPECT.strippedEndToEnd, 0.001)
  check(
    "가-23 그래서 0.63 은 하한이다 — 밴드 상한이 0.73",
    SIZE_ELASTICITY_BAND.low === 0.63 && SIZE_ELASTICITY_BAND.high === 0.73,
    JSON.stringify(SIZE_ELASTICITY_BAND),
  )
  check(
    "가-24 밴드 상한이 고정비 제거값을 덮는다",
    SIZE_ELASTICITY_BAND.high >= stripped.endToEnd - 0.01,
    `밴드 ${SIZE_ELASTICITY_BAND.high} vs 제거값 ${stripped.endToEnd.toFixed(4)}`,
  )

  console.log("")
  console.log(`  ${"등급".padEnd(14)} ${"미/kg".padStart(6)} ${"ABW".padStart(7)} ${"원/kg".padStart(8)}  구간 탄력성`)
  for (let i = 0; i < SIZE_PRICE_LADDER.points.length; i++) {
    const p = SIZE_PRICE_LADDER.points[SIZE_PRICE_LADDER.points.length - 1 - i]
    const seg = fit.segments.find((s) => s.toCountPerKg === p.countPerKg)
    console.log(
      `  ${(p.label ?? "").padEnd(14)} ${p.countPerKg.toFixed(1).padStart(6)} ${p.abwG.toFixed(1).padStart(6)}g ${krw(p.krwPerKg).padStart(8)}  ${seg ? seg.elasticity.toFixed(4) : "—"}`,
    )
  }
  console.log(
    `  전구간 ${fit.endToEnd.toFixed(6)}(지시서 0.632) · OLS ${fit.ols.toFixed(6)} · 고정비 제거 ${stripped.endToEnd.toFixed(6)}(지시서 0.73)`,
  )
  console.log(
    `  구간별 ${fit.segments.map((s) => s.elasticity.toFixed(4)).join(" / ")}  (지시서 0.556 / 0.613 / 0.718 — 구간 2 는 0.6122, 반올림 단계 차이)`,
  )
}

// ── (나) 앵커 외삽 ────────────────────────────────────────────────────────

function anchorChecks() {
  console.log("\n[나] 수준 앵커 — 농가 실수취가에서 외삽\n")

  // 수준은 엔진 2 의 실거래 1점에서 온다. 같은 수를 두 군데 적지 않는다.
  checkEqual("나-1 앵커 단가는 엔진 2 의 17,000원", FARM_PRICE_ANCHOR.krwPerKg, SIZE_PRICE_ANCHOR.krwPerKg)
  checkEqual("나-2 앵커 미/kg 은 35", SIZE_PRICE_ANCHOR.countPerKg, 35)
  checkClose("나-3 앵커 ABW 는 28.57g", FARM_PRICE_ANCHOR.abwG, EXPECT.anchorAbwG, 1e-9)
  checkEqual("나-4 앵커 단계는 도매", FARM_PRICE_ANCHOR.stage, "wholesale")
  checkEqual("나-5 앵커 상태는 활", FARM_PRICE_ANCHOR.form, "live")
  checkEqual("나-6 앵커는 프리미엄이 아니다", FARM_PRICE_ANCHOR.premium, false)

  // 핵심 수치 — 2주 뒤 31.6 g 이면 약 18,100 원/kg.
  const e = estimateSizePrice(FARM_PRICE_ANCHOR, EXPECT.targetAbwG)
  checkEqual("나-7 추정이 성공한다", e.failure, null)
  checkClose("나-8 31.6g 단가는 약 18,100원/kg", e.krwPerKg, EXPECT.targetKrwPerKg, 100)
  checkClose("나-9 정확값 18,114원", e.krwPerKg, 18114.0, 1)
  checkClose("나-10 앵커 대비 +6.6%", e.priceRatio - 1, 0.0655, 0.001)
  checkClose("나-11 목표 미/kg 은 31.6", e.targetCountPerKg, 1000 / 31.6, 1e-9)

  // 밴드 — 0.63 이 하한이므로 상한 쪽이 더 비싸다.
  checkClose("나-12 밴드 하한은 0.63 의 값", e.bandKrwPerKg.low, 18114.0, 1)
  checkClose("나-13 밴드 상한은 0.73 의 값 18,297원", e.bandKrwPerKg.high, 18297.4, 1)
  check(
    "나-14 밴드 상한 > 점추정 — 0.63 이 하한임이 금액에 드러난다",
    e.bandKrwPerKg.high > e.krwPerKg,
    `${krw(e.krwPerKg)} → ${krw(e.bandKrwPerKg.high)}`,
  )
  checkEqual("나-15 하한임을 경고로 알린다", hasCode(e.exclusions, "price_elasticity_lower_bound"), true)
  checkEqual(
    "나-16 경고 수량은 밴드 상한 0.73",
    findCode(e.exclusions, "price_elasticity_lower_bound").quantity,
    0.73,
  )

  // 외삽이라는 사실·근거의 약점이 금액과 함께 나간다.
  checkEqual("나-17 앵커 외삽임을 알린다", hasCode(e.exclusions, "price_extrapolated_from_anchor"), true)
  checkEqual("나-18 잠정값임을 알린다", hasCode(e.exclusions, "price_elasticity_provisional"), true)
  checkEqual("나-19 단일 판매처임을 알린다", hasCode(e.exclusions, "price_elasticity_single_vendor"), true)
  checkEqual("나-20 상수 탄력성의 한계를 알린다", hasCode(e.exclusions, "price_elasticity_size_dependent"), true)
  checkEqual(
    "나-21 공시 통계가 없음을 알린다",
    hasCode(e.exclusions, "price_official_statistics_unavailable"),
    true,
  )
  checkEqual(
    "나-22 대기 중인 데이터셋 3개",
    findCode(e.exclusions, "price_official_statistics_unavailable").quantity,
    3,
  )
  checkEqual("나-23 데이터셋 셋 전부 호출 불가", PENDING_OFFICIAL_SOURCES.every((s) => s.fetchable === false), true)

  // 사다리 관측 범위(23.5~33.3g) 밖이면 알린다.
  const inside = estimateSizePrice(FARM_PRICE_ANCHOR, 30)
  const outside = estimateSizePrice(FARM_PRICE_ANCHOR, 45)
  checkEqual("나-24 범위 안이면 범위 경고가 없다", hasCode(inside.exclusions, "price_target_outside_observed_size"), false)
  checkEqual("나-25 45g 은 관측 범위 밖임을 알린다", hasCode(outside.exclusions, "price_target_outside_observed_size"), true)

  // ── 앵커 단계 경고 ──────────────────────────────────────────
  // 이 모듈에서 유일하게 "막지 않고 경고만 하는" 사고다. 소매 단가를 묻는 것
  // 자체는 정당하므로 null 로 거부할 수 없는데, 그 수를 농가 수익에 그대로
  // 넣으면 약 1.9배 과대가 된다. 경고가 빠지면 아무도 알아채지 못한다.
  const farmAnchored = estimateSizePrice(FARM_PRICE_ANCHOR, 31.6, {})
  const retailAnchor = { krwPerKg: 28000, abwG: 23.5, stage: "online_retail", form: "live", premium: false }
  const retailAnchored = estimateSizePrice(retailAnchor, 31.6, {})

  checkEqual("나-40 농가(도매) 앵커에는 단계 경고가 없다",
    hasCode(farmAnchored.exclusions, "price_anchor_not_farmgate"), false)
  checkEqual("나-41 소매 앵커는 농가 수취가가 아님을 알린다",
    hasCode(retailAnchored.exclusions, "price_anchor_not_farmgate"), true)
  checkEqual("나-42 그래도 단가는 돌려준다(거부가 아니라 경고다)",
    retailAnchored.krwPerKg !== null, true)
  const farmgateHint = retailAnchored.exclusions.find((e) => e.code === "price_anchor_not_farmgate")
  checkClose("나-43 경고가 농가 수취가 환산 배수를 싣는다", farmgateHint?.quantity ?? 0, 2.2, 0.01)
  checkEqual("나-44 그 배수의 단위는 ratio", farmgateHint?.unit, "ratio")
  // 경고를 무시했을 때 실제로 얼마나 틀리는지 — 이 수가 경고의 존재 이유다
  checkClose("나-45 소매 앵커는 농가 앵커의 약 1.9배를 낸다",
    retailAnchored.krwPerKg / farmAnchored.krwPerKg, 1.863, 0.01)
  check("나-26 범위 밖도 수는 돌려준다(거부가 아니다)", outside.krwPerKg !== null, String(outside.krwPerKg))

  // 크기가 커지면 단가가 오른다 — 부호 검사.
  const table = sizePriceTable(FARM_PRICE_ANCHOR, [22, 25, 28.57, 31.6, 35])
  let monotone = true
  for (let i = 1; i < table.length; i++) if (table[i].krwPerKg <= table[i - 1].krwPerKg) monotone = false
  check("나-27 큰 개체가 비싸다 — 부호가 뒤집히지 않았다", monotone)
  checkEqual("나-28 표의 행마다 단계가 따라붙는다", table.every((r) => r.stage === "wholesale"), true)
  checkEqual("나-29 표의 행마다 경고가 따라붙는다", table.every((r) => r.exclusions.length > 0), true)

  // 미/kg 으로 앵커를 만들어도 같은 수가 나온다.
  const byCount = anchorFromCountPerKg({ ...FARM_PRICE_ANCHOR, countPerKg: 35 })
  checkClose("나-30 미/kg 으로 만든 앵커도 같다", byCount.abwG, FARM_PRICE_ANCHOR.abwG, 1e-12)

  console.log("")
  console.log(`  ${"ABW".padStart(7)} ${"미/kg".padStart(6)} ${"단가".padStart(9)} ${"하한(0.63)".padStart(11)} ${"상한(0.73)".padStart(11)}`)
  for (const r of table) {
    console.log(
      `  ${r.targetAbwG.toFixed(2).padStart(6)}g ${r.targetCountPerKg.toFixed(1).padStart(6)} ${krw(r.krwPerKg).padStart(9)} ${krw(r.bandKrwPerKg.low).padStart(11)} ${krw(r.bandKrwPerKg.high).padStart(11)}`,
    )
  }
}

// ── (다) 섞임 방지 ────────────────────────────────────────────────────────

function mixingChecks() {
  console.log("\n[다] 섞임 방지 — 판매처 간 노이즈가 크기 신호의 3배다\n")

  // 먼저 그 사실 자체를 수로 확인한다.
  const sizeEffect = 34900 / 28000 - 1
  const vendorSpread = 49900 / 28000 - 1
  checkClose("다-1 크기 전구간 효과 +24.6%", sizeEffect, 0.246, 0.001)
  checkClose("다-2 같은 40미 판매처 폭 +78.2%", vendorSpread, 0.782, 0.001)
  check("다-3 판매처 노이즈가 크기 신호의 3배 이상", vendorSpread / sizeEffect >= 3, (vendorSpread / sizeEffect).toFixed(2))

  // 깨끗한 배열은 통과한다.
  const clean = fitSizeElasticityFromObservations(ladderObservations())
  checkEqual("다-4 동일 판매처 사다리는 통과한다", clean.failure, null)
  checkEqual("다-5 묶음은 1개다", clean.groupKeys.length, 1)
  checkClose("다-6 같은 전구간 탄력성이 나온다", clean.endToEnd, EXPECT.endToEndExact, 1e-5)

  // ── 2겹 — 프리미엄 점을 섞으면 거부된다 ───────────────────────────────
  // 무항생제·친환경 49,900원 @40미. 40미인데 특대(30미, 34,900원)보다 비싸다.
  const premiumPoint = {
    vendor: "친환경수산",
    stage: "online_premium",
    form: "live",
    premium: true,
    observedAt: "2026-10",
    grade: "A",
    source: vendorListing("친환경수산", "9900000001"),
    countPerKg: 40,
    krwPerKg: 49900,
    label: "무항생제·친환경 40미",
  }
  const mixed = fitSizeElasticityFromObservations([...ladderObservations(), premiumPoint])
  checkEqual("다-7 프리미엄 점을 섞으면 거부된다", mixed.failure, "mixed_vendors")
  checkEqual("다-8 탄력성이 null 이다 — 기본값으로 떨어지지 않는다", mixed.elasticity, null)
  checkEqual("다-9 수도 돌려주지 않는다", mixed.endToEnd, null)
  checkEqual("다-10 판매처 섞임을 경고로 알린다", hasCode(mixed.exclusions, "price_ladder_vendor_mixed"), true)
  checkEqual("다-11 섞인 묶음 수를 수량으로 담는다", findCode(mixed.exclusions, "price_ladder_vendor_mixed").quantity, 2)
  checkEqual("다-12 프리미엄 제외를 알린다", hasCode(mixed.exclusions, "price_ladder_premium_excluded"), true)
  checkEqual("다-13 묶음 키 2개가 그대로 나온다", mixed.groupKeys.length, 2)

  // 산지직송 42,900원 @40미 — 프리미엄 플래그 없이 판매처만 달라도 거부된다.
  const directPoint = {
    ...premiumPoint,
    vendor: "산지직송몰",
    stage: "direct_bulk",
    premium: false,
    countPerKg: 40,
    krwPerKg: 42900,
    label: "산지직송 40미",
  }
  const mixed2 = fitSizeElasticityFromObservations([...ladderObservations(), directPoint])
  checkEqual("다-14 판매처만 달라도 거부된다", mixed2.failure, "mixed_vendors")
  checkEqual("다-15 그때도 탄력성은 null", mixed2.elasticity, null)

  // ── 3겹 — 라벨이 거짓이어도 단조성에 걸린다 ───────────────────────────
  // 같은 판매처·같은 단계·프리미엄 false 로 위장한 49,900원 @40미.
  const disguised = ladderObservations().concat([
    {
      ...ladderObservations()[0],
      countPerKg: 40,
      krwPerKg: 49900,
      label: "위장 프리미엄 40미",
    },
  ])
  const lied = fitSizeElasticityFromObservations(disguised)
  checkEqual("다-16 묶기로는 잡히지 않는다(묶음 1개)", lied.groupKeys.length, 1)
  check(
    "다-17 그래도 거부된다 — 단조성 또는 크기 상한에 걸린다",
    lied.failure === "price_not_monotonic" || lied.failure === "elasticity_implausible",
    `failure=${lied.failure}`,
  )
  checkEqual("다-18 그때도 탄력성은 null", lied.elasticity, null)
  check(
    "다-19 어긋난 점을 경고로 알린다",
    hasCode(lied.exclusions, "price_ladder_not_monotonic") ||
      hasCode(lied.exclusions, "price_ladder_elasticity_implausible"),
    JSON.stringify(lied.exclusions),
  )

  // 단조성만 깨뜨리는 경우 — 특대를 소보다 싸게.
  const inverted = fitSizeElasticity({
    ...SIZE_PRICE_LADDER,
    points: SIZE_PRICE_LADDER.points.map((p, i) => (i === 3 ? { ...p, krwPerKg: 27000 } : p)),
  })
  checkEqual("다-20 특대가 소보다 싸면 거부된다", inverted.failure, "price_not_monotonic")
  checkEqual("다-21 어긋난 점의 미/kg 을 담는다", findCode(inverted.exclusions, "price_ladder_not_monotonic").quantity, 30)

  // ── 4겹 — 구간 탄력성 상한 ────────────────────────────────────────────
  // 단조는 지키면서 크기 효과로 설명되지 않는 폭. 42.5미 28,000 → 40미 49,900
  // 의 구간 탄력성은 9.53 이다.
  const steep = fitSizeElasticity({
    ...SIZE_PRICE_LADDER,
    points: [
      { countPerKg: 42.5, abwG: 1000 / 42.5, krwPerKg: 28000 },
      { countPerKg: 40, abwG: 1000 / 40, krwPerKg: 49900 },
    ],
  })
  checkEqual("다-22 구간 탄력성 9.53 은 거부된다", steep.failure, "elasticity_implausible")
  checkClose(
    "다-23 그 값을 수량으로 담는다",
    findCode(steep.exclusions, "price_ladder_elasticity_implausible").quantity,
    9.5311,
    0.001,
  )
  checkEqual("다-24 거부해도 구간 계산은 보여 준다", steep.segments.length, 1)

  // ── 1겹 — 타입. 사다리 단위로 판매처를 든다 ───────────────────────────
  checkEqual("다-25 사다리는 판매처를 하나 든다", typeof SIZE_PRICE_LADDER.vendor, "string")
  checkEqual(
    "다-26 칸은 자기 판매처를 들지 않는다",
    SIZE_PRICE_LADDER.points.every((p) => !("vendor" in p)),
    true,
  )
  const noVendor = fitSizeElasticity({ ...SIZE_PRICE_LADDER, vendor: "  " })
  checkEqual("다-27 판매처가 비면 거부된다", noVendor.failure, "vendor_missing")
  const premiumLadder = fitSizeElasticity({ ...SIZE_PRICE_LADDER, premium: true })
  checkEqual("다-28 프리미엄 사다리는 기울기 근거가 아니다", premiumLadder.failure, "premium_excluded")

  // 묶기 자체는 거부가 아니라 분류다 — 호출자가 어느 사다리를 쓸지 고른다.
  const built = buildLadders([...ladderObservations(), premiumPoint, directPoint])
  checkEqual("다-29 묶기는 사다리 3개로 가른다", built.ladders.length, 3)
  checkEqual("다-30 섞였다는 사실을 경고로 담는다", hasCode(built.exclusions, "price_ladder_vendor_mixed"), true)
  const ladderOf = built.ladders.find((l) => l.vendor === "이순신수산")
  checkEqual("다-31 깨끗한 사다리는 4점 그대로다", ladderOf.points.length, 4)
  checkClose("다-32 그 사다리만 적합하면 다시 0.6324", fitSizeElasticity(ladderOf).endToEnd, EXPECT.endToEndExact, 1e-5)

  // 1점은 기울기가 정의되지 않는다 — 엔진 2 가 크기 단가를 올리지 않는 이유.
  const onePoint = fitSizeElasticity({ ...SIZE_PRICE_LADDER, points: [SIZE_PRICE_LADDER.points[0]] })
  checkEqual("다-33 1점이면 거부된다", onePoint.failure, "insufficient_points")

  console.log("")
  console.log(`  크기 전구간 +${(sizeEffect * 100).toFixed(1)}% vs 같은 40미 판매처 폭 +${(vendorSpread * 100).toFixed(1)}% → 노이즈가 신호의 ${(vendorSpread / sizeEffect).toFixed(1)}배`)
  console.log(`  섞어 적합 시도 → failure=${mixed.failure} · 탄력성 ${mixed.elasticity} · 묶음 ${mixed.groupKeys.length}개`)
  console.log(`  판매처 위장 시도 → failure=${lied.failure} · 탄력성 ${lied.elasticity}`)
}

// ── (라) 설계 규칙 검사 ───────────────────────────────────────────────────

function designRuleChecks() {
  console.log("\n[라] 설계 규칙 — 수가 맞는 채로 조용히 틀리지 않는가\n")

  // ── 유통단계 변환 ──────────────────────────────────────────────────────
  checkEqual("라-1 소매→산지 기본 계수는 2.2", RETAIL_TO_FARMGATE_DIVISOR, 2.2)
  checkEqual("라-2 허용 범위는 2.0~2.4", `${RETAIL_TO_FARMGATE_DIVISOR_RANGE.min}~${RETAIL_TO_FARMGATE_DIVISOR_RANGE.max}`, "2~2.4")

  const r2f = retailToFarmgate(28000)
  checkEqual("라-3 변환이 성공한다", r2f.failure, null)
  checkClose("라-4 소매 28,000 → 산지 12,727원", r2f.krwPerKg, 28000 / 2.2, 1e-9)
  checkClose("라-5 폭 하한 11,475원(÷2.44)", r2f.lowKrwPerKg, 28000 / 2.44, 1e-9)
  checkClose("라-6 폭 상한 14,286원(÷1.96)", r2f.highKrwPerKg, 28000 / 1.96, 1e-9)
  checkEqual("라-7 배수가 가정임을 알린다", hasCode(r2f.exclusions, "price_stage_multiplier_assumed"), true)

  // 범위 밖 계수는 끌어당기지 않고 거부한다.
  for (const bad of [1.5, 1.99, 2.41, 3.0, NaN]) {
    const out = retailToFarmgate(28000, { divisor: bad })
    checkEqual(`라-8-${bad} 계수 ${bad} 는 거부된다`, out.failure, "divisor_out_of_range")
    checkEqual(`라-9-${bad} 그때 단가는 null — 클램프하지 않는다`, out.krwPerKg, null)
  }
  for (const good of [2.0, 2.2, 2.4]) {
    const ok = retailToFarmgate(28000, { divisor: good })
    checkEqual(`라-10-${good} 계수 ${good} 는 통과한다`, ok.failure, null)
    checkClose(`라-11-${good} 그 계수로 나눈다`, ok.krwPerKg, 28000 / good, 1e-9)
  }

  // 프리미엄은 변환에서 제외된다.
  const prem = retailToFarmgate(49900, { premium: true })
  checkEqual("라-12 프리미엄 소매가는 변환되지 않는다", prem.failure, "premium_not_convertible")
  checkEqual("라-13 그때 단가는 null", prem.krwPerKg, null)
  const premStage = convertStage(49900, "online_premium", "farmgate")
  checkEqual("라-14 프리미엄 단계도 변환되지 않는다", premStage.failure, "premium_not_convertible")

  // 왕복이 제자리로 돌아온다.
  const round = farmgateToRetail(retailToFarmgate(28000).krwPerKg)
  checkClose("라-15 소매→산지→소매 왕복이 제자리", round.krwPerKg, 28000, 1e-9)

  // 단계 배수가 관측을 재현한다.
  checkClose("라-16 도매 배수 1.19 → 17,000원", stageReferenceKrwPerKg("wholesale"), 17000, 1)
  // 배수는 소수 두 자리로 적혀 있다(34,900/14,286 = 2.44295 → 2.44). 되돌리면
  // 42원 차이가 나는 것이 정상이고, 그 폭을 허용한다 — 배수의 자릿수를 늘려
  // 검증을 통과시키는 쪽이 아니다.
  checkClose("라-17 온라인 소매 폭 하한 1.96 → 28,000원", 14286 * STAGE_MULTIPLIER.online_retail.low, 28000, 50)
  checkClose("라-18 온라인 소매 폭 상한 2.44 → 34,900원", 14286 * STAGE_MULTIPLIER.online_retail.high, 34900, 50)
  const w2f = convertStage(17000, "wholesale", "farmgate")
  checkClose("라-19 도매 17,000 → 산지 14,286원", w2f.krwPerKg, 17000 / 1.19, 1)
  checkEqual("라-20 단계 배수에 폭이 있으면 알린다", hasCode(convertStage(28000, "online_retail", "farmgate").exclusions, "price_stage_multiplier_ranged"), true)

  // ── 냉동 계수로 활 단가를 계산할 수 있는가 ────────────────────────────
  const frozenOnLive = estimateSizePrice(FARM_PRICE_ANCHOR, 31.6, { elasticity: FROZEN_SIZE_ELASTICITY })
  checkEqual("라-21 냉동 계수로 활 단가 계산은 거부된다", frozenOnLive.failure, "elasticity_form_mismatch")
  checkEqual("라-22 그때 단가는 null", frozenOnLive.krwPerKg, null)
  checkEqual("라-23 밴드도 null", frozenOnLive.bandKrwPerKg, null)
  checkEqual("라-24 냉동 계수는 0.19 · 등급 C", `${FROZEN_SIZE_ELASTICITY.value}/${FROZEN_SIZE_ELASTICITY.grade}`, "0.19/C")

  // 역방향도 막힌다 — 활 계수로 냉동 단가.
  const liveOnFrozen = estimateSizePrice(
    { ...FARM_PRICE_ANCHOR, form: "frozen", krwPerKg: 7727 },
    31.6,
  )
  checkEqual("라-25 활 계수로 냉동 단가 계산도 거부된다", liveOnFrozen.failure, "elasticity_form_mismatch")

  // 냉동 사다리에서 기울기를 뽑는 것 자체가 막힌다.
  const frozenLadder = fitSizeElasticity({ ...SIZE_PRICE_LADDER, form: "frozen" })
  checkEqual("라-26 냉동 사다리 적합은 거부된다", frozenLadder.failure, "form_not_slope_eligible")
  checkEqual("라-27 선어 사다리도 거부된다", fitSizeElasticity({ ...SIZE_PRICE_LADDER, form: "chilled" }).failure, "form_not_slope_eligible")
  // 생물은 활과 같은 묶음이라 통과한다 — 상품 표기가 「생물·활」 하나다.
  checkEqual("라-28 생물 사다리는 통과한다", fitSizeElasticity({ ...SIZE_PRICE_LADDER, form: "fresh" }).failure, null)
  checkEqual("라-29 활 계수를 생물 앵커에 쓸 수 있다", estimateSizePrice({ ...FARM_PRICE_ANCHOR, form: "fresh" }, 31.6).failure, null)
  checkEqual("라-30 상태가 결과에 담긴다", estimateSizePrice(FARM_PRICE_ANCHOR, 31.6).form, "live")

  // ── 계절항 ─────────────────────────────────────────────────────────────
  const e = estimateSizePrice(FARM_PRICE_ANCHOR, 31.6)
  checkEqual("라-31 계절 보정 계수는 1(= 보정 없음)", SEASONAL_ADJUSTMENT.factor, 1)
  checkEqual("라-32 계절 모델이 없다고 적혀 있다", SEASONAL_ADJUSTMENT.modeled, false)
  checkEqual("라-33 계절 근거 등급은 C", SEASONAL_ADJUSTMENT.grade, "C")
  checkEqual("라-34 반환값에 계절이 드러난다 — factor 1", e.seasonal.factor, 1)
  checkEqual("라-35 반환값에 modeled false 가 드러난다", e.seasonal.modeled, false)
  checkEqual("라-36 미반영을 경고로 알린다", hasCode(e.exclusions, "price_seasonality_not_modeled"), true)
  checkEqual("라-37 보정량 0 을 수량으로 담는다", findCode(e.exclusions, "price_seasonality_not_modeled").quantity, 0)
  // 9월·10월·12월에 달라지지 않는다 — **달·날짜를 받는 경로가 아예 없다.**
  // 필수 인자는 앵커와 목표 ABW 둘뿐이고, 선택 인자(EstimateOptions)에는
  // elasticity 하나만 있다. 받아 놓고 무시하면 호출자는 보정이 들어간 줄 안다.
  checkEqual("라-38 필수 인자는 앵커·목표 둘뿐이다", estimateSizePrice.length, 2)
  checkClose("라-39 그래서 어느 달이든 같은 수다", estimateSizePrice(FARM_PRICE_ANCHOR, 31.6).krwPerKg, e.krwPerKg, 0)

  // ── 0 으로 채우지 않는가 ───────────────────────────────────────────────
  const twoPoint = fitSizeElasticity({ ...SIZE_PRICE_LADDER, points: SIZE_PRICE_LADDER.points.slice(0, 2) })
  checkEqual("라-40 구간 1개면 단조성 판정 불가 — false 가 아니라 null", twoPoint.segmentsMonotoneIncreasing, null)
  checkEqual("라-41 그때도 탄력성은 나온다", twoPoint.failure, null)
  checkEqual("라-42 단조성 미판정이면 크기의존 경고를 올리지 않는다", hasCode(twoPoint.exclusions, "price_elasticity_size_dependent"), false)
  checkEqual("라-43 거부된 변환은 원값을 돌려주지 않는다", retailToFarmgate(28000, { divisor: 9 }).krwPerKg, null)
  checkEqual("라-44 깨진 앵커는 null 로 나온다", estimateSizePrice({ ...FARM_PRICE_ANCHOR, krwPerKg: NaN }, 31.6).krwPerKg, null)
  checkEqual("라-45 깨진 목표도 null 로 나온다", estimateSizePrice(FARM_PRICE_ANCHOR, 0).failure, "target_invalid")

  // ── 반올림하지 않는가 ──────────────────────────────────────────────────
  check("라-46 반올림하지 않는다", e.krwPerKg !== Math.round(e.krwPerKg), String(e.krwPerKg))

  // ── 엔진 2 의 어휘를 쓰는가 ────────────────────────────────────────────
  const units = new Set(e.exclusions.map((x) => x.unit))
  const engine2Units = new Set(["krw", "krw_per_kg", "kg", "count", "month", "day", "gram", "ratio", null])
  checkEqual("라-47 새 단위를 만들지 않았다", [...units].every((u) => engine2Units.has(u)), true)
  checkEqual(
    "라-48 경고는 {code, quantity, unit} 모양이다",
    e.exclusions.every((x) => "code" in x && "quantity" in x && "unit" in x),
    true,
  )
  checkEqual("라-49 문장을 만들지 않는다", e.exclusions.every((x) => !("message" in x) && !("text" in x)), true)

  console.log("")
  console.log(`  소매 28,000 → 산지 ${krw(r2f.krwPerKg)}원 (폭 ${krw(r2f.lowKrwPerKg)}~${krw(r2f.highKrwPerKg)})`)
  console.log(`  단계 배수: ${Object.entries(STAGE_MULTIPLIER).map(([k, v]) => `${k} ${v.low === v.high ? v.point : `${v.low}~${v.high}`}`).join(" · ")}`)
  console.log(`  냉동 계수(0.19)로 활 단가 → failure=${frozenOnLive.failure} · 단가 ${frozenOnLive.krwPerKg}`)
  console.log(`  계절: factor ${e.seasonal.factor} · modeled ${e.seasonal.modeled} · 등급 ${e.seasonal.grade}`)
  console.log(`  31.6g 추정 경고 ${e.exclusions.length}건 — ${e.exclusions.map((x) => x.code).join(", ")}`)
}

// ── 실행 ─────────────────────────────────────────────────────────────────

console.log("=".repeat(84))
console.log("크기별 단가 모델 자체검증 — lib/pricing")
console.log("=".repeat(84))

ladderChecks()
anchorChecks()
mixingChecks()
designRuleChecks()

console.log("\n" + "=".repeat(84))
if (fails.length === 0) {
  console.log(`전부 통과 — ${checks}항목`)
} else {
  console.log(`실패 ${fails.length}/${checks}항목`)
  for (const f of fails) console.log(`  · ${f}`)
}
console.log("=".repeat(84))
process.exit(fails.length === 0 ? 0 : 1)
