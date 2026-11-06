// 조치(device + command) → 농가 말 키. OFDF `dashboard/plain.js` 의 PLAIN_ACTION 표를 옮겼다.
//
// 엣지는 조치를 OFDF 어휘("야간피복 야간 피복 전개")로 보낸다. 패널(kiosk.html)이 그것을
// "비닐·부직포 덮기"로 바꿔 보여 주듯 Farm365 도 같은 표로 바꾼다 — 문구는 사전
// (lib/i18n/agri/openfield.ts action.*)에 있고, 여기는 **어느 문구인가**만 정한다.
// 설계서 예시의 영문 토큰(cover/close 등)도 같은 키로 받아 둔다.
import type { FieldActionKey } from "@/lib/i18n/agri/openfield"
import type { FieldRiskAction } from "@/types"

const TABLE: ReadonlyArray<readonly [RegExp, FieldActionKey]> = [
  [/야간피복.*전개|피복 전개|cover\s+(close|deploy|on)/i, "coverDeploy"],
  [/피복 준비|cover\s+(prepare|ready)/i, "coverPrepare"],
  [/야간·새벽 관수 금지|irrigation\s+(night_off|no_night)/i, "noNightIrrigation"],
  [/관수 금지|관수 중단|관수 즉시 중단|irrigation\s+(stop|off|close)/i, "stopIrrigation"],
  [/관수 준비·실행|irrigation\s+(start|on|open)/i, "irrigate"],
  [/살수.*금지|살수.*중단|살수.*중지|mist\s+(stop|off)/i, "mistOff"],
  [/차광 한정 전개|shade\s+(deploy|close|on)/i, "shadeDeploy"],
  [/차광 회수|차광막·피복.*회수|shade\s+(retract|open|off)/i, "shadeRetract"],
  [/전개 금지|deploy_forbidden|no_deploy/i, "noDeploy"],
  [/서리 경보|frost_check/i, "frostCheck"],
  [/배수로·고랑 확인|배수 상태 확인|drain/i, "drainage"],
  [/예찰·방제 준비|방제 준비|방제 일정|spray/i, "sprayPrep"],
  [/구동 잠금|전원 차단|정지·경보|halt|power_off|interlock/i, "machineHalt"],
  [/독립운전|offline|standalone/i, "offline"],
]

export type PlainAction =
  | { kind: "key"; key: FieldActionKey }
  /** 표에 없는 조치 — 엣지가 보낸 말 그대로. */
  | { kind: "raw"; what: string; why: string }

/** 표에 없는 "알림" 장치의 조치는 할 일이 아니다 — 이 카드 자체가 그 알림이라 null. */
export function plainAction(a: FieldRiskAction): PlainAction | null {
  const text = `${a.device} ${a.command}`
  for (const [re, key] of TABLE) if (re.test(text)) return { kind: "key", key }
  if (a.device === "알림" || /^(alert|notify)$/i.test(a.device)) return null
  return { kind: "raw", what: text, why: a.reason ?? "" }
}

/** 구동부가 없어 사람이 직접 해야 하는 조치(엣지가 reason 에 "구동부 미설치"라고 적는다). */
export const isByHand = (a: FieldRiskAction) => /구동부 미설치|no actuator/i.test(a.reason ?? "")
