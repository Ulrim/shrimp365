// 관수 밸브 카드 사전 — 4개 언어. 자리표시자는 `{{name}}` `{{ago}}`.
import type { Locale } from "@/lib/i18n"

export interface IrrigationDict {
  titleFor: string
  today: string
  flowNow: string
  updated: string
  open: string
  closed: string
  lost: string
  note: string
}

export const irrigationDict: Record<Locale, IrrigationDict> = {
  ko: {
    titleFor: "관수 · {{name}}", today: "오늘 사용량", flowNow: "지금 유량", updated: "{{ago}} 수신",
    open: "열림", closed: "닫힘", lost: "끊김", note: "관수할 때만 흐릅니다 — 유량 0 은 닫힌 상태입니다.",
  },
  en: {
    titleFor: "Irrigation · {{name}}", today: "Used today", flowNow: "Flow now", updated: "updated {{ago}}",
    open: "Open", closed: "Closed", lost: "No signal", note: "Water flows only while irrigating — 0 flow means closed.",
  },
  vi: {
    titleFor: "Tưới · {{name}}", today: "Đã dùng hôm nay", flowNow: "Lưu lượng hiện tại", updated: "cập nhật {{ago}}",
    open: "Mở", closed: "Đóng", lost: "Mất tín hiệu", note: "Chỉ chảy khi tưới — lưu lượng 0 nghĩa là van đóng.",
  },
  id: {
    titleFor: "Irigasi · {{name}}", today: "Terpakai hari ini", flowNow: "Debit sekarang", updated: "diperbarui {{ago}}",
    open: "Buka", closed: "Tutup", lost: "Terputus", note: "Air hanya mengalir saat irigasi — debit 0 berarti tertutup.",
  },
}
