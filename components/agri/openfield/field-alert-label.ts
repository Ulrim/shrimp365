// alerts.parameter `field:<risk>` → 화면 이름표.
//
// 수질 알림은 parameter 가 "수온"·"EC" 같은 이름이라 alertDisplayLabel 이 번역하지만, 노지
// 재해위험 알림은 **키**("field:frost")로 저장된다(설계서 4-2). 농업 알림 목록 두 곳
// (agri-dashboard-view · agri-nutrient-view)이 이 한 줄로 분기한다.
import { FIELD_ALERT_PREFIX, type AgriOpenfieldDict } from "@/lib/i18n/agri/openfield"
import type { FieldRiskType } from "@/types"

export function isFieldAlert(parameter: string | null | undefined): boolean {
  return typeof parameter === "string" && parameter.startsWith(FIELD_ALERT_PREFIX)
}

/** "field:frost" → "노지 · 추위·서리". 모르는 risk 면 키를 그대로 돌려준다(숨기지 않는다). */
export function fieldAlertLabel(parameter: string, d: AgriOpenfieldDict): string {
  const risk = parameter.slice(FIELD_ALERT_PREFIX.length) as FieldRiskType
  const name = d.risk[risk]
  return name ? d.alertLabel.replace("{{risk}}", name) : parameter
}
