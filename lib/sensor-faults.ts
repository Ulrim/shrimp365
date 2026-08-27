// 기기가 보낸 센서 오류를 사람 말로 옮긴다.
//
// 장비는 못 읽은 센서마다 err_<키> 를 함께 보낸다(1.7.5+). 값만 빼고 보내면
// 웹에서는 "왜 없는지" 를 알 수 없어 현장에 가 봐야만 원인을 알 수 있었다.
//
// 사유마다 고쳐야 할 곳이 다르므로 뭉뚱그리지 않는다.
//   no_reply   응답 자체가 없음 → 배선·전원·슬레이브 ID
//   probe      통신은 되는데 값이 없음 → 전극 연결·상태
//   do_air:N   센서도 산소가 많다고 함 → 전극이 물 밖
//   do_scale:N/R mg/L 만 어긋남 → 보정
//   supersat:N 물에서 나올 수 없는 값(대조 불가)
//   range:N    값이 허용 범위 밖
import type { Dict } from "@/lib/i18n"

const SENSOR_NAMES: Record<string, string> = {
  ph: "pH", do: "DO", ec: "EC", flow: "유량", dp: "차압",
}

export type SensorFault = { sensor: string; reason: string }

export function readSensorFaults(
  payload: Record<string, unknown> | null | undefined,
  t: Dict,
): SensorFault[] {
  if (!payload) return []
  const out: SensorFault[] = []
  for (const [key, raw] of Object.entries(payload)) {
    if (!key.startsWith("err_") || typeof raw !== "string") continue
    const sensor = SENSOR_NAMES[key.slice(4)] ?? key.slice(4)
    let reason: string
    if (raw === "no_reply") reason = t.waterQualityX.faultNoReply
    else if (raw === "probe") reason = t.waterQualityX.faultProbe
    else if (raw.startsWith("temp_off:")) {
      const [a, b] = raw.slice(9).split("/")
      reason = t.waterQualityX.faultTempOff.replace("{{a}}", a).replace("{{b}}", b ?? "?")
    } else if (raw.startsWith("do_air:")) {
      reason = t.waterQualityX.faultDoAir.replace("{{p}}", raw.slice(7))
    } else if (raw.startsWith("do_scale:")) {
      const [p2, r2] = raw.slice(9).split("/")
      reason = t.waterQualityX.faultDoScale.replace("{{p}}", p2).replace("{{r}}", r2 ?? "?")
    } else if (raw.startsWith("supersat:")) {
      reason = t.waterQualityX.faultSupersat.replace("{{p}}", raw.slice(9))
    } else if (raw.startsWith("range:")) {
      reason = t.waterQualityX.faultRange.replace("{{v}}", raw.slice(6))
    } else reason = raw
    out.push({ sensor, reason })
  }
  return out
}
