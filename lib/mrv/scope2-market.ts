/**
 * Scope 2 **market-based** 산정 — 계약으로 확보한 전력에 그 계약의 배출계수를 쓴다.
 *
 * ── 왜 산식 모듈 바깥인가 ──────────────────────────────────────────────────
 * `lib/mrv/kpi/scope2.ts` 는 원본 Python(`culiver_kpi/mrv.py`)과 차분 검증으로 묶여 있고,
 * 원본에는 market-based 개념이 없다. 거기에 넣으면 차분이 깨지거나(원본에 없는 분기)
 * 원본을 함께 고쳐야 하는데, market-based 는 **산식이 아니라 배분 규칙**이다 —
 * location-based 결과를 받아 "그중 얼마가 계약 전력인가" 로 다시 나눈다. 그래서 경계
 * 바깥에 둔다(AGENTS.md 절대규칙 1 은 산식 중복을 금하는 것이고, 이 모듈은 Scope 2
 * 산식을 다시 쓰지 않는다).
 *
 * ── 두 방식은 함께 보고한다 ────────────────────────────────────────────────
 * GHG Protocol Scope 2 Guidance 는 둘 중 하나를 고르라고 하지 않고 **둘 다 보고(dual
 * reporting)** 하라고 한다. 그래서 이 모듈은 location-based 를 대체하지 않고 **옆에**
 * 붙는다. 리포트는 두 숫자를 나란히 인쇄한다.
 *
 * ── 한국에는 공표된 residual mix 가 없다 (중요) ────────────────────────────
 * market-based 의 정석은 계약 전력을 뺀 **잔여 전력**에 residual mix(계약 전력이 빠진
 * 뒤의 계통 평균 — 이중계산을 막으려고 계통 계수보다 높게 나온다)를 쓰는 것이다. 한국은
 * 그 값을 공표하지 않는다.
 *
 * 그래서 이 구현은 잔여분에 **location-based 계수를 그대로** 쓰고, 그 대체를 결과에
 * 명시해 리포트가 인쇄하게 한다. 숨기고 쓰면 그 자체가 과소 산정이다 — 잔여 전력의
 * 실제 배출은 계통 평균보다 높을 가능성이 크므로, 이 구현의 market-based 값은
 * **보수적이지 않은(낮게 나올 수 있는)** 추정이다. 그 사실을 적지 않는 것이 가장 나쁘다.
 *
 * ── 겹치는 기간만 센다 ─────────────────────────────────────────────────────
 * 증서는 자기 유효기간을 들고 있다. 리포트 기간과 겹치는 만큼만 쓴다. 겹침 비율은
 * **시간 비례**로 자른다(증서가 연 단위로 발급되고 리포트는 월 단위인 경우가 흔하다).
 * 더 정확히 하려면 증서에 월별 배분표가 있어야 하는데, 지금 스키마는 그것을 받지 않는다 —
 * 받지 않는 것을 추정으로 메우지 않고, 비례 배분을 썼다는 사실을 결과에 적는다.
 */

/** 증서 한 건(DB 행의 투영). */
export type ContractualInstrument = {
  readonly id: string
  readonly kind: "rec" | "ppa" | "green_premium"
  readonly mwh: number
  readonly factor_tco2e_per_mwh: number
  readonly period_start: string
  readonly period_end: string
  readonly document_name: string | null
  readonly certificate_id: string | null
}

export const INSTRUMENT_KIND_LABELS: Record<ContractualInstrument["kind"], string> = {
  rec: "REC(재생에너지 공급인증서)",
  ppa: "PPA(전력구매계약)",
  green_premium: "녹색프리미엄",
}

/** 한 증서가 이번 기간에 얼마를 덮는가. */
export type AppliedInstrument = {
  readonly id: string
  readonly kind: ContractualInstrument["kind"]
  readonly label: string
  /** 증서 전체 전력량(MWh) */
  readonly totalMwh: number
  /** 이번 기간에 실제로 적용된 전력량(MWh) — 겹침 비례 배분 후, 소비량 상한 적용 후 */
  readonly appliedMwh: number
  readonly factorTco2ePerMwh: number
  readonly tco2e: number
  /** 기간이 겹친 비율(0~1). 1 이면 증서 기간이 리포트 기간을 모두 덮는다. */
  readonly overlapRatio: number
  readonly documentName: string | null
  readonly certificateId: string | null
}

export type Scope2MarketResult = {
  /** 이번 기간 총 전력(MWh) */
  readonly totalMwh: number
  /** 계약으로 덮인 전력(MWh) */
  readonly contractualMwh: number
  /** 계약으로 덮이지 않은 잔여 전력(MWh) */
  readonly residualMwh: number
  /** 계약 전력에서 나온 배출(tCO2e) */
  readonly contractualTco2e: number
  /** 잔여 전력에서 나온 배출(tCO2e) */
  readonly residualTco2e: number
  /** market-based 총 배출(tCO2e) */
  readonly marketBasedTco2e: number
  /** location-based 총 배출(tCO2e) — 나란히 보고하려고 함께 담는다 */
  readonly locationBasedTco2e: number
  readonly applied: readonly AppliedInstrument[]
  /** 증서가 소비량보다 많아 잘린 전력량(MWh). 0 보다 크면 리포트가 그 사실을 적는다. */
  readonly oversuppliedMwh: number
  /** 리포트에 그대로 인쇄되는 산식 전문(대입값 포함). */
  readonly formulaText: string
  /** 반드시 함께 인쇄해야 하는 한계. 비어 있지 않다. */
  readonly caveats: readonly string[]
}

function overlapMs(aFrom: Date, aTo: Date, bFrom: Date, bTo: Date): number {
  const from = Math.max(aFrom.getTime(), bFrom.getTime())
  const to = Math.min(aTo.getTime(), bTo.getTime())
  return Math.max(0, to - from)
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * market-based Scope 2 를 산출한다.
 *
 * 순수 함수다 — 같은 입력에 같은 출력(AGENTS.md 절대규칙 6). `now()` 도 난수도 쓰지 않는다.
 *
 * @param totalMwh 이번 기간 총 전력(MWh). location-based 와 **같은 값**을 쓴다.
 * @param locationFactor 계통 평균 배출계수(tCO2e/MWh). 잔여분에도 이 값을 쓴다(위 머리말).
 */
export function computeScope2MarketBased(params: {
  totalMwh: number
  locationFactor: number
  periodFrom: Date
  periodTo: Date
  instruments: readonly ContractualInstrument[]
}): Scope2MarketResult {
  const { totalMwh, locationFactor, periodFrom, periodTo, instruments } = params
  const locationBasedTco2e = r3(totalMwh * locationFactor)

  // 증서를 **배출계수가 낮은 순**으로 적용한다. 소비량보다 증서가 많을 때 어느 것을 쓸지
  // 정하는 규칙이 없으면 결과가 입력 순서에 좌우되어 결정론이 깨진다. 같은 계수면
  // id 오름차순으로 가른다.
  const sorted = [...instruments].sort(
    (a, b) =>
      a.factor_tco2e_per_mwh - b.factor_tco2e_per_mwh || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )

  const applied: AppliedInstrument[] = []
  let remaining = totalMwh
  let oversuppliedMwh = 0

  for (const inst of sorted) {
    const from = new Date(inst.period_start)
    const to = new Date(inst.period_end)
    const ratio = overlapMs(from, to, periodFrom, periodTo) / Math.max(1, to.getTime() - from.getTime())
    if (ratio <= 0) continue

    const available = inst.mwh * ratio
    const used = Math.min(available, Math.max(0, remaining))
    oversuppliedMwh += available - used
    remaining -= used
    if (used <= 0) {
      // 소비량을 이미 다 덮었다. 남은 증서는 적용되지 않지만 버려졌다는 사실은 센다.
      continue
    }

    applied.push({
      id: inst.id,
      kind: inst.kind,
      label: INSTRUMENT_KIND_LABELS[inst.kind],
      totalMwh: inst.mwh,
      appliedMwh: r3(used),
      factorTco2ePerMwh: inst.factor_tco2e_per_mwh,
      tco2e: r3(used * inst.factor_tco2e_per_mwh),
      overlapRatio: r3(ratio),
      documentName: inst.document_name,
      certificateId: inst.certificate_id,
    })
  }

  const contractualMwh = r3(applied.reduce((a, x) => a + x.appliedMwh, 0))
  const residualMwh = r3(Math.max(0, totalMwh - contractualMwh))
  const contractualTco2e = r3(applied.reduce((a, x) => a + x.tco2e, 0))
  const residualTco2e = r3(residualMwh * locationFactor)
  const marketBasedTco2e = r3(contractualTco2e + residualTco2e)

  const caveats: string[] = [
    "한국에는 공표된 residual mix 가 없어, 계약으로 덮이지 않은 잔여 전력에 " +
      `location-based 계통 계수(${locationFactor} tCO2e/MWh)를 그대로 적용했습니다. ` +
      "잔여 전력의 실제 배출은 계통 평균보다 높을 수 있으므로 이 값은 과소 산정일 수 " +
      "있습니다.",
    "증서는 유효기간과 리포트 기간이 겹치는 만큼 **시간 비례**로 배분했습니다. " +
      "월별 배분표가 있는 증서라면 실제 배분과 다를 수 있습니다.",
  ]
  if (applied.length === 0) {
    caveats.push(
      "이 기간에 적용된 계약 증서가 없습니다 — market-based 값이 location-based 와 같습니다.",
    )
  }
  if (oversuppliedMwh > 0) {
    caveats.push(
      `증서 ${r3(oversuppliedMwh)} MWh 는 이 기간 소비량을 넘어 적용되지 않았습니다 ` +
        "(소비하지 않은 전력에 증서를 쓸 수 없습니다).",
    )
  }

  const lines = [
    "Scope 2 market-based",
    `  총 전력 ${r3(totalMwh)} MWh = 계약 ${contractualMwh} MWh + 잔여 ${residualMwh} MWh`,
    ...applied.map(
      (a) =>
        `  계약 ${a.label} ${a.appliedMwh} MWh × ${a.factorTco2ePerMwh} tCO2e/MWh = ` +
        `${a.tco2e} tCO2e` +
        (a.overlapRatio < 1 ? ` (증서 ${a.totalMwh} MWh 중 기간 겹침 ${a.overlapRatio})` : "") +
        (a.certificateId ? ` [증서번호 ${a.certificateId}]` : ""),
    ),
    `  잔여 ${residualMwh} MWh × ${locationFactor} tCO2e/MWh = ${residualTco2e} tCO2e` +
      "  ※ residual mix 미공표로 계통 계수 대체",
    `  market-based 합계 = ${marketBasedTco2e} tCO2e`,
    `  location-based 대조 = ${r3(totalMwh)} MWh × ${locationFactor} = ${locationBasedTco2e} tCO2e`,
  ]

  return {
    totalMwh: r3(totalMwh),
    contractualMwh,
    residualMwh,
    contractualTco2e,
    residualTco2e,
    marketBasedTco2e,
    locationBasedTco2e,
    applied,
    oversuppliedMwh: r3(oversuppliedMwh),
    formulaText: lines.join("\n"),
    caveats,
  }
}
