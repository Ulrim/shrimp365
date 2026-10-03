/**
 * 기준선 잠금 전 입력 충분성 판정.
 *
 * **왜 필요한가.** 잠긴 기준선은 불변이다 — API 에 수정 경로가 없고 DB 트리거가
 * UPDATE/DELETE 자체를 거부한다(ADR 0002). 그리고 그 값은 이후 모든 전·후 비교와
 * Scope2 감축량의 원점이 된다. 그런데 잠금 라우트는 기간 유효성과 "이미 잠긴 기준선이
 * 있는가"만 보았다. **계측값 세 건으로 계산된 기준선도 그대로 잠겼고, 되돌릴 수 없었다.**
 * 되돌릴 수 없는 결정에 입력 충분성 가드가 없는 것이 이 모듈이 메우는 구멍이다.
 *
 * **무엇을 보지 않는가.** 여기서는 **KPI 산식을 다시 계산하지 않는다.** 엔진이 이미 산출
 * 근거로 들고 있는 수(`includedReadingCount`, `excludedReadingCount`,
 * `includedFeedCount`, `biomassDeltaKg`, `aerationPowerKwh`, `stockedCount`)와 엔진이 이미
 * 내린 결론(`eiTotal === null` 등)만 읽는다. 기간 길이와 제외 비율은 여기서 계산하지만
 * 그 둘은 KPI 가 아니다. 산식은 KPI 엔진에만 둔다는 규칙을 그대로 지킨다 — 이 모듈은
 * **판정이지 산출이 아니다**.
 *
 * **막는 기준은 보수적으로, 보여 주는 숫자는 전부.** 과하게 막으면 운영자가 강행
 * 스위치를 습관적으로 켜고, 그러면 가드가 있으나 마나가 된다. 그래서 명백히 변호할 수
 * 없는 것만 차단(blocking)하고 나머지는 경고(warning)로 띄워 사람이 보고 판단하게 한다.
 *
 * **임계값의 자리.** `kpi_config.params_json.baseline` 에서 읽는다. 여기에 두는 이유는
 * **버전이 찍히기 때문**이다 — `config_version` 이 기준선 행에 기록되므로, 나중에 "그때
 * 어떤 기준으로 통과시켰나"를 되짚을 수 있다. 설정이 없으면 아래 기본값을 쓰고, 그 사실도
 * 판정 결과에 적어 보낸다.
 *
 * ⚠ 이 블록이 지표 산출을 세우지 않는 것은 공짜가 아니다. `lib/mrv/kpi/config.ts` 의
 * `EXTENSION_KEYS` 에 `baseline` 이 등재되어 있어야 한다 — 등재되지 않으면 그 블록만 적힌
 * `params_json` 이 '평면 EI 문서'로 오판되어 6종 파서 전부가 모르는 키라고 거부하고, 그
 * org 의 KPI·리포트·알림이 통째로 422 가 된다. 두 파일은 함께 움직인다.
 *
 * **블록의 검증은 여기서 한다.** 집 양식(`rejectUnknown`)과 같은 태도로, 모르는 키와
 * 숫자가 아닌 값·범위를 벗어난 값을 `KpiValueError`(→ 422)로 거부한다. 되돌릴 수 없는
 * 잠금의 가드이므로 **조용히 기본값으로 메우지 않는다** — `min_power_readings: null` 을
 * 0 으로 읽어 가드를 꺼 버리는 쪽이 설정 오류를 알려 주는 쪽보다 훨씬 위험하다.
 */

import type { SiteKpiComputation } from "./kpi-service";
import { eiConfigFromParams, fcrConfigFromParams, type ParamsJson } from "./kpi/config";
import { KpiValueError } from "./kpi/status";

/** 판정 임계값. 전부 선택이며, 없으면 DEFAULT_BASELINE_POLICY 가 쓰인다. */
export interface BaselinePolicy {
  /** 기준선 기간의 최소 길이(일). 운영 주기를 한 바퀴는 돌아야 대표성이 생긴다. */
  minPeriodDays: number;
  /**
   * 산입된 전력 계측값의 최소 건수.
   *
   * ⚠ 기본값 100 은 **시간 이하 주기의 자동 수집을 전제한다**(15분 주기 1대면 7일에
   * 672건). 하루 1건 수기 입력 사이트에서는 7일에 7건뿐이라 언제나 막히고, 그러면
   * 운영자가 강행 스위치를 습관적으로 켜게 된다 — 가드의 자살이다. 반대로 계측기가
   * 10대인 사이트는 `includedReadingCount` 가 전 계측기 합이라 1/10 기간에 100건을
   * 채운다. 즉 **같은 숫자가 수집 주기와 설비 규모에 따라 10배씩 느슨해진다.**
   * 수기 입력 사이트나 대형 사이트에서는 `params_json.baseline.min_power_readings` 로
   * 반드시 조정해야 한다. 일·계측기당 기대 건수로 정규화하는 편이 본래 옳지만, 수집
   * 주기를 이 계층이 알지 못하므로 지금은 절대 건수 + 설정 가능으로 둔다.
   */
  minPowerReadings: number;
  /** 산입된 급이 기록의 최소 건수. */
  minFeedLogs: number;
  /**
   * 전력 계측값 중 제외된 비율의 상한(0~1).
   *
   * 제외 사유는 두 가지가 섞인다 — 기간 밖이거나, 품질 플래그가 산입 목록에 없거나.
   * 조회는 닫힌 구간 `[from, to]` 이고(`kpi-service`) 엔진의 판정은 반열림 `[from, to)`
   * 이므로(`kpi/internal.inPeriod`), **종료 시각과 정확히 같은 계측값은 계측기당 1건씩**
   * '기간 밖'으로 제외된다. 그 1건을 빼면 나머지는 전부 품질 탈락이다.
   */
  maxExcludedReadingRatio: number;
}

export const DEFAULT_BASELINE_POLICY: BaselinePolicy = {
  minPeriodDays: 7,
  minPowerReadings: 100,
  minFeedLogs: 3,
  maxExcludedReadingRatio: 0.5,
};

export type ReadinessSeverity = "blocking" | "warning" | "info";

export interface ReadinessCheck {
  /** 기계가 보는 식별자(화면 문구와 독립). */
  id: string;
  severity: ReadinessSeverity;
  /** 이 검사를 통과했는가. severity 가 info 면 언제나 true. */
  passed: boolean;
  /** 사람이 읽는 한 줄. 실제 숫자를 그대로 넣는다 — 되돌릴 수 없는 결정이니까. */
  message: string;
  /** 판정에 쓴 값과 기준(증빙용). */
  observed?: number | null;
  threshold?: number | null;
}

export interface BaselineReadiness {
  /** 차단 항목이 하나도 없으면 true. */
  ok: boolean;
  /** 강행(acknowledge)으로도 넘길 수 없는 항목이 있으면 true. */
  fatal: boolean;
  checks: ReadinessCheck[];
  /** 판정에 실제로 쓰인 임계값. */
  policy: BaselinePolicy;
  /** 임계값이 kpi_config 에서 왔는지, 코드 기본값인지. */
  policySource: "kpi_config" | "default";
}

const MS_PER_DAY = 86_400_000;

/** `baseline` 블록에서 허용하는 키. 이 밖은 오탈자로 보고 거부한다. */
const BASELINE_KEYS = [
  "min_period_days",
  "min_power_readings",
  "min_feed_logs",
  "max_excluded_reading_ratio",
] as const;

/**
 * 설정값 하나를 읽는다. 키가 없으면 기본값, 있으면 **엄격하게** 검사한다.
 *
 * `Number()` 강제변환에 기대지 않는 이유: `Number(null)`·`Number("")`·`Number([])`·
 * `Number(false)` 가 모두 `0` 이다. 그대로 쓰면 `min_power_readings: null` 한 줄이
 * 가드를 조용히 끈다. 되돌릴 수 없는 잠금의 임계값이라 그 실패 방식은 받아들일 수 없다.
 * 숫자 리터럴만 받고, 범위를 벗어나면 422 로 되돌려 보낸다.
 */
function strictNum(
  doc: ParamsJson,
  key: string,
  fallback: number,
  range: { min: number; max?: number },
): number {
  const raw = doc[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new KpiValueError(
      `baseline params_json ${key} must be a finite number, got ${JSON.stringify(raw) ?? String(raw)}`,
    );
  }
  if (raw < range.min || (range.max !== undefined && raw > range.max)) {
    const bound = range.max === undefined ? `>= ${range.min}` : `${range.min}..${range.max}`;
    throw new KpiValueError(
      `baseline params_json ${key} out of range (${bound}), got ${raw}`,
    );
  }
  return raw;
}

/**
 * `params_json.baseline` → 정책. 블록이 없으면 기본값을 쓴다.
 *
 * 개별 키만 적혀 있으면 나머지는 기본값으로 채운다 — 신호등 임계값과 달리 이 값들은
 * 서로 짝을 이루지 않아(각자 독립적인 하한), 한쪽만 적어도 뜻이 모호해지지 않는다.
 * **적혀 있는 값은 전부 검사한다** — 모르는 키, 숫자가 아닌 값, 범위 밖 값은
 * `KpiValueError`(→ 422)로 거부한다. 0 은 허용한다("이 항목은 보지 않겠다"는 명시적
 * 선택이고, 그 선택은 `config_version` 과 감사 로그에 그대로 남는다).
 *
 * @throws KpiValueError 블록이 객체가 아니거나 내용이 스키마에 맞지 않을 때.
 */
export function baselinePolicyFromParams(params: ParamsJson | null | undefined): {
  policy: BaselinePolicy;
  source: "kpi_config" | "default";
} {
  const block = params?.["baseline"];
  if (block === undefined) {
    return { policy: DEFAULT_BASELINE_POLICY, source: "default" };
  }
  if (block === null || typeof block !== "object" || Array.isArray(block)) {
    throw new KpiValueError(
      `baseline params_json must be an object, got ${Array.isArray(block) ? "array" : String(block)}`,
    );
  }
  const doc = block as ParamsJson;
  const unknown = Object.keys(doc).filter((k) => !BASELINE_KEYS.includes(k as never));
  if (unknown.length > 0) {
    throw new KpiValueError(
      `unknown baseline params_json keys: ${JSON.stringify(unknown.sort())}`,
    );
  }
  return {
    policy: {
      minPeriodDays: strictNum(doc, "min_period_days", DEFAULT_BASELINE_POLICY.minPeriodDays, {
        min: 0,
      }),
      minPowerReadings: strictNum(
        doc,
        "min_power_readings",
        DEFAULT_BASELINE_POLICY.minPowerReadings,
        { min: 0 },
      ),
      minFeedLogs: strictNum(doc, "min_feed_logs", DEFAULT_BASELINE_POLICY.minFeedLogs, {
        min: 0,
      }),
      maxExcludedReadingRatio: strictNum(
        doc,
        "max_excluded_reading_ratio",
        DEFAULT_BASELINE_POLICY.maxExcludedReadingRatio,
        { min: 0, max: 1 },
      ),
    },
    source: "kpi_config",
  };
}

/** 소수 자리를 표시용으로 줄인다(판정값 자체는 원값을 싣는다). */
function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * 충분성 판정.
 *
 * @param comp  엔진이 낸 산출 결과 묶음. 여기서 근거 수만 읽는다.
 * @param period 잠그려는 기간.
 * @param params 활성 kpi_config 의 params_json(임계값 출처).
 */
export function assessBaselineReadiness(
  comp: SiteKpiComputation,
  period: { from: Date; to: Date },
  params: ParamsJson | null | undefined,
): BaselineReadiness {
  const { policy, source } = baselinePolicyFromParams(params);
  const checks: ReadinessCheck[] = [];

  // ── ① 지표가 하나도 없는 기준선 — 강행으로도 못 넘긴다 ──────────────────
  // 비교의 원점으로 쓸 수 없는 값을 영구히 박아 넣는 일이다. 이건 판단의 문제가 아니다.
  // 분모는 '적용 대상' 지표 수다. DO 목표대역이 없는 사이트는 OEI 가 애초에 산출 대상이
  // 아니므로(⑧ 참고) 5 로 나누면 정상인데도 4/5 로 떠서 뭔가 빠진 것처럼 읽힌다.
  const oeiApplicable = comp.oei !== null;
  const metricValues = [
    comp.ei.eiTotal,
    comp.ei.eiAeration,
    comp.fcr.fcr,
    ...(oeiApplicable ? [comp.oei?.oei ?? null] : []),
    comp.mortality.cumulativeRatePct,
  ];
  const applicableCount = metricValues.length;
  const presentCount = metricValues.filter((v) => v !== null).length;
  checks.push({
    id: "all_metrics_null",
    severity: "blocking",
    passed: presentCount > 0,
    message:
      presentCount > 0
        ? `산출된 지표 ${presentCount}/${applicableCount}종.`
        : `적용 대상 ${applicableCount}종 지표가 모두 '산출 불가'입니다. ` +
          "비교의 원점으로 쓸 수 없는 기준선이라 잠글 수 없습니다.",
    observed: presentCount,
    threshold: 1,
  });

  // ── ② 기간 길이 ─────────────────────────────────────────────────────────
  const periodDays = (period.to.getTime() - period.from.getTime()) / MS_PER_DAY;
  checks.push({
    id: "period_too_short",
    severity: "blocking",
    passed: periodDays >= policy.minPeriodDays,
    message:
      periodDays >= policy.minPeriodDays
        ? `기준선 기간 ${periodDays.toFixed(1)}일.`
        : `기준선 기간이 ${periodDays.toFixed(1)}일로 최소 ${policy.minPeriodDays}일보다 짧습니다. ` +
          "짧은 기간은 그날의 운전 상태를 양식장의 평상시로 박아 버립니다.",
    observed: Number(periodDays.toFixed(3)),
    threshold: policy.minPeriodDays,
  });

  // ── ③ 전력 계측값 건수 — EI 의 분자 근거 ────────────────────────────────
  const included = comp.ei.includedReadingCount;
  const excluded = comp.ei.excludedReadingCount;
  checks.push({
    id: "power_readings_low",
    severity: "blocking",
    passed: included >= policy.minPowerReadings,
    message:
      included >= policy.minPowerReadings
        ? `산입된 전력 계측값 ${included}건.`
        : `산입된 전력 계측값이 ${included}건으로 최소 ${policy.minPowerReadings}건보다 적습니다. ` +
          "EI(전력집약도)의 분자가 이 값들의 합입니다.",
    observed: included,
    threshold: policy.minPowerReadings,
  });

  // ── ④ 제외 비율 — "산출은 됐지만 믿을 수 없다" 를 가른다 ────────────────
  const totalReadings = included + excluded;
  const excludedRatio = totalReadings > 0 ? excluded / totalReadings : 0;
  checks.push({
    id: "excluded_ratio_high",
    severity: "blocking",
    passed: excludedRatio <= policy.maxExcludedReadingRatio,
    message:
      excludedRatio <= policy.maxExcludedReadingRatio
        ? `전력 계측값 제외율 ${pct(excludedRatio)} (${excluded}/${totalReadings}건).`
        : `전력 계측값의 ${pct(excludedRatio)}(${excluded}/${totalReadings}건)가 산입되지 않았습니다. ` +
          `상한은 ${pct(policy.maxExcludedReadingRatio)}입니다. ` +
          "조회는 기간 양끝을 포함하고 산입 판정은 종료 시각을 제외하므로 " +
          "계측기당 1건은 '기간 밖'으로 빠지며, 나머지는 품질 플래그가 산입 목록에 " +
          "없어 탈락한 것입니다.",
    observed: Number(excludedRatio.toFixed(4)),
    threshold: policy.maxExcludedReadingRatio,
  });

  // ── ⑤ 급이 기록 건수 — FCR 의 분자 근거 ─────────────────────────────────
  const feedCount = comp.fcr.includedFeedCount;
  checks.push({
    id: "feed_logs_low",
    severity: "blocking",
    passed: feedCount >= policy.minFeedLogs,
    message:
      feedCount >= policy.minFeedLogs
        ? `산입된 급이 기록 ${feedCount}건.`
        : `산입된 급이 기록이 ${feedCount}건으로 최소 ${policy.minFeedLogs}건보다 적습니다. ` +
          "FCR(사료요구율)의 분자가 이 기록들의 합입니다.",
    observed: feedCount,
    threshold: policy.minFeedLogs,
  });

  // ── ⑥ Δbiomass — EI·FCR 의 분모 ─────────────────────────────────────────
  // 임계값을 여기서 다시 정하지 않는다. 엔진은 `biomassDeltaKg <= minBiomassDeltaKg` 일 때
  // EI·FCR 을 null 로 내므로(energy.ts·feed.ts), **엔진의 결론을 그대로 읽는다**.
  // 0 을 하드코딩하면 `min_biomass_delta_kg` 가 0 이 아닌 사이트에서 "판정 통과 + 지표
  // null" 이라는 거짓말이 나온다(설정 가능한 값이다).
  // EI 와 FCR 은 임계값을 각자(`ei.min_biomass_delta_kg`·`fcr.min_biomass_delta_kg`) 들고
  // 있어 서로 다를 수 있다. 그래서 둘의 결론을 각각 읽고, 막힌 쪽을 이름으로 알린다.
  const delta = comp.ei.biomassDeltaKg;
  const eiMinDelta = eiConfigFromParams(params ?? {}).minBiomassDeltaKg;
  const fcrMinDelta = fcrConfigFromParams(params ?? {}).minBiomassDeltaKg;
  const nulledByDelta: string[] = [];
  if (comp.ei.eiTotal === null) nulledByDelta.push(`EI(임계값 ${eiMinDelta} kg)`);
  if (comp.fcr.fcr === null) nulledByDelta.push(`FCR(임계값 ${fcrMinDelta} kg)`);
  checks.push({
    id: "biomass_delta_nonpositive",
    severity: "blocking",
    passed: nulledByDelta.length === 0,
    message:
      nulledByDelta.length === 0
        ? `생체량 증가분 ${delta.toFixed(2)} kg.`
        : `생체량 증가분이 ${delta.toFixed(2)} kg 로 ${nulledByDelta.join("·")} 의 산출 ` +
          "임계값 이하입니다. 분모가 없어 해당 지표가 산출되지 않습니다. " +
          "기간 양 끝에 수확·계측 기록이 있는지 확인하세요.",
    observed: Number(delta.toFixed(4)),
    threshold: Math.max(eiMinDelta, fcrMinDelta),
  });

  // ── ⑦ 폭기 전력 근거 ────────────────────────────────────────────────────
  // 폭기 계측기(is_aeration)가 하나도 없으면 aerationPowerKwh = 0 이고, 분모가 있으면
  // eiAeration 은 **null 이 아니라 0** 이다(energy.ts). 그래서 ① 도 ③ 도 이를 잡지 못한다.
  // 그대로 잠기면 폭기 EI 0 kWh/kg 이 영구 원점이 되고, 이후 모든 전·후 비교에서 폭기
  // 전력은 "기준선 대비 무한 증가"로 읽힌다. 폭기 전력은 이 플랫폼 EI 의 핵심이다.
  const aerationKwh = comp.ei.aerationPowerKwh;
  const aerationMissing = comp.ei.eiAeration !== null && aerationKwh === 0;
  checks.push({
    id: "aeration_power_zero",
    severity: "blocking",
    passed: !aerationMissing,
    message: aerationMissing
      ? "폭기 전력이 0 kWh 입니다 — 폭기로 표시된(is_aeration) 계측기의 계측값이 " +
        "이 기간에 하나도 산입되지 않았습니다. 이 상태로 잠그면 폭기 EI 0 kWh/kg 이 " +
        "영구 원점이 되어, 이후 모든 비교에서 폭기 전력이 '무한 증가'로 읽힙니다. " +
        "설정에서 계측기의 폭기 여부를 확인하세요."
      : `폭기 전력 ${aerationKwh.toFixed(2)} kWh.`,
    observed: Number(aerationKwh.toFixed(4)),
    threshold: null,
  });

  // ── ⑧ 폐사율 분모 — 경고 ────────────────────────────────────────────────
  // stockedCount 는 **사이트에 등록된 모든 배치의 합**이다(엔진이 기간으로 자르지 않는다).
  // 기간 단위 점검 패널에 뜨므로 "그 기간의 입식"으로 읽히지 않게 문구를 못박아 둔다.
  const stocked = comp.mortality.stockedCount;
  checks.push({
    id: "mortality_no_stock",
    severity: "warning",
    passed: stocked > 0,
    message:
      stocked > 0
        ? `등록된 입식 수 ${stocked.toLocaleString("ko-KR")}마리(전 기간 배치 합).`
        : "등록된 입식 수가 0 이라 폐사율이 산출되지 않습니다. 배치 등록을 확인하세요.",
    observed: stocked,
    threshold: 1,
  });

  // ── ⑨ OEI 적용 여부 — 정보 ──────────────────────────────────────────────
  // 수조에 DO 목표대역(target_do_min/max)이 없으면 OEI 는 애초에 산출 대상이 아니다.
  // 결함이 아니라 설정 상태이므로 막지 않고 알리기만 한다.
  checks.push({
    id: "oei_not_applicable",
    severity: "info",
    passed: true,
    message:
      comp.oei === null
        ? "OEI 는 산출 대상이 아닙니다 — 수조에 DO 목표대역(target_do_min/max)이 설정되어 있지 않습니다."
        : `OEI DO 표본 ${comp.oei.doTotalSamples}건 중 대역 내 ${comp.oei.doInBandSamples}건.`,
    observed: comp.oei?.doTotalSamples ?? null,
    threshold: null,
  });

  const fatal = checks.some((c) => c.id === "all_metrics_null" && !c.passed);
  const ok = checks.every((c) => c.severity !== "blocking" || c.passed);

  return { ok, fatal, checks, policy, policySource: source };
}

/**
 * 차단 항목만 추려 한 줄로. 422 본문과 감사 로그에 같은 문구를 쓴다.
 *
 * fatal 일 때는 **그 항목만** 싣는다. 전 지표 null 이면 Δbiomass·건수도 같이 걸리는 것이
 * 보통인데, 호출부가 "이 항목은 강행할 수 없습니다"를 뒤에 붙이므로 전부 이어 붙이면
 * 강행 가능한 항목까지 강행 불가로 읽힌다.
 */
export function failedBlockingSummary(readiness: BaselineReadiness): string {
  return readiness.checks
    .filter((c) =>
      readiness.fatal
        ? c.id === "all_metrics_null" && !c.passed
        : c.severity === "blocking" && !c.passed,
    )
    .map((c) => c.message)
    .join(" ");
}
