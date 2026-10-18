// 전력 카드 사전 — 양식장(Shrimp365)·스마트팜(Farm365) 대시보드가 함께 쓴다. 4개 언어.
//
// 종류 이름은 장비 화면(raspberry-pi/webui.py pwt_*)과 같은 말이다 — 분전반 앞에서 본 이름을
// 휴대폰에서 다른 말로 읽지 않게. 자리표시자는 `{{name}}` `{{ago}}` `{{t}}`.
import type { Locale } from "@/lib/i18n"
import type { PowerType } from "@/lib/power"

export interface PowerDict {
  title: string
  /** 베드·수조 이름이 붙은 제목 — `{{name}}` */
  titleFor: string
  now: string
  nowPartial: string
  today: string
  updated: string
  on: string
  off: string
  lost: string
  /** 30분 넘게 새 값이 없을 때 */
  stale: string
  /** 과열 띠 — `{{name}}` `{{t}}` */
  hotWarn: string
  hotCrit: string
  hotDo: string
  colPower: string
  colToday: string
  colTemp: string
  type: Record<PowerType, string>
}

export const powerDict: Record<Locale, PowerDict> = {
  ko: {
    title: "전력", titleFor: "전력 · {{name}}",
    now: "지금", nowPartial: "계측 회로 합", today: "오늘 사용", updated: "{{ago}} 수신",
    on: "켜짐", off: "꺼짐", lost: "끊김",
    stale: "30분 넘게 새 값이 없습니다 — 장비의 지그비 수집기와 차단기를 확인하세요.",
    hotWarn: "차단기 온도 높음 — {{name}} {{t}}℃", hotCrit: "차단기 과열 — {{name}} {{t}}℃",
    hotDo: "부하·단자 조임을 점검하세요.",
    colPower: "전력", colToday: "오늘", colTemp: "차단기",
    type: {
      main: "전체(인입)", aerator: "산소공급기·브로워", circulation_pump: "순환펌프", irrigation_pump: "관수펌프",
      heater: "히터·난방", ventilation: "환기팬", cooling: "냉방·제습", lighting: "조명·보광", uv: "UV 살균기",
      dosing: "양액 도징펌프", feeder: "자동급이기", other: "기타",
    },
  },
  en: {
    title: "Power", titleFor: "Power · {{name}}",
    now: "Now", nowPartial: "Metered sum", today: "Used today", updated: "updated {{ago}}",
    on: "ON", off: "OFF", lost: "No signal",
    stale: "No new values for over 30 minutes — check the device's Zigbee collector and breakers.",
    hotWarn: "Breaker running hot — {{name}} {{t}}℃", hotCrit: "Breaker overheating — {{name}} {{t}}℃",
    hotDo: "Check the load and terminal tightness.",
    colPower: "Power", colToday: "Today", colTemp: "Breaker",
    type: {
      main: "Main incomer", aerator: "Aerator / blower", circulation_pump: "Circulation pump", irrigation_pump: "Irrigation pump",
      heater: "Heater", ventilation: "Ventilation fan", cooling: "Cooling / dehumidifier", lighting: "Lighting", uv: "UV sterilizer",
      dosing: "Dosing pump", feeder: "Auto feeder", other: "Other",
    },
  },
  vi: {
    title: "Điện năng", titleFor: "Điện năng · {{name}}",
    now: "Hiện tại", nowPartial: "Tổng đo được", today: "Hôm nay", updated: "cập nhật {{ago}}",
    on: "BẬT", off: "TẮT", lost: "Mất tín hiệu",
    stale: "Hơn 30 phút không có giá trị mới — kiểm tra bộ thu Zigbee và aptomat của thiết bị.",
    hotWarn: "Aptomat nóng — {{name}} {{t}}℃", hotCrit: "Aptomat quá nhiệt — {{name}} {{t}}℃",
    hotDo: "Kiểm tra tải và độ chặt đầu nối.",
    colPower: "Công suất", colToday: "Hôm nay", colTemp: "Aptomat",
    type: {
      main: "Tổng (đầu vào)", aerator: "Máy sục khí", circulation_pump: "Bơm tuần hoàn", irrigation_pump: "Bơm tưới",
      heater: "Máy sưởi", ventilation: "Quạt thông gió", cooling: "Làm mát / hút ẩm", lighting: "Chiếu sáng", uv: "Đèn UV",
      dosing: "Bơm định lượng", feeder: "Máy cho ăn", other: "Khác",
    },
  },
  id: {
    title: "Listrik", titleFor: "Listrik · {{name}}",
    now: "Sekarang", nowPartial: "Jumlah terukur", today: "Hari ini", updated: "diperbarui {{ago}}",
    on: "NYALA", off: "MATI", lost: "Terputus",
    stale: "Tidak ada nilai baru lebih dari 30 menit — periksa kolektor Zigbee dan pemutus perangkat.",
    hotWarn: "Pemutus panas — {{name}} {{t}}℃", hotCrit: "Pemutus terlalu panas — {{name}} {{t}}℃",
    hotDo: "Periksa beban dan kekencangan terminal.",
    colPower: "Daya", colToday: "Hari ini", colTemp: "Pemutus",
    type: {
      main: "Utama (masuk)", aerator: "Aerator / blower", circulation_pump: "Pompa sirkulasi", irrigation_pump: "Pompa irigasi",
      heater: "Pemanas", ventilation: "Kipas ventilasi", cooling: "Pendingin / dehumidifier", lighting: "Pencahayaan", uv: "Sterilisator UV",
      dosing: "Pompa dosis", feeder: "Pemberi pakan", other: "Lainnya",
    },
  },
}
