/*
 * 알림 표시 메타데이터 — type/severity/status의 한국어 라벨과 배지 톤.
 * 산식/판정 로직이 아니라 표시 전용(phase-2 1.6절 payload는 백엔드가 이미 판정한 값).
 * 접근성: 색만으로 구분하지 않도록 항상 텍스트 라벨을 함께 표기한다.
 */
import type { AlertSeverity, AlertStatus, AlertType } from "@/types/api";

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  do_low: "DO 저하",
  mortality_spike: "폐사 급증",
  kpi_red: "KPI 위험(red)",
};

export const ALERT_SEVERITY_LABEL: Record<AlertSeverity, string> = {
  info: "정보",
  warning: "주의",
  critical: "심각",
};

/** Tailwind 신호등 색 클래스(배경/글자) — severity별. */
export const ALERT_SEVERITY_BADGE_CLASS: Record<AlertSeverity, string> = {
  info: "bg-signal-na-bg text-fg",
  warning: "bg-signal-amber-bg text-signal-amber",
  critical: "bg-signal-red-bg text-signal-red",
};

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  open: "미확인",
  ack: "확인됨",
};

/** payload를 사람이 읽는 문장으로 요약(어떤 지표/값/임계값인지). 필드가 없으면 안전하게 생략. */
export function summarizeAlertPayload(
  type: AlertType,
  payload: Record<string, unknown>,
): string {
  const metric = typeof payload.metric === "string" ? payload.metric : undefined;
  const value = typeof payload.value === "number" ? payload.value : undefined;
  const threshold =
    typeof payload.threshold === "number" ? payload.threshold : undefined;

  const parts: string[] = [];
  if (metric) parts.push(`지표: ${metric}`);
  if (value !== undefined) parts.push(`측정값: ${value}`);
  if (threshold !== undefined) parts.push(`임계값: ${threshold}`);

  if (parts.length === 0) {
    return type === "mortality_spike"
      ? "당일 폐사 개체수가 이동평균 대비 급증했습니다."
      : "판정 근거 상세 정보가 없습니다.";
  }
  return parts.join(" · ");
}
