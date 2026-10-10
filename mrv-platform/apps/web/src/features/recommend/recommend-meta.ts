/*
 * 추천 보드 표시 메타데이터 — type/필드 라벨·단위의 한국어 사전.
 * 산식/판정 로직이 아니라 표시 전용(phase-2 2.3절 params/rationale은 백엔드가 이미 산출한 값).
 */
import type { RecipeType } from "@/types/api";

export const RECIPE_TYPE_LABEL: Record<RecipeType, string> = {
  feed: "급이",
  oxygen: "산소",
  circulation: "순환",
};

export const RECIPE_TYPE_ORDER: RecipeType[] = ["feed", "oxygen", "circulation"];

/** 순환 설정 열거형 한국어 라벨(값은 data-kpi-engineer 확정, 미지의 값은 원문 그대로 표시). */
export const CIRCULATION_SETTING_LABEL: Record<string, string> = {
  normal: "정상 유지",
  increase: "순환 강화",
  reduce: "순환 완화",
};

export function circulationSettingLabel(value: string): string {
  return CIRCULATION_SETTING_LABEL[value] ?? value;
}

/** type별 params 표시(단위 포함). 값이 null이면 "추천 불가(근거 부족)"로 표시(호출부 책임). */
export function formatRecommendedValue(
  type: RecipeType,
  params: Record<string, unknown>,
): string | null {
  if (type === "feed") {
    const v = params.feed_kg_per_day;
    return typeof v === "number" ? `${v} kg/일` : null;
  }
  if (type === "oxygen") {
    const v = params.oxygen_target_do_mg_l;
    return typeof v === "number" ? `${v} mg/L` : null;
  }
  if (type === "circulation") {
    const v = params.circulation_setting;
    return typeof v === "string" ? circulationSettingLabel(v) : null;
  }
  return null;
}
