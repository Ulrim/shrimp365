/*
 * SOP 라이브러리 표시 메타데이터 — category 한국어 라벨(MASTER 화면8 문구 그대로 4종,
 * phase-3 2.1절). 산식/판정 로직 아님(표시 전용).
 */
import type { SopCategory } from "@/types/api";

export const SOP_CATEGORY_LABEL: Record<SopCategory, string> = {
  normal: "정상운영",
  water_quality: "수질악화",
  do_drop: "DO저하",
  mortality_spike: "폐사증가",
};

export const SOP_CATEGORY_ORDER: SopCategory[] = [
  "normal",
  "water_quality",
  "do_drop",
  "mortality_spike",
];
