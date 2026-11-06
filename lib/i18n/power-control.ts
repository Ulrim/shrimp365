// 전력 카드의 켜고 끄기·예약 사전 — 4개 언어. 모드 이름은 장비 화면(webui.py pc_*)과 같은 말이다.
// 자리표시자는 `{{m}}` `{{t}}` `{{e}}` `{{v}}`.
import type { Locale } from "@/lib/i18n"
import type { PowerMode } from "@/lib/power-remote"

export interface PowerControlDict {
  turnOn: string
  turnOff: string
  auto: string
  keep: string
  keepAlways: string
  minutes: string
  mode: Record<PowerMode, string>
  override: string
  overrideUntil: string
  schedOn: string
  schedOff: string
  doForced: string
  editRule: string
  save: string
  cancel: string
  onAt: string
  offAt: string
  days: string
  dayNames: string[]
  addTimer: string
  remove: string
  cycleOn: string
  cycleOff: string
  from: string
  to: string
  doOnBelow: string
  doOffAbove: string
  doMinOn: string
  autoOff: string
  guard: string
  ruleNote: string
  confirmOff: string
  sending: string
  done: string
  failed: string
  expired: string
  offline: string
  clockBad: string
  deviceSays: string
  doNow: string
  errors: Record<string, string>
}

export const powerControlDict: Record<Locale, PowerControlDict> = {
  ko: {
    turnOn: "켜기", turnOff: "끄기", auto: "예약대로",
    keep: "유지", keepAlways: "계속", minutes: "{{m}}분",
    mode: { manual: "수동", timer: "시간 예약", cycle: "반복 간격", do: "산소량 연동" },
    override: "손 조작 중", overrideUntil: "손 조작 중 — {{t}}까지",
    schedOn: "예약상 켜짐", schedOff: "예약상 꺼짐", doForced: "산소 부족 — 강제로 켜 둠",
    editRule: "예약 설정", save: "장비에 저장", cancel: "취소",
    onAt: "켜는 시각", offAt: "끄는 시각", days: "요일",
    dayNames: ["월", "화", "수", "목", "금", "토", "일"],
    addTimer: "예약 추가", remove: "삭제",
    cycleOn: "켜 둘 시간(분)", cycleOff: "쉴 시간(분)", from: "가동 시작", to: "가동 끝",
    doOnBelow: "이 아래면 켬 (mg/L)", doOffAbove: "이 위면 끔 (mg/L)", doMinOn: "한 번 켜면 최소(분)",
    autoOff: "손으로 켜면 자동 끄기(분, 0 = 안 함)", guard: "산소 부족 강제 켜기 (mg/L, 0 = 안 함)",
    ruleNote: "예약은 장비가 지킵니다 — 인터넷이 끊겨도 그대로 돕니다.",
    confirmOff: "산소공급기를 끕니다. 산소가 부족해지면 장비가 다시 켭니다. 끌까요?",
    sending: "장비로 보내는 중… (최대 20초)", done: "장비가 실행했습니다", failed: "장비가 거절했습니다: {{e}}",
    expired: "장비가 명령을 가져가지 않았습니다 — 장비의 인터넷 연결을 확인하세요",
    offline: "장비가 원격 제어에 연결돼 있지 않습니다 — 장비가 꺼졌거나 인터넷이 끊겼거나, 장비 업데이트(1.9.8 이상)가 필요합니다.",
    clockBad: "장비 시계가 맞지 않아 예약이 멈춰 있습니다(인터넷 연결 후 자동으로 맞춰집니다).",
    deviceSays: "장비: {{e}}", doNow: "지금 산소 {{v}} mg/L",
    errors: {
      login: "로그인이 필요합니다.", owner: "농장 주인만 켜고 끌 수 있습니다.", tooMany: "너무 자주 눌렀습니다. 잠시 뒤 다시 하세요.",
      offline: "장비가 원격 제어에 연결돼 있지 않습니다.", cannot: "이 회로는 원격으로 켜고 끌 수 없습니다(인입 회로이거나 차단기를 찾지 못함).",
      noDevice: "이 수조에 붙은 장비를 찾지 못했습니다.", notReady: "서버 준비가 끝나지 않았습니다(power_remote.sql 실행 필요).",
      minutes: "시간은 1~1440분입니다.", time: "시각을 확인하세요(켜는·끄는 시각이 같으면 안 됩니다).", days: "요일을 하나 이상 고르세요.",
      timers: "예약은 1~6개입니다.", cycle: "켜 둘·쉴 시간은 1~720분입니다.", doRange: "끄는 기준이 켜는 기준보다 높아야 합니다(0.5~20).",
      autoOff: "자동 끄기는 0~1440분입니다.", guard: "산소 부족 기준은 0.5~15 mg/L 입니다(0 = 안 함).",
      bad: "요청이 올바르지 않습니다.", server: "서버 오류입니다. 잠시 뒤 다시 하세요.", network: "인터넷 연결을 확인하세요.",
    },
  },
  en: {
    turnOn: "On", turnOff: "Off", auto: "Follow schedule",
    keep: "Hold", keepAlways: "Until changed", minutes: "{{m}} min",
    mode: { manual: "Manual", timer: "Time schedule", cycle: "Repeat cycle", do: "Oxygen-linked" },
    override: "Manual override", overrideUntil: "Manual override — until {{t}}",
    schedOn: "Scheduled ON", schedOff: "Scheduled OFF", doForced: "Low oxygen — forced ON",
    editRule: "Schedule", save: "Save to device", cancel: "Cancel",
    onAt: "On at", offAt: "Off at", days: "Days",
    dayNames: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    addTimer: "Add slot", remove: "Remove",
    cycleOn: "On for (min)", cycleOff: "Rest for (min)", from: "Active from", to: "Active until",
    doOnBelow: "Turn on below (mg/L)", doOffAbove: "Turn off above (mg/L)", doMinOn: "Minimum run (min)",
    autoOff: "Auto-off after manual ON (min, 0 = never)", guard: "Force ON when oxygen below (mg/L, 0 = off)",
    ruleNote: "The device keeps the schedule — it keeps running even without internet.",
    confirmOff: "Turn the aerator off? The device will turn it back on if oxygen gets low.",
    sending: "Sending to device… (up to 20 s)", done: "Device carried it out", failed: "Device refused: {{e}}",
    expired: "The device did not pick up the command — check its internet connection",
    offline: "The device is not connected for remote control — it may be off, offline, or need an update (1.9.8+).",
    clockBad: "The device clock is wrong, so schedules are paused (it fixes itself once online).",
    deviceSays: "Device: {{e}}", doNow: "Oxygen now {{v}} mg/L",
    errors: {
      login: "Please sign in.", owner: "Only the farm owner can switch circuits.", tooMany: "Too many presses. Try again shortly.",
      offline: "The device is not connected for remote control.", cannot: "This circuit can't be switched remotely (main incomer or breaker not found).",
      noDevice: "No device found for this tank.", notReady: "Server setup incomplete (run power_remote.sql).",
      minutes: "Duration must be 1–1440 min.", time: "Check the times (on and off can't be equal).", days: "Pick at least one day.",
      timers: "1–6 schedule slots.", cycle: "On/rest must be 1–720 min.", doRange: "Off level must be above on level (0.5–20).",
      autoOff: "Auto-off must be 0–1440 min.", guard: "Oxygen guard must be 0.5–15 mg/L (0 = off).",
      bad: "Invalid request.", server: "Server error. Try again shortly.", network: "Check your internet connection.",
    },
  },
  vi: {
    turnOn: "Bật", turnOff: "Tắt", auto: "Theo lịch",
    keep: "Giữ", keepAlways: "Đến khi đổi", minutes: "{{m}} phút",
    mode: { manual: "Thủ công", timer: "Hẹn giờ", cycle: "Chu kỳ lặp", do: "Theo oxy" },
    override: "Đang điều khiển tay", overrideUntil: "Đang điều khiển tay — đến {{t}}",
    schedOn: "Lịch: BẬT", schedOff: "Lịch: TẮT", doForced: "Thiếu oxy — buộc BẬT",
    editRule: "Lịch hẹn", save: "Lưu vào thiết bị", cancel: "Hủy",
    onAt: "Giờ bật", offAt: "Giờ tắt", days: "Ngày",
    dayNames: ["T2", "T3", "T4", "T5", "T6", "T7", "CN"],
    addTimer: "Thêm lịch", remove: "Xóa",
    cycleOn: "Bật trong (phút)", cycleOff: "Nghỉ trong (phút)", from: "Chạy từ", to: "Chạy đến",
    doOnBelow: "Bật khi dưới (mg/L)", doOffAbove: "Tắt khi trên (mg/L)", doMinOn: "Chạy tối thiểu (phút)",
    autoOff: "Tự tắt sau khi bật tay (phút, 0 = không)", guard: "Buộc bật khi oxy dưới (mg/L, 0 = không)",
    ruleNote: "Thiết bị tự giữ lịch — vẫn chạy khi mất internet.",
    confirmOff: "Tắt máy sục khí? Thiết bị sẽ bật lại nếu oxy xuống thấp.",
    sending: "Đang gửi đến thiết bị… (tối đa 20 giây)", done: "Thiết bị đã thực hiện", failed: "Thiết bị từ chối: {{e}}",
    expired: "Thiết bị không nhận lệnh — kiểm tra kết nối internet của thiết bị",
    offline: "Thiết bị chưa kết nối điều khiển từ xa — có thể đang tắt, mất mạng hoặc cần cập nhật (1.9.8+).",
    clockBad: "Đồng hồ thiết bị sai nên lịch tạm dừng (tự chỉnh khi có internet).",
    deviceSays: "Thiết bị: {{e}}", doNow: "Oxy hiện tại {{v}} mg/L",
    errors: {
      login: "Vui lòng đăng nhập.", owner: "Chỉ chủ trại mới bật/tắt được.", tooMany: "Bấm quá nhiều. Thử lại sau.",
      offline: "Thiết bị chưa kết nối điều khiển từ xa.", cannot: "Mạch này không điều khiển từ xa được (mạch tổng hoặc không thấy aptomat).",
      noDevice: "Không tìm thấy thiết bị của bể này.", notReady: "Máy chủ chưa sẵn sàng (cần chạy power_remote.sql).",
      minutes: "Thời gian 1–1440 phút.", time: "Kiểm tra giờ (giờ bật và tắt không được trùng).", days: "Chọn ít nhất một ngày.",
      timers: "1–6 lịch.", cycle: "Bật/nghỉ 1–720 phút.", doRange: "Mức tắt phải cao hơn mức bật (0,5–20).",
      autoOff: "Tự tắt 0–1440 phút.", guard: "Ngưỡng oxy 0,5–15 mg/L (0 = không).",
      bad: "Yêu cầu không hợp lệ.", server: "Lỗi máy chủ. Thử lại sau.", network: "Kiểm tra kết nối internet.",
    },
  },
  id: {
    turnOn: "Nyalakan", turnOff: "Matikan", auto: "Ikuti jadwal",
    keep: "Tahan", keepAlways: "Sampai diubah", minutes: "{{m}} mnt",
    mode: { manual: "Manual", timer: "Jadwal waktu", cycle: "Siklus berulang", do: "Mengikuti oksigen" },
    override: "Kendali manual", overrideUntil: "Kendali manual — sampai {{t}}",
    schedOn: "Jadwal: NYALA", schedOff: "Jadwal: MATI", doForced: "Oksigen rendah — dipaksa NYALA",
    editRule: "Jadwal", save: "Simpan ke perangkat", cancel: "Batal",
    onAt: "Nyala pukul", offAt: "Mati pukul", days: "Hari",
    dayNames: ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"],
    addTimer: "Tambah jadwal", remove: "Hapus",
    cycleOn: "Nyala selama (mnt)", cycleOff: "Istirahat (mnt)", from: "Aktif dari", to: "Aktif sampai",
    doOnBelow: "Nyala di bawah (mg/L)", doOffAbove: "Mati di atas (mg/L)", doMinOn: "Jalan minimum (mnt)",
    autoOff: "Mati otomatis setelah nyala manual (mnt, 0 = tidak)", guard: "Paksa nyala bila oksigen di bawah (mg/L, 0 = tidak)",
    ruleNote: "Perangkat menjalankan jadwal sendiri — tetap jalan tanpa internet.",
    confirmOff: "Matikan aerator? Perangkat akan menyalakannya lagi bila oksigen rendah.",
    sending: "Mengirim ke perangkat… (hingga 20 dtk)", done: "Perangkat sudah menjalankan", failed: "Perangkat menolak: {{e}}",
    expired: "Perangkat tidak mengambil perintah — periksa koneksi internetnya",
    offline: "Perangkat belum terhubung untuk kendali jarak jauh — mungkin mati, offline, atau perlu pembaruan (1.9.8+).",
    clockBad: "Jam perangkat salah sehingga jadwal berhenti (akan benar sendiri saat online).",
    deviceSays: "Perangkat: {{e}}", doNow: "Oksigen sekarang {{v}} mg/L",
    errors: {
      login: "Silakan masuk.", owner: "Hanya pemilik tambak yang bisa menyalakan/mematikan.", tooMany: "Terlalu sering. Coba lagi sebentar.",
      offline: "Perangkat belum terhubung untuk kendali jarak jauh.", cannot: "Sirkuit ini tidak bisa dikendalikan dari jauh (sirkuit utama atau pemutus tidak ditemukan).",
      noDevice: "Perangkat kolam ini tidak ditemukan.", notReady: "Server belum siap (jalankan power_remote.sql).",
      minutes: "Durasi 1–1440 mnt.", time: "Periksa waktu (nyala dan mati tidak boleh sama).", days: "Pilih minimal satu hari.",
      timers: "1–6 jadwal.", cycle: "Nyala/istirahat 1–720 mnt.", doRange: "Batas mati harus di atas batas nyala (0,5–20).",
      autoOff: "Mati otomatis 0–1440 mnt.", guard: "Batas oksigen 0,5–15 mg/L (0 = tidak).",
      bad: "Permintaan tidak valid.", server: "Kesalahan server. Coba lagi sebentar.", network: "Periksa koneksi internet.",
    },
  },
}
