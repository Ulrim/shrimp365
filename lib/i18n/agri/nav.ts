// 농업(스마트팜) 사전 — nav 섹션. 4개 언어를 한 파일에 둔다(설계서 mode-split.md 6장).
//
// 사이드바·하단 메뉴 라벨, 헤더 제목(경로 → 라벨), 로고 태그라인. 농업 모드 셸
// (sidebar.tsx · bottom-nav.tsx · header.tsx)이 `useAgriT().nav` 로 읽는다.
import type { Locale } from "@/lib/i18n"

export interface AgriNavDict {
  /** `/daumlabs/home` */
  home: string
  /** `/daumlabs/record` — 기록 허브. 사이드바 "기록" 섹션 제목으로도 쓴다. */
  record: string
  /** `/daumlabs/record/water-quality` — 측정 기록. */
  recordMeasure: string
  /** `/daumlabs/record/journal` — 영농 일지 쓰기. */
  recordJournal: string
  /** `/daumlabs/dashboard` — 모니터링. */
  dashboard: string
  /** `/daumlabs/water-quality` — 양액 관리. */
  nutrient: string
  /** `/daumlabs/journal` — 영농 일지 목록. */
  journal: string
  /** `/daumlabs/farms` — 농장·기기 관리. */
  farms: string
  /** 사이드바 섹션 제목 — 기록. */
  sectionRecord: string
  /** 사이드바 섹션 제목 — 모니터링. */
  sectionMonitor: string
  /** 로고 부제 — 언어 무관 영문 고정. 노지 베드까지 품으므로 HYDROPONICS 가 아니라 FARMING(openfield-merge.md 1-3). */
  brandTagline: string
  /** 하단 네비 다섯째 탭. */
  more: string
  /** 메뉴 하단의 관리자 콘솔(/admin) 링크 — manager 이상에게만 보인다. */
  adminConsole: string
}

export const agriNav: Record<Locale, AgriNavDict> = {
  ko: {
    home: "홈",
    record: "기록",
    recordMeasure: "측정 기록",
    recordJournal: "영농 일지",
    dashboard: "모니터링",
    nutrient: "양액 관리",
    journal: "영농 일지",
    farms: "농장·기기 관리",
    sectionRecord: "기록",
    sectionMonitor: "모니터링",
    brandTagline: "SMART FARMING",
    more: "더보기",
    adminConsole: "관리자 콘솔",
  },
  en: {
    home: "Home",
    record: "Record",
    recordMeasure: "Measurements",
    recordJournal: "Farm journal",
    dashboard: "Monitoring",
    nutrient: "Nutrient solution",
    journal: "Farm journal",
    farms: "Farms & devices",
    sectionRecord: "Record",
    sectionMonitor: "Monitor",
    brandTagline: "SMART FARMING",
    more: "More",
    adminConsole: "Admin console",
  },
  vi: {
    home: "Trang chủ",
    record: "Ghi chép",
    recordMeasure: "Ghi số đo",
    recordJournal: "Nhật ký canh tác",
    dashboard: "Giám sát",
    nutrient: "Dung dịch dinh dưỡng",
    journal: "Nhật ký canh tác",
    farms: "Nông trại & thiết bị",
    sectionRecord: "Ghi chép",
    sectionMonitor: "Giám sát",
    brandTagline: "SMART FARMING",
    more: "Thêm",
    adminConsole: "Bảng quản trị",
  },
  id: {
    home: "Beranda",
    record: "Catat",
    recordMeasure: "Catatan pengukuran",
    recordJournal: "Jurnal tani",
    dashboard: "Pemantauan",
    nutrient: "Larutan nutrisi",
    journal: "Jurnal tani",
    farms: "Kebun & perangkat",
    sectionRecord: "Pencatatan",
    sectionMonitor: "Pemantauan",
    brandTagline: "SMART FARMING",
    more: "Lainnya",
    adminConsole: "Konsol admin",
  },
}
