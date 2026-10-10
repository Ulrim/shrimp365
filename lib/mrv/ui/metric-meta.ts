/*
 * 원본: mrv-platform/apps/web/src/lib/metric-meta.ts
 * 표시 전용 메타데이터/순수 함수라 그대로 옮겼다. 바꾼 것은 두 가지뿐이다:
 *   - import 경로(@/types/api → @/lib/mrv/api-types)
 *   - 디자인 토큰 클래스 이름(signal-*, fg/surface/... → mrv-* 네임스페이스)
 */
/*
 * 지표 표시 메타데이터 — 제목 + 방향성(betterWhen).
 * phase-1 1절 지표 정의를 단일 출처로 고정한다(카드가 지표별로 올바른 방향을 표기하도록).
 *   - EI(ei_total/ei_aeration) · FCR · 폐사율 = "낮을수록 좋음"
 *   - OEI = "높을수록 좋음"
 * 산식이 아니라 라벨/순서만 담는다(프론트 재계산 금지 규칙과 무관).
 */
import type { KpiMetricKey } from "@/lib/mrv/api-types";

export interface MetricMeta {
  title: string;
  betterWhen: "lower" | "higher";
  /** 참조용 단위(백엔드 metric.unit을 실제 표시에 사용; 여기는 문서용). */
  unit: string;
}

export const METRIC_META: Record<KpiMetricKey, MetricMeta> = {
  ei_total: { title: "전력집약도(EI)", betterWhen: "lower", unit: "kWh/kg" },
  ei_aeration: { title: "폭기 EI", betterWhen: "lower", unit: "kWh/kg" },
  fcr: { title: "사료요구율(FCR)", betterWhen: "lower", unit: "kg/kg" },
  oei: { title: "산소효율지수(OEI)", betterWhen: "higher", unit: "index" },
  mortality_rate: { title: "폐사율", betterWhen: "lower", unit: "%" },
};

/** 개요/기준선 카드 표시 순서(5종). */
export const METRIC_ORDER: KpiMetricKey[] = [
  "ei_total",
  "ei_aeration",
  "fcr",
  "oei",
  "mortality_rate",
];
