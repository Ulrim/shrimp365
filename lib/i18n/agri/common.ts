// 농업(스마트팜) 사전 — common 섹션. 4개 언어를 한 파일에 둔다(설계서 mode-split.md 6장).
//
// 모드 라벨(전환 스위치), 베드·농장 공통 어휘, 상태 라벨, 6개 측정 항목 이름·단위,
// 로딩·오류·빈 상태 공통 문구. 저장·취소·날짜 같은 범용 UI 문구는 여기 두지 않고
// 기존 `useT().t.common / t.time` 을 그대로 쓴다 — 중복 번역 금지.
//
// 어휘 원칙: ko 는 농업 용어(베드·양액·정식·EC), en 은 hydroponics 어휘(bed,
// nutrient solution, transplant), vi/id 는 en 기준 번역. 수조·염도·입식 같은
// 새우 어휘는 쓰지 않는다.
import type { Locale } from "@/lib/i18n"

export interface AgriCommonDict {
  /** 전환 스위치 — 왼쪽 칸(새우 양식 화면). */
  modeShrimp: string
  /** 전환 스위치 — 오른쪽 칸(스마트팜 화면). */
  modeAgri: string
  /** 스위치 `role="group"` 의 aria-label. */
  modeSwitchAria: string
  /** 설정 패널 계정 탭 — "기본 화면" 라벨. */
  defaultScreenLabel: string
  /** 설정 패널 계정 탭 — 라벨 아래 한 줄 설명. */
  defaultScreenHint: string

  bed: string
  beds: string
  farm: string

  /** 베드·항목 상태 라벨. 키는 `lib/agri-standards.ts` 의 AgriStatusLevel 과 1:1. */
  status: {
    normal: string
    warning: string
    danger: string
    notMeasured: string
    noStandard: string
  }

  /** 6개 측정 항목 이름. 키는 `lib/agri-params.ts` 의 dictKey. */
  param: {
    ec: string
    ph: string
    temperature: string
    do: string
    flowRate: string
    diffPressure: string
  }

  /** 항목 단위(화면 표기). 언어 무관 기호지만 사전에 두어 한 곳에서 읽게 한다. */
  unit: {
    ec: string
    ph: string
    temperature: string
    do: string
    flowRate: string
    diffPressure: string
  }

  loading: string
  retry: string
  loadErrorTitle: string
  loadErrorMsg: string
  noFarmsTitle: string
  noFarmsMsg: string
  registerFarm: string
  selectBed: string
  allBeds: string
  noData: string
}

const UNITS: AgriCommonDict["unit"] = {
  ec: "mS/cm",
  ph: "",
  temperature: "°C",
  do: "ppm",
  flowRate: "L/min",
  diffPressure: "kPa",
}

export const agriCommon: Record<Locale, AgriCommonDict> = {
  ko: {
    modeShrimp: "양식장",
    modeAgri: "스마트팜",
    modeSwitchAria: "화면 모드 전환",
    defaultScreenLabel: "기본 화면",
    defaultScreenHint: "로그인하면 이 화면으로 시작합니다.",
    bed: "베드",
    beds: "베드",
    farm: "농장",
    status: {
      normal: "정상",
      warning: "주의",
      danger: "위험",
      notMeasured: "미측정",
      noStandard: "기준 없음",
    },
    param: {
      ec: "EC",
      ph: "pH",
      temperature: "양액 온도",
      do: "용존산소(DO)",
      flowRate: "유량",
      diffPressure: "차압",
    },
    unit: UNITS,
    loading: "불러오는 중…",
    retry: "다시 시도",
    loadErrorTitle: "데이터를 불러오지 못했습니다",
    loadErrorMsg: "네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
    noFarmsTitle: "등록된 농장이 없습니다",
    noFarmsMsg: "농장과 베드를 등록하면 측정과 모니터링을 시작할 수 있습니다.",
    registerFarm: "농장 등록하기",
    selectBed: "베드를 선택하세요",
    allBeds: "베드 전체",
    noData: "측정 데이터가 없습니다",
  },
  en: {
    modeShrimp: "Shrimp farm",
    modeAgri: "Smart farm",
    modeSwitchAria: "Switch screen mode",
    defaultScreenLabel: "Default screen",
    defaultScreenHint: "You will start on this screen after signing in.",
    bed: "Bed",
    beds: "Beds",
    farm: "Farm",
    status: {
      normal: "Normal",
      warning: "Caution",
      danger: "Danger",
      notMeasured: "Not measured",
      noStandard: "No standard",
    },
    param: {
      ec: "EC",
      ph: "pH",
      temperature: "Solution temp.",
      do: "Dissolved oxygen (DO)",
      flowRate: "Flow rate",
      diffPressure: "Differential pressure",
    },
    unit: UNITS,
    loading: "Loading…",
    retry: "Retry",
    loadErrorTitle: "Could not load data",
    loadErrorMsg: "Check your connection and try again.",
    noFarmsTitle: "No farms yet",
    noFarmsMsg: "Register a farm and its beds to start measuring and monitoring.",
    registerFarm: "Register a farm",
    selectBed: "Select a bed",
    allBeds: "All beds",
    noData: "No measurements yet",
  },
  vi: {
    modeShrimp: "Trại tôm",
    modeAgri: "Nông trại thông minh",
    modeSwitchAria: "Chuyển chế độ màn hình",
    defaultScreenLabel: "Màn hình mặc định",
    defaultScreenHint: "Bạn sẽ bắt đầu ở màn hình này sau khi đăng nhập.",
    bed: "Luống",
    beds: "Luống",
    farm: "Nông trại",
    status: {
      normal: "Bình thường",
      warning: "Cảnh báo",
      danger: "Nguy hiểm",
      notMeasured: "Chưa đo",
      noStandard: "Không có tiêu chuẩn",
    },
    param: {
      ec: "EC",
      ph: "pH",
      temperature: "Nhiệt độ dung dịch",
      do: "Oxy hòa tan (DO)",
      flowRate: "Lưu lượng",
      diffPressure: "Áp suất chênh lệch",
    },
    unit: UNITS,
    loading: "Đang tải…",
    retry: "Thử lại",
    loadErrorTitle: "Không tải được dữ liệu",
    loadErrorMsg: "Kiểm tra kết nối mạng rồi thử lại.",
    noFarmsTitle: "Chưa có nông trại",
    noFarmsMsg: "Đăng ký nông trại và luống để bắt đầu đo và giám sát.",
    registerFarm: "Đăng ký nông trại",
    selectBed: "Chọn luống",
    allBeds: "Tất cả luống",
    noData: "Chưa có dữ liệu đo",
  },
  id: {
    modeShrimp: "Tambak udang",
    modeAgri: "Smart farm",
    modeSwitchAria: "Ganti mode tampilan",
    defaultScreenLabel: "Layar default",
    defaultScreenHint: "Anda akan mulai di layar ini setelah masuk.",
    bed: "Bedeng",
    beds: "Bedeng",
    farm: "Kebun",
    status: {
      normal: "Normal",
      warning: "Waspada",
      danger: "Bahaya",
      notMeasured: "Belum diukur",
      noStandard: "Tidak ada standar",
    },
    param: {
      ec: "EC",
      ph: "pH",
      temperature: "Suhu larutan",
      do: "Oksigen terlarut (DO)",
      flowRate: "Laju aliran",
      diffPressure: "Tekanan diferensial",
    },
    unit: UNITS,
    loading: "Memuat…",
    retry: "Coba lagi",
    loadErrorTitle: "Gagal memuat data",
    loadErrorMsg: "Periksa koneksi Anda lalu coba lagi.",
    noFarmsTitle: "Belum ada kebun",
    noFarmsMsg: "Daftarkan kebun dan bedeng untuk mulai mengukur dan memantau.",
    registerFarm: "Daftarkan kebun",
    selectBed: "Pilih bedeng",
    allBeds: "Semua bedeng",
    noData: "Belum ada data pengukuran",
  },
}
