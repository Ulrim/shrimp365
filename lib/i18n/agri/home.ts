// 농업(스마트팜) 사전 — home 섹션. 4개 언어를 한 파일에 둔다(설계서 mode-split.md 6장).
//
// `/daumlabs/home`(components/agri/agri-home-view.tsx) 전용 문구. 상태 라벨(정상·주의·
// 위험)과 농장 0개 빈 상태·다시 시도 같은 공통 문구는 common 섹션에 있다 — 여기 다시
// 만들지 않는다. 자리표시자는 기존 관례 `{{name}}` `{{count}}`.
import type { Locale } from "@/lib/i18n"

export interface AgriHomeDict {
  /** 인사 — `{{name}}` 은 사용자 이름(첫 단어). */
  greeting: string
  greetingSubtitle: string
  /** 현황 카드 제목(region aria-label 겸용). */
  bedsToday: string
  /** 베드 0개 카드 문구. */
  noBeds: string
  noBedsAria: string
  /** 현황 카드 하단 알림 링크 — `{{count}}` 건. */
  unresolvedAlerts: string
  unresolvedAlertsCta: string
  unresolvedAlertsAria: string
  /** 큰 카드 — 기록. */
  recordCard: string
  recordCardSub: string
  recordCardAria: string
  /** 큰 카드 — 모니터링. */
  monitorCard: string
  monitorCardSub: string
  monitorCardAria: string
  loadingAria: string
}

export const agriHome: Record<Locale, AgriHomeDict> = {
  ko: {
    greeting: "안녕하세요, {{name}}님!",
    greetingSubtitle: "오늘도 건강한 작물을 위해 시작해볼까요?",
    bedsToday: "오늘 베드 현황",
    noBeds: "등록된 베드가 없습니다.",
    noBedsAria: "베드 정보 없음",
    unresolvedAlerts: "미처리 알림 {{count}}건",
    unresolvedAlertsCta: "— 모니터링에서 확인",
    unresolvedAlertsAria: "미처리 알림 {{count}}건, 모니터링으로 이동",
    recordCard: "오늘 기록하기",
    recordCardSub: "측정값·영농 일지 입력",
    recordCardAria: "측정값·영농 일지 입력 페이지로 이동",
    monitorCard: "현황 보기",
    monitorCardSub: "양액·알림·통계 확인",
    monitorCardAria: "양액·알림·통계 모니터링으로 이동",
    loadingAria: "베드 현황 불러오는 중",
  },
  en: {
    greeting: "Hello, {{name}}!",
    greetingSubtitle: "Ready for another day of healthy crops?",
    bedsToday: "Beds today",
    noBeds: "No beds registered yet.",
    noBedsAria: "No bed information",
    unresolvedAlerts: "{{count}} open alerts",
    unresolvedAlertsCta: "— review in Monitoring",
    unresolvedAlertsAria: "{{count}} open alerts, go to Monitoring",
    recordCard: "Log today",
    recordCardSub: "Readings & farm journal",
    recordCardAria: "Go to readings and journal entry",
    monitorCard: "View status",
    monitorCardSub: "Nutrient, alerts & stats",
    monitorCardAria: "Go to monitoring",
    loadingAria: "Loading bed status",
  },
  vi: {
    greeting: "Xin chào, {{name}}!",
    greetingSubtitle: "Sẵn sàng cho một ngày cây trồng khỏe mạnh?",
    bedsToday: "Luống hôm nay",
    noBeds: "Chưa có luống nào được đăng ký.",
    noBedsAria: "Không có thông tin luống",
    unresolvedAlerts: "{{count}} cảnh báo chưa xử lý",
    unresolvedAlertsCta: "— xem trong Giám sát",
    unresolvedAlertsAria: "{{count}} cảnh báo chưa xử lý, đi tới Giám sát",
    recordCard: "Ghi chép hôm nay",
    recordCardSub: "Số đo & nhật ký canh tác",
    recordCardAria: "Đi tới trang ghi số đo và nhật ký",
    monitorCard: "Xem tình trạng",
    monitorCardSub: "Dinh dưỡng, cảnh báo & thống kê",
    monitorCardAria: "Đi tới giám sát",
    loadingAria: "Đang tải tình trạng luống",
  },
  id: {
    greeting: "Halo, {{name}}!",
    greetingSubtitle: "Siap untuk hari lain dengan tanaman sehat?",
    bedsToday: "Bedeng hari ini",
    noBeds: "Belum ada bedeng terdaftar.",
    noBedsAria: "Tidak ada informasi bedeng",
    unresolvedAlerts: "{{count}} peringatan belum ditangani",
    unresolvedAlertsCta: "— tinjau di Pemantauan",
    unresolvedAlertsAria: "{{count}} peringatan belum ditangani, buka Pemantauan",
    recordCard: "Catat hari ini",
    recordCardSub: "Pengukuran & jurnal tani",
    recordCardAria: "Buka halaman pengukuran dan jurnal",
    monitorCard: "Lihat status",
    monitorCardSub: "Nutrisi, peringatan & statistik",
    monitorCardAria: "Buka pemantauan",
    loadingAria: "Memuat status bedeng",
  },
}
