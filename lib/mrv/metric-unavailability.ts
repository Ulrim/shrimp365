/**
 * 「산출 불가」의 사유 — 엔진이 돌려준 근거에서 **확정**한다.
 *
 * ── 왜 이 파일이 따로 있는가 ─────────────────────────────────────────────────
 * KPI 카드는 값이 null 인 지표 넷에 같은 한 줄을 적고 있었다.
 *
 *   "해당 기간에 산출 조건을 만족하지 못했습니다(예: 생산량 변화 부족)."
 *
 * 「예:」 는 추측이다. EI·폭기 EI·FCR·OEI 는 각각 **다른 조건**에서 null 이 되는데 그
 * 한 줄은 넷을 구분하지 못하고, 그래서 운영자는 **무엇을 넣어야 이 칸이 채워지는지**
 * 알 수 없다. null 을 null 로 남기는 것까지는 옳지만, 왜인지를 말하지 않으면 그 null 은
 * 「데이터가 없다」 와 「조건을 못 채웠다」 와 「정의가 미확정이다」 를 구분하지 못한다.
 *
 * 사용자가 준 MRV 계산표는 정확히 그 반대로 적는다 — 지표마다 왜 못 냈는지를 따로 쓴다
 * (EI_산정상태 · FCR_산정상태 · OEI_산정상태 · 폐사율_산정상태 · 감축량_산정상태).
 * 이 모듈이 그 자리다.
 *
 * ── 엔진을 고치지 않는다 ────────────────────────────────────────────────────
 * `lib/mrv/kpi/` 는 원본 Python 과 차분검증되는 디렉터리라 **읽기만 한다.** 그리고
 * 고칠 필요가 없다 — 엔진 결과가 이미 근거를 들고 있다. `EiResult` 는
 * `biomassDeltaKg`·`includedReadingCount`·`aerationPowerKwh` 를 돌려주고 설정에는
 * `ei.min_biomass_delta_kg` 가 있다. 그 둘을 보면 왜 null 인지 **확정적으로** 말할 수
 * 있다. `lib/mrv/baseline-readiness.ts` 가 이미 그 방식이고("EI(임계값 N kg)"), 이
 * 모듈은 그 선례를 지표 5종 전부로 넓힌다.
 *
 * ★ 이 모듈은 **순수 모듈**로 유지할 것. KPI 카드·비교표·멀티사이트 표·리포트 화면
 *   (모두 `"use client"`)과 인쇄 리포트 렌더러가 같이 import 한다 — `next/server` 나
 *   DB 를 끌고 들어오면 클라이언트 번들이 깨진다. `lib/mrv/metric-provenance.ts` ·
 *   `lib/mrv/quality-flags.ts` · `lib/mrv/measurement-basis.ts` 가 같은 이유로 있는
 *   모듈이고, 아래 import 는 그 셋과 같은 범위(순수 상수·순수 파서)다.
 *
 * ── 지키는 네 가지 ──────────────────────────────────────────────────────────
 *  ① 추측하지 않는다. 「예:」 같은 말을 쓰지 않는다. 근거로 확정할 수 없으면
 *     `kind: "unknown"` 으로 **확정할 수 없다고 적는다.**
 *  ② 숫자를 함께 적는다. "생산량 변화가 부족합니다" 보다 "생산량 변화 0.00 kg
 *     (임계값 1.00 kg)" 가 운영자에게 무엇을 해야 하는지 알려 준다.
 *  ③ 사유는 **여러 개 겹칠 수 있다**(전력도 없고 생산량도 없는 기간). 하나만 적고
 *     끝내지 않는다 — 하나 고쳤는데 여전히 산출 불가면 운영자는 두 번 헛걸음한다.
 *  ④ **무엇을 하면 채워지는지**까지 적는다(`action`). 사유만 적는 것과 "입력 화면의
 *     전력 구역에서 넣으세요" 를 적는 것은 다르다.
 *
 * ── 임계값을 문장에 박지 않는다 ─────────────────────────────────────────────
 * 임계값은 조직의 활성 `kpi_config` 가 덮을 수 있다. 그래서 상수로 적지 않고
 * `MetricUnavailabilityEvidence` 에 **그때그때 읽어 실어 보낸** 값을 쓴다
 * (`buildMetricUnavailabilityEvidence` 가 산출에 실제로 쓰인 설정에서 읽는다).
 * 실려 오지 않은 임계값은 **없는 대로 둔다** — 0 으로 가정하면 `min_biomass_delta_kg`
 * 가 0 이 아닌 조직에 거짓 사유를 적게 된다.
 *
 * ── 「산출 불가」와 「잠정 지표」는 다른 층이다 ──────────────────────────────
 * OEI 는 두 사실이 겹치는 자리다. (1) 이 기간에 산출 불가인가 — 입력의 문제다.
 * (2) 산식이 확정됐는가 — 정의의 문제다(`lib/mrv/metric-provenance.ts`). 둘을 같은
 * 문단에 섞으면 "입력을 채우면 산식도 확정된다" 로 읽힌다. 그래서 이 모듈은 (1)만
 * 적고, 두 문장이 한 자리에 함께 뜰 때 쓰는 연결 문장 하나
 * (`unavailabilityVsProvisionalNote`)를 따로 둔다.
 */

import { isProvisionalMetric } from "./metric-provenance"
import type { KpiMetricKey } from "./api-types"

// ---------------------------------------------------------------------------
// 근거 — 엔진이 이미 들고 있는 수를 그대로 실어 보낸다
// ---------------------------------------------------------------------------

/**
 * 사유를 확정하는 데 쓰는 근거 수치. **API 응답과 리포트에 실리는 전선(wire) 타입**이라
 * 키를 snake_case 로 둔다(이 저장소의 응답 계약과 같은 규약).
 *
 * 모든 칸이 선택이다. 이유는 두 가지다.
 *   · 자리마다 아는 범위가 다르다 — 잠긴 기준선은 스칼라값만 들고 있고, 이 칸을 넣기
 *     전에 발행된 리포트에는 아예 없다.
 *   · **없는 칸을 0 으로 읽으면 거짓 사유가 된다.** `included_reading_count` 가
 *     `undefined` 인 것은 "전력이 0 건" 이 아니라 "건수를 모른다" 다. 그래서 아래
 *     판정은 `undefined`·`null` 을 전부 「모른다」로 다루고 단정하지 않는다
 *     (`measurement_basis` 의 미기재 규약과 같은 태도다).
 */
export interface MetricUnavailabilityEvidence {
  // ── EI · FCR · OEI 의 분모 ──
  /** 기간 생산량 변화(마감 − 개시, kg). 엔진의 `biomassDeltaKg`. */
  biomass_delta_kg?: number | null
  /** 기간 안 생산량(수확·계측) 기록 건수. 0 건 · 1 건 · 2 건 이상이 서로 다른 사유다. */
  biomass_record_count?: number | null
  /** 산출에 실제로 쓰인 임계값 — kpi_config `ei.min_biomass_delta_kg`. */
  ei_min_biomass_delta_kg?: number | null
  /** kpi_config `fcr.min_biomass_delta_kg`. EI 와 다를 수 있어 따로 싣는다. */
  fcr_min_biomass_delta_kg?: number | null
  /** kpi_config `oei.min_biomass_kg`. */
  oei_min_biomass_kg?: number | null

  // ── 전력(EI 의 분자 · OEI 의 분모) ──
  total_power_kwh?: number | null
  /** EI 가 산입한 폭기 전력(kWh). 폭기 EI 의 분자다. */
  aeration_power_kwh?: number | null
  /**
   * OEI 가 산입한 폭기 전력(kWh). **EI 의 것과 따로 싣는다** — 두 지표는 산입 품질
   * 플래그를 각자(`ei.included_quality_flags` · `oei.included_quality_flags`) 들고
   * 있어 같은 기간에도 합이 다를 수 있다. 하나로 뭉개면 "OEI 의 분모가 0 이다" 를 EI
   * 쪽 수로 단정하게 된다(기본 설정에서는 둘이 같지만, 같다는 보장은 설정에 없다).
   */
  oei_aeration_power_kwh?: number | null
  included_reading_count?: number | null
  excluded_reading_count?: number | null

  // ── 급이(FCR 의 분자) ──
  included_feed_count?: number | null
  excluded_feed_count?: number | null

  // ── 폐사율의 분모 ──
  /** 사이트에 등록된 모든 배치의 입식 수 합. 엔진이 기간으로 자르지 않는다. */
  stocked_count?: number | null

  // ── OEI ──
  /** 수조에 DO 목표대역이 설정돼 있는가. false 면 OEI 는 애초에 산출 대상이 아니다. */
  oei_applicable?: boolean | null
  do_total_samples?: number | null
  do_excluded_samples?: number | null
}

// ---------------------------------------------------------------------------
// 사유
// ---------------------------------------------------------------------------

/**
 * 사유의 무게.
 *   - `cause`        : 엔진이 이 조건 때문에 null 을 냈다. 확정이다.
 *   - `also_missing` : null 의 원인은 아니지만 **이것도 비어 있다.** 분모만 채우면 값은
 *                      나오는데 그 값이 0 이 된다 — 그 0 은 실측 0 이 아니다. 하나만
 *                      적으면 운영자가 두 번 헛걸음하므로 함께 적는다.
 *   - `unknown`      : 근거가 실려 있지 않아 확정할 수 없다. **추측하지 않는다.**
 */
export type MetricUnavailabilityReasonKind = "cause" | "also_missing" | "unknown"

export interface MetricUnavailabilityReason {
  /** 기계가 보는 식별자(화면 문구와 독립 — 문구를 다듬어도 검증은 그대로 간다). */
  id: string
  kind: MetricUnavailabilityReasonKind
  /** 사람이 읽는 한 문단. 판정에 쓴 숫자를 그대로 담는다. */
  text: string
  /** 무엇을 하면 채워지는가. 적을 것이 없으면 null(호출부가 그 자리의 안내를 붙인다). */
  action: string | null
}

/**
 * 사유의 무게를 **낱말로** 적는 머리말. 색이 아니라 글자다 — 인쇄물은 흑백 복사가
 * 기본이고, 화면에서도 색만으로는 알리지 않는다는 규칙이다.
 *
 * 화면과 인쇄 리포트가 **같은 표**를 쓴다. 한쪽만 "함께 비어 있음" 을 빼면 인쇄물로 본
 * 사람은 그것을 null 의 원인으로 읽는다 — 그 항목은 원인이 아니다.
 */
export const UNAVAILABILITY_REASON_KIND_PREFIX: Record<
  MetricUnavailabilityReasonKind,
  string
> = {
  cause: "확정 사유 — ",
  also_missing: "함께 비어 있음(이것만으로는 null 이 되지 않습니다) — ",
  unknown: "확정 불가 — ",
}

/** 사유 문장에 쓰는 지표 이름. 카드 제목(METRIC_META)과 달리 문장 안에 들어가는 꼴이다. */
const METRIC_SENTENCE_NAME: Record<KpiMetricKey, string> = {
  ei_total: "EI(전력집약도)",
  ei_aeration: "폭기 EI",
  fcr: "FCR(사료요구율)",
  oei: "OEI(산소효율지수)",
  mortality_rate: "폐사율",
}

/** 분모 임계값이 적힌 kpi_config 의 자리. 문장에 경로를 적어 고칠 곳을 알려 준다. */
const BIOMASS_THRESHOLD_PARAM_PATH: Record<"ei_total" | "ei_aeration" | "fcr" | "oei", string> = {
  ei_total: "ei.min_biomass_delta_kg",
  ei_aeration: "ei.min_biomass_delta_kg",
  fcr: "fcr.min_biomass_delta_kg",
  oei: "oei.min_biomass_kg",
}

/** 숫자로 읽을 수 있는 값인가. `undefined`·`null`·NaN 은 전부 「모른다」다. */
function known(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function kg(value: number): string {
  return `${value.toFixed(2)} kg`
}

function count(value: number | null | undefined): string {
  return known(value) ? `${value}건` : "모름"
}

/**
 * 생산량(Δbiomass) 쪽 사유. EI·폭기 EI·FCR·OEI 가 **같은 분모**를 쓰므로 한곳에서 만든다.
 * 임계값만 지표별로 다르다(각자 자기 설정을 들고 있다).
 */
function biomassReason(
  metricKey: "ei_total" | "ei_aeration" | "fcr" | "oei",
  evidence: MetricUnavailabilityEvidence,
  minThreshold: number | null | undefined,
): MetricUnavailabilityReason | null {
  const name = METRIC_SENTENCE_NAME[metricKey]
  const path = BIOMASS_THRESHOLD_PARAM_PATH[metricKey]
  const delta = evidence.biomass_delta_kg
  const records = evidence.biomass_record_count

  const harvestAction =
    "생산량은 수확·계측 기록(mrv_harvest_logs)의 기간 양 끝 생체량 차이로 정의됩니다. " +
    "이 플랫폼에는 아직 생산량 입력 화면이 없으므로, 관리자에게 그 기록의 등록을 " +
    "요청하거나 기록이 들어 있는 기간으로 다시 조회하십시오."

  // ① 기록이 아예 없다. 임계값을 몰라도 확정할 수 있다 — 분모를 만들 재료가 없다.
  if (known(records) && records === 0) {
    return {
      id: "biomass_no_record",
      kind: "cause",
      text:
        `이 기간에 생산량 기록이 한 건도 없습니다 — ${name} 의 분모인 생산량 변화` +
        "(Δbiomass)를 만들 재료가 없습니다.",
      action: harvestAction,
    }
  }

  // ② 기록이 한 건뿐이다. 개시와 마감이 같은 기록이라 변화가 0 으로 잡힌다.
  if (known(records) && records === 1) {
    return {
      id: "biomass_single_record",
      kind: "cause",
      text:
        `이 기간의 생산량 기록이 한 건뿐입니다 — 개시와 마감이 같은 기록이라 생산량 변화가 ` +
        `${known(delta) ? kg(delta) : "0.00 kg"} 로 잡히고, ${name} 의 분모가 되지 못합니다.`,
      action:
        "기간 양 끝에 각각 생체량 기록이 있어야 차이를 낼 수 있습니다. 기간을 넓혀 다시 " +
        `조회하거나 마감 시점의 기록을 등록하십시오. ${harvestAction}`,
    }
  }

  if (!known(delta)) return null

  // ③ 임계값을 모르면 **단정하지 않는다.** 숫자는 그대로 적는다 — 운영자가 볼 수 있는
  //    사실이 "변화량이 이만큼" 인 것까지는 참이다.
  if (!known(minThreshold)) {
    return {
      id: "biomass_delta_threshold_unknown",
      kind: "unknown",
      text:
        `이 기간의 생산량 변화는 ${kg(delta)} 입니다. 이 값이 ${name} 의 산출 임계값 ` +
        `이하이면 산출되지 않는데, 그 임계값(kpi_config ${path})이 여기 실린 자료에 없어 ` +
        "사유로 단정하지 않습니다.",
      action: null,
    }
  }

  if (delta > minThreshold) return null

  // ④ 감소와 정체를 가른다. 운영자가 할 일이 다르다 — 감소는 중간 수확을 확인할 일이고,
  //    정체는 마감 기록을 넣거나 기간을 넓힐 일이다.
  if (delta < 0) {
    return {
      id: "biomass_delta_negative",
      kind: "cause",
      text:
        `이 기간에 생산량이 ${kg(delta)} 만큼 줄었습니다(마감 생체량이 개시보다 작습니다). ` +
        `${name} 은 분모가 양수여야 산출되며, 적용 중인 산출 임계값은 ` +
        `${kg(minThreshold)} 입니다.`,
      action:
        "기간 안에 중간 수확이 있었는지, 기간 양 끝의 생체량 기록이 뒤바뀌지 않았는지 " +
        `확인하십시오. 임계값은 적용 중인 kpi_config 의 ${path} 입니다.`,
    }
  }

  return {
    id: "biomass_delta_below_threshold",
    kind: "cause",
    text:
      `이 기간의 생산량 변화가 ${kg(delta)} 로 ${name} 의 산출 임계값 ` +
      `${kg(minThreshold)} 이하입니다 — 분모가 되지 못합니다` +
      `${known(records) ? ` (기간 안 생산량 기록 ${records}건)` : ""}.`,
    action:
      "기간 양 끝의 생체량 기록을 확인하거나 기간을 다시 고르십시오. 임계값은 적용 중인 " +
      `kpi_config 의 ${path} 입니다.`,
  }
}

/** 전력 근거가 비어 있다는 사실. EI 의 분자이고 OEI 의 분모다. */
function noPowerReadingsReason(
  evidence: MetricUnavailabilityEvidence,
  kind: MetricUnavailabilityReasonKind,
  tail: string,
): MetricUnavailabilityReason | null {
  if (!known(evidence.included_reading_count) || evidence.included_reading_count !== 0) {
    return null
  }
  const excluded = evidence.excluded_reading_count
  return {
    id: "power_readings_none",
    kind,
    text:
      `이 기간에 산입된 전력 계측값이 0 건입니다(제외 ${count(excluded)}). ${tail}`,
    action:
      "입력 화면의 「전력 입력 (구간 사용량)」 구역에서 넣거나 전력 기록지 CSV 를 " +
      "올리십시오. 제외된 건이 있다면 그 계측값의 품질 플래그(quality_flag)가 산입 " +
      "목록(kpi_config ei.included_quality_flags)에 드는지도 함께 확인하십시오.",
  }
}

/**
 * 폭기 전력이 0 kWh 라는 사실. 폭기 EI 에는 「함께 비어 있음」, OEI 에는 확정 사유다.
 * 값은 호출부가 고른다 — 두 지표의 산입 합이 다를 수 있다(위 evidence 주석 참고).
 */
function aerationPowerZeroReason(
  aerationPowerKwh: number | null | undefined,
  kind: MetricUnavailabilityReasonKind,
  tail: string,
): MetricUnavailabilityReason | null {
  if (!known(aerationPowerKwh) || aerationPowerKwh !== 0) return null
  return {
    id: "aeration_power_zero",
    kind,
    text:
      "폭기 전력이 0 kWh 입니다 — 폭기로 표시된(is_aeration) 계측기의 계측값이 이 기간에 " +
      `하나도 산입되지 않았습니다. ${tail}`,
    action:
      "설정에서 계측기의 폭기 여부(is_aeration)를 확인하고, 폭기 계측기의 구간 사용량을 " +
      "입력 화면의 전력 구역에서 넣으십시오.",
  }
}

/**
 * 지표 하나의 「산출 불가」 사유 전부.
 *
 * **값이 null 인 지표에만 쓴다.** 값이 있는 지표에 부르면 분모는 임계값을 넘었으므로
 * 생산량 사유는 나오지 않지만, 「함께 비어 있음」 항목은 나올 수 있다(값이 0 인 경우가
 * 바로 그 자리다) — 그 판단은 호출부가 한다.
 *
 * 돌려주는 배열이 비는 일은 없다. 근거로 아무것도 확정할 수 없으면 `unknown` 한 건을
 * 담아 **모른다고 말한다.**
 */
export function metricUnavailabilityReasons(
  metricKey: KpiMetricKey,
  evidence: MetricUnavailabilityEvidence | null | undefined,
): MetricUnavailabilityReason[] {
  if (evidence === null || evidence === undefined) {
    return [evidenceMissingReason()]
  }

  const reasons: MetricUnavailabilityReason[] = []
  const push = (r: MetricUnavailabilityReason | null) => {
    if (r !== null) reasons.push(r)
  }

  switch (metricKey) {
    case "ei_total": {
      push(biomassReason("ei_total", evidence, evidence.ei_min_biomass_delta_kg))
      push(
        noPowerReadingsReason(
          evidence,
          "also_missing",
          "분모가 채워져도 총 전력이 0 kWh 이므로 EI 는 0 kWh/kg 으로 나옵니다 — 그 0 은 " +
            "실측 0 이 아닙니다.",
        ),
      )
      break
    }
    case "ei_aeration": {
      push(biomassReason("ei_aeration", evidence, evidence.ei_min_biomass_delta_kg))
      // 전력이 한 건도 없으면 폭기 전력이 0 인 것은 그 사실의 **결과**다. 둘을 따로
      // 적으면 같은 할 일(전력 입력)이 두 번 뜨고, 운영자는 두 가지를 손대야 하는
      // 것으로 읽는다 — 그래서 한 문장이 둘을 함께 말한다. 겹치는 사유를 전부 적는
      // 규칙은 **독립된** 사유에 대한 것이다.
      if (known(evidence.included_reading_count) && evidence.included_reading_count === 0) {
        push(
          noPowerReadingsReason(
            evidence,
            "also_missing",
            "폭기 계측값도 이 안에 들어 있으므로 폭기 전력도 0 kWh 이고, 분모가 채워져도 " +
              "폭기 EI 는 0 kWh/kg 으로 나옵니다 — 그 0 은 실측 0 이 아닙니다.",
          ),
        )
      } else {
        push(
          aerationPowerZeroReason(
            evidence.aeration_power_kwh,
            "also_missing",
            "전력 계측값 자체는 산입돼 있으므로, 폭기로 표시된 계측기가 없거나 그 계측기의 " +
              "값이 이 기간에 들어오지 않은 것입니다. 분모가 채워져도 폭기 EI 는 " +
              "0 kWh/kg 으로 나옵니다 — 그 0 은 실측 0 이 아닙니다.",
          ),
        )
      }
      break
    }
    case "fcr": {
      push(biomassReason("fcr", evidence, evidence.fcr_min_biomass_delta_kg))
      if (known(evidence.included_feed_count) && evidence.included_feed_count === 0) {
        reasons.push({
          id: "feed_logs_none",
          kind: "also_missing",
          text:
            `이 기간에 산입된 급이 기록이 0 건입니다(제외 ${count(evidence.excluded_feed_count)}). ` +
            "분모가 채워져도 총 급이량이 0 kg 이므로 FCR 은 0 kg/kg 으로 나옵니다 — 그 0 은 " +
            "실측 0 이 아닙니다.",
          action:
            "입력 화면의 「급이 입력」 구역에서 넣거나 급이 기록지 CSV 를 올리십시오. " +
            "제외된 건이 있다면 그 기록의 품질 플래그(quality_flag)가 산입 목록" +
            "(kpi_config fcr.included_quality_flags)에 드는지도 함께 확인하십시오.",
        })
      }
      break
    }
    case "oei": {
      // DO 목표대역이 없으면 OEI 는 **애초에 산출 대상이 아니다.** 그때는 기간의 입력을
      // 따지는 다른 사유를 함께 적지 않는다 — 입력을 채워도 대역이 없으면 나오지 않고,
      // 운영자가 엉뚱한 곳을 먼저 손대게 된다.
      if (evidence.oei_applicable === false) {
        reasons.push({
          id: "oei_not_applicable",
          kind: "cause",
          text:
            "이 사이트의 수조에 DO 목표대역(target_do_min / target_do_max)이 설정되어 있지 " +
            "않아 OEI 는 산출 대상이 아닙니다 — 이 기간의 입력이 모자란 것이 아니라 " +
            "기준이 되는 대역이 없습니다.",
          action:
            "수조의 DO 목표대역이 등록돼야 산출됩니다. 이 플랫폼에는 아직 그 설정 화면이 " +
            "없으므로, 관리자에게 수조(mrv_tanks)의 target_do_min · target_do_max 등록을 " +
            "요청하십시오.",
        })
        break
      }
      if (known(evidence.do_total_samples) && evidence.do_total_samples === 0) {
        reasons.push({
          id: "do_samples_none",
          kind: "cause",
          text:
            `이 기간에 산입된 DO 계측값이 0 건입니다(제외 ${count(evidence.do_excluded_samples)}) — ` +
            "OEI 의 분자인 DO 목표대역 유지율을 낼 수 없습니다.",
          action:
            "이 사이트에 DO 계측기가 등록돼 있는지(온보딩의 센서 매핑), 그 계측값이 이 " +
            "기간에 들어와 있는지 확인하십시오.",
        })
      }
      push(
        aerationPowerZeroReason(
          evidence.oei_aeration_power_kwh,
          "cause",
          "OEI 의 분모인 「생산 kg당 폭기 전력」 이 정의되지 않습니다.",
        ),
      )
      push(biomassReason("oei", evidence, evidence.oei_min_biomass_kg))
      break
    }
    case "mortality_rate": {
      if (known(evidence.stocked_count) && evidence.stocked_count <= 0) {
        reasons.push({
          id: "stocked_count_zero",
          kind: "cause",
          text:
            `등록된 입식 수가 ${evidence.stocked_count.toLocaleString("ko-KR")}마리입니다 — ` +
            "폐사율의 분모입니다. 이 수는 이 사이트에 등록된 모든 배치의 합이며 조회 " +
            "기간으로 잘리지 않으므로, 기간을 바꿔도 달라지지 않습니다.",
          action:
            "배치(mrv_batches)의 입식 수가 등록돼야 산출됩니다. 이 플랫폼에는 아직 배치 " +
            "등록 화면이 없으므로, 관리자에게 등록을 요청하십시오.",
        })
      }
      break
    }
  }

  if (reasons.length === 0) return [inconclusiveReason(metricKey)]
  return reasons
}

/** 근거가 함께 실려 오지 않은 자리. 추측하지 않고 모른다고 적는다. */
function evidenceMissingReason(): MetricUnavailabilityReason {
  return {
    id: "evidence_missing",
    kind: "unknown",
    text: UNAVAILABILITY_EVIDENCE_MISSING_TEXT,
    action: null,
  }
}

/**
 * 근거는 실려 왔는데 그 안의 어느 조건도 걸리지 않았다.
 *
 * 제품 경로에서는 나오지 않아야 하는 상태다(엔진의 null 조건은 전부 위에서 다룬다).
 * 그래도 **조용히 빈 배열을 돌려주지 않는다** — 빈 배열이면 화면이 사유 칸을 아예 그리지
 * 않아 종전의 "이유 없는 산출 불가" 로 돌아간다. 모른다고 적는 쪽이 맞다.
 */
function inconclusiveReason(metricKey: KpiMetricKey): MetricUnavailabilityReason {
  return {
    id: "evidence_inconclusive",
    kind: "unknown",
    text:
      `실려 온 근거만 보면 ${METRIC_SENTENCE_NAME[metricKey]} 의 산출 조건은 모두 만족한 ` +
      "것으로 읽힙니다 — 값이 비어 있는 이유를 이 자료로는 확정할 수 없습니다. 함께 적힌 " +
      "KPI 스냅샷 근거와 적용 산식 버전을 확인하십시오.",
    action: null,
  }
}

/** `kind: "unknown"` · `evidence_missing` 의 본문. 자리마다 안내를 덧붙여 쓴다. */
export const UNAVAILABILITY_EVIDENCE_MISSING_TEXT =
  "이 기간에 어느 산출 조건이 모자랐는지는 여기 실린 자료만으로 확정할 수 없습니다 — " +
  "판정에 필요한 근거 수치가 함께 실려 있지 않습니다."

// ---------------------------------------------------------------------------
// 자리마다 덧붙이는 안내 — "그 사유는 어디에 적혀 있는가"
// ---------------------------------------------------------------------------

/** 지표값만 싣는 표(멀티사이트·비교표의 기준선 열)에서 쓴다. */
export const UNAVAILABILITY_LOOKUP_KPI_CARD =
  "지표별 사유는 사이트 개요 화면의 KPI 카드가 같은 기간으로 적습니다."

/**
 * 잠긴 기준선의 값. 스냅샷에서 복사한 스칼라값이라 이 화면에 근거 수치가 없다 —
 * 그러나 **스냅샷에는 있다.** 없다고만 적으면 운영자가 되짚을 길이 없다고 결론 낸다.
 */
export const UNAVAILABILITY_LOOKUP_LOCKED_BASELINE =
  "기준선(Before)의 값은 잠금 시점에 얼린 스냅샷에서 그대로 읽은 것이라, 그 기간의 " +
  "근거 수치가 여기 실려 있지 않습니다. 함께 적힌 스냅샷 ID 로 " +
  "GET /api/mrv/kpi-snapshots/{id} 를 조회하면 그때의 산출 근거(inputs_json)가 " +
  "그대로 들어 있습니다."

/** 이 칸을 넣기 전에 발행된 리포트. 없는 사실을 만들지 않고, 없다고 적는다. */
export const UNAVAILABILITY_LOOKUP_OLD_REPORT =
  "이 리포트는 산출 불가 사유의 근거 수치를 담기 전에 발행된 것이라 그 칸이 아예 " +
  "없습니다. 나중에 채워 넣으면 발행된 증빙이 사후에 달라지므로 비워 둡니다 — " +
  "리포트에 적힌 KPI 스냅샷 ID 로 그때의 산출 근거를 조회하십시오."

/** 리포트 목록처럼 값 한 칸만 싣는 자리. */
export const UNAVAILABILITY_LOOKUP_REPORT_DETAIL =
  "감축량이 산출 불가인 리포트는 상세 보기에서 그 사유(어느 쪽 EI 가 산출되지 " +
  "않았는가)와 산식 전문을 함께 확인할 수 있습니다."

// ---------------------------------------------------------------------------
// 「산출 불가」와 「잠정 지표」가 한 자리에 함께 뜰 때
// ---------------------------------------------------------------------------

/**
 * 두 문장이 **다른 층**이라는 연결 문장. 잠정 지표(지금은 OEI)에만 돌려준다.
 *
 * 왜 필요한가: 같은 카드에 "이 기간에 산출 불가" 와 "산식이 미확정" 이 나란히 뜬다.
 * 연결 없이 두면 읽는 사람이 둘을 한 사실로 합쳐 "입력을 채우면 산식도 확정된다" 또는
 * "산식이 미확정이라서 산출되지 않았다" 로 읽는다. **둘 다 틀렸다** — 입력을 채우면
 * 값은 나오고, 그래도 산식은 여전히 미확정이다. 그 둘을 한 줄로 못박는다.
 *
 * 판정은 `lib/mrv/metric-provenance.ts` 에서 온다(사본을 두지 않는다) — 그 파일이
 * 어느 지표를 잠정으로 보는지 바꾸면 이 문장도 함께 따라간다.
 */
export function unavailabilityVsProvisionalNote(metricKey: KpiMetricKey): string | null {
  if (!isProvisionalMetric(metricKey)) return null
  const name = METRIC_SENTENCE_NAME[metricKey]
  return (
    `위 사유는 이 기간의 입력에 대한 것이고, ${name} 의 산식이 미확정이라는 사실은 그와 ` +
    "다른 층입니다(같은 자리의 「잠정 지표」 칸에 적혀 있습니다). 입력을 채우면 값은 " +
    "산출되지만 산식이 확정되는 것은 아니며, 반대로 산식이 미확정이라서 이 기간의 값이 " +
    "비어 있는 것도 아닙니다."
  )
}

// ---------------------------------------------------------------------------
// 전·후 비교표의 변화량 · 개선율
// ---------------------------------------------------------------------------

/**
 * 변화량 · 개선율이 산출되지 않은 사유.
 *
 * 이 둘은 지표값과 **다른 조건**에서 비는데, 비교표는 셋을 같은 "산출 불가" 로 적고
 * 있었다. `lib/mrv/kpi/comparison.ts` 의 규약을 읽으면 확정할 수 있다.
 *   · 두 값 중 하나라도 비면 변화량과 개선율이 함께 빈다.
 *   · 기준선 값이 0 이하면 **변화량은 나오고 개선율만 빈다**(0 으로 나누거나 부호가
 *     뒤집히므로 엔진이 null 을 낸다). 지표값이 둘 다 있는데 개선율만 빈 칸은 이
 *     경우뿐이고, 그 사실을 적지 않으면 운영자는 자기 입력을 의심한다 — 입력 문제가
 *     아니다.
 *
 * `null` 을 돌려주면 적을 사유가 없다(개선율이 산출됐다)는 뜻이다.
 */
export function comparisonImprovementUnavailabilityText(row: {
  baselineValue: number | null
  currentValue: number | null
  improvementPct: number | null
}): string | null {
  if (row.improvementPct !== null) return null

  const empty: string[] = []
  if (row.baselineValue === null) empty.push("기준선(Before)")
  if (row.currentValue === null) empty.push("현재(After)")
  if (empty.length > 0) {
    return (
      `변화량과 개선율은 기준선과 현재 두 값이 모두 있어야 산출됩니다 — ` +
      `${empty.join(" · ")} 의 값이 비어 있습니다. 빈 값을 0 으로 두면 개선율이 ` +
      "100% 또는 음의 무한대로 잡히므로 그렇게 하지 않습니다."
    )
  }

  if (row.baselineValue !== null && row.baselineValue <= 0) {
    return (
      `기준선 값이 ${row.baselineValue} 이라 개선율의 분모가 되지 못합니다` +
      "(0 으로 나누거나 부호가 뒤집힙니다). 변화량은 그대로 산출되어 있으므로 그 숫자로 " +
      "읽으십시오 — 이 기간의 입력이 모자란 것이 아닙니다."
    )
  }

  return (
    "개선율이 산출되지 않았습니다. 기준선과 현재 값은 둘 다 실려 있으므로, 이 화면의 " +
    "자료만으로는 사유를 확정할 수 없습니다."
  )
}

// ---------------------------------------------------------------------------
// 인쇄 리포트 + 리포트 화면이 **같이 쓰는** 절
// ---------------------------------------------------------------------------

/** 리포트의 「산출 불가 사유」 절 제목. */
export const REPORT_UNAVAILABILITY_HEADING = "산출 불가 사유 — 어느 조건이 모자랐는가"

/**
 * 그 절의 머리말. 화면과 인쇄가 **같은 문장**을 쓴다 — 두 곳이 각자 지으면 화면으로 본
 * 사람과 인쇄물로 본 사람이 다른 사실을 알게 된다.
 */
export const REPORT_UNAVAILABILITY_INTRO =
  "아래는 이 리포트의 값 가운데 산출되지 않은 것의 사유입니다. 판정은 리포트 생성 시점에 " +
  "얼린 근거 수치로 하며, 산출되지 않은 값을 0 으로 바꾸어 적지 않습니다."


/**
 * 감축량이 산출되지 않은 사유 — Before · After 의 EI 중 어느 쪽이 비었는가.
 *
 * `lib/mrv/kpi/scope2.ts` 는 두 EI 중 하나라도 null 이면 감축량을 null 로 낸다. 리포트는
 * 그 두 값을 `before_json.ei_total` · `after_json.ei_total` 로 들고 있으므로, **엔진을
 * 건드리지 않고 그 결론을 그대로 읽어** 어느 쪽인지 확정할 수 있다. 사용자 계산표의
 * 「감축량_산정상태: 비교 가능한 기준선 미제공」 이 바로 이 자리다.
 *
 * `null` 을 돌려주면 "사유를 적을 일이 없다"(감축량이 산출됐다)는 뜻이다.
 */
export function reductionUnavailabilityText(params: {
  reductionTco2e: number | null
  beforeEiTotal: number | null
  afterEiTotal: number | null
}): string | null {
  if (params.reductionTco2e !== null) return null

  const missing: string[] = []
  if (params.beforeEiTotal === null) missing.push("기준선(Before)")
  if (params.afterEiTotal === null) missing.push("현재(After)")

  if (missing.length === 0) {
    return (
      "감축량이 산출되지 않았습니다. Before · After 의 EI 는 둘 다 실려 있으므로, 사유는 " +
      "이 리포트의 「산식 전문」 절에 적힌 대입값에서 확인하십시오."
    )
  }

  return (
    `감축량은 (기준선 EI − 현재 EI) × 생산량 × 배출계수 로 산출되는데, ` +
    `${missing.join(" · ")} 의 EI 가 산출되지 않아 그 차이를 낼 수 없습니다. ` +
    "산출되지 않은 EI 를 0 으로 두면 감축량이 기준선 전량 또는 음수로 잡히므로 " +
    "그렇게 하지 않습니다 — 아래 지표별 사유에서 그 EI 가 왜 비었는지 확인하십시오."
  )
}

/**
 * 기준선(Before) Scope2 배출량이 산출되지 않은 사유.
 *
 * 이 값은 **감축량과 다른 조건**에서 빈다. `lib/mrv/kpi/scope2.ts` 는 기준선 총 전력
 * (MWh)이 없으면 그 참고값을 null 로 내고, 그 전력은 리포트 생성 시 기준선이 가리키는
 * KPI 스냅샷에서 복사된다(lib/mrv/mrv-report-service.ts). 즉 EI 와는 무관하다 — 둘을
 * 같은 "N/A" 로 적으면 읽는 사람이 EI 쪽 사유를 이 칸의 사유로 찾다가 못 찾는다.
 */
export function baselineScope2UnavailabilityText(params: {
  scope2Tco2e: number | null
  kpiSnapshotId: string | null
}): string | null {
  if (params.scope2Tco2e !== null) return null

  if (params.kpiSnapshotId === null) {
    return (
      "기준선 Scope2 배출량(참고값)은 기준선 기간의 총 전력 × 배출계수인데, 이 리포트의 " +
      "기준선에 KPI 스냅샷 참조가 없어 그 전력을 읽을 수 없습니다. 감축량 산식에는 이 " +
      "값이 쓰이지 않으므로, 감축량이 산출됐다면 그 값은 그대로 유효합니다."
    )
  }
  return (
    `기준선 Scope2 배출량(참고값)은 기준선 기간의 총 전력 × 배출계수인데, 기준선 ` +
    `스냅샷(${params.kpiSnapshotId})에 그 전력(inputs_json.ei.total_power_kwh)이 들어 ` +
    "있지 않습니다. 감축량 산식에는 이 값이 쓰이지 않으므로, 감축량이 산출됐다면 그 " +
    "값은 그대로 유효합니다."
  )
}

/** 리포트의 「산출 불가 사유」 절에 들어가는 한 항목. */
export interface ReportUnavailabilityEntry {
  /** 기계가 보는 식별자(React key · 검증용). */
  id: string
  /** 어느 값인가 — 기간(Before/After)까지 적는다. */
  label: string
  /** 지표별 사유. 사유를 확정할 근거가 아예 없는 항목은 빈 배열이고 `note` 가 말한다. */
  reasons: MetricUnavailabilityReason[]
  /** 그 항목에 붙는 자립 문장(어디에 적혀 있는가 · 다른 층의 사실 · 다른 조건의 사유). */
  note: string | null
}

/**
 * 리포트 한 건에서 산출되지 않은 값 전부와 그 사유.
 *
 * ★ **인쇄 리포트와 리포트 화면이 이 함수 하나를 쓴다.** 두 곳이 각자 항목을 고르면
 *   화면으로 본 사람과 인쇄물로 본 사람이 다른 사실을 알게 된다 —
 *   `REPORT_PROVISIONAL_METRIC_LINES` 를 한 배열로 둔 것과 같은 이유다.
 *
 * 리포트가 들고 있는 값만 본다. 비교표에 실리는 것은 EI(총·폭기) · 전력 · 생산량 ·
 * Scope2 이고 FCR · OEI · 폐사율은 실리지 않으므로, 그 셋은 여기서 다루지 않는다.
 *
 * 기준선(Before) 쪽에는 근거 수치가 없다. 리포트는 After 기간의 근거만 얼려 담고
 * (Before 의 것은 잠긴 스냅샷에 있다), 그 사실을 적는 쪽이 추측하는 쪽보다 맞다.
 */
export function reportUnavailabilityEntries(input: {
  reductionTco2e: number | null
  before: {
    eiTotal: number | null
    eiAeration: number | null
    scope2Tco2e: number | null
    kpiSnapshotId: string | null
  }
  after: { eiTotal: number | null; eiAeration: number | null }
  /** 생성 시점에 얼린 After 기간 근거. 이 칸을 넣기 전 리포트에는 없다(undefined). */
  afterEvidence: MetricUnavailabilityEvidence | undefined
}): ReportUnavailabilityEntry[] {
  const entries: ReportUnavailabilityEntry[] = []

  const reductionText = reductionUnavailabilityText({
    reductionTco2e: input.reductionTco2e,
    beforeEiTotal: input.before.eiTotal,
    afterEiTotal: input.after.eiTotal,
  })
  if (reductionText !== null) {
    entries.push({
      id: "reduction_tco2e",
      label: "감축량(Scope2 Reduction)",
      reasons: [],
      note: reductionText,
    })
  }

  const afterMetrics: [string, KpiMetricKey, number | null][] = [
    ["after_ei_total", "ei_total", input.after.eiTotal],
    ["after_ei_aeration", "ei_aeration", input.after.eiAeration],
  ]
  for (const [id, key, value] of afterMetrics) {
    if (value !== null) continue
    entries.push({
      id,
      label: `현재(After) · ${METRIC_SENTENCE_NAME[key]}`,
      reasons: metricUnavailabilityReasons(key, input.afterEvidence),
      note: input.afterEvidence === undefined ? UNAVAILABILITY_LOOKUP_OLD_REPORT : null,
    })
  }

  const beforeEiMissing: string[] = []
  if (input.before.eiTotal === null) beforeEiMissing.push(METRIC_SENTENCE_NAME.ei_total)
  if (input.before.eiAeration === null) {
    beforeEiMissing.push(METRIC_SENTENCE_NAME.ei_aeration)
  }
  if (beforeEiMissing.length > 0) {
    entries.push({
      id: "before_ei",
      label: `기준선(Before) · ${beforeEiMissing.join(" · ")}`,
      reasons: [],
      note: UNAVAILABILITY_LOOKUP_LOCKED_BASELINE,
    })
  }

  const baselineScope2Text = baselineScope2UnavailabilityText({
    scope2Tco2e: input.before.scope2Tco2e,
    kpiSnapshotId: input.before.kpiSnapshotId,
  })
  if (baselineScope2Text !== null) {
    entries.push({
      id: "before_scope2",
      label: "기준선(Before) · Scope2 배출량",
      reasons: [],
      note: baselineScope2Text,
    })
  }

  return entries
}
