// 농업(스마트팜) 사전 — openfield 섹션(노지 재해위험 카드). 4개 언어를 한 파일에 둔다.
//
// 설계서 docs/plans/openfield-merge.md 6장. ko 는 OFDF `dashboard/plain.js` 의 농가 말을
// 그대로 옮겼다 — 패널(kiosk.html)에서 "비닐·부직포 덮기"라고 본 것을 휴대폰 Farm365 에서
// 다른 말로 읽으면 다른 일인 줄 안다. en/vi/id 는 같은 뜻으로 새로 썼다.
//
// 이 파일은 서버 라우트(app/api/field/device/judgements)도 import 한다 — 알림 message 의
// 농가 말(ko)이 여기서 나온다. 그러므로 "use client" 를 붙이지 말고 브라우저 전용 API 도
// 쓰지 않는다. index.ts 는 건드리지 않는다.
import type { Locale } from "@/lib/i18n"
import type { FieldRiskType } from "@/types"

/** OFDF 위험 유형 5종. DB CHECK(risk IN …)·라우트 검증과 같은 목록이다. 타입은 types/index.ts 가 쥔다. */
export const FIELD_RISK_TYPES = ["heat_dry", "rain_wet", "disease", "frost", "compound"] as const satisfies readonly FieldRiskType[]

/** alerts.parameter 접두 — `field:<risk>`. 라우트가 쓰고 화면이 번역한다. */
export const FIELD_ALERT_PREFIX = "field:"

/** 판단 레코드 `environment` 의 숫자 키 9개. 라우트는 이 키만 받고 나머지는 버린다. */
export const FIELD_ENV_KEYS = [
  "t_air", "canopy_temp", "rh", "leaf_wetness", "solar_w", "rain", "soil_moisture", "soil_index", "wind_speed",
] as const
export type FieldEnvKey = (typeof FIELD_ENV_KEYS)[number]

/** 환경 항목 단위 — 언어 무관. */
export const FIELD_ENV_UNITS: Record<FieldEnvKey, string> = {
  t_air: "℃", canopy_temp: "℃", rh: "%", leaf_wetness: "", solar_w: "W/m²", rain: "mm",
  soil_moisture: "%", soil_index: "", wind_speed: "m/s",
}

/** 조치 농가 말 키 — plain.js 의 PLAIN_ACTION 표 순서. 정규식 매칭은
 *  components/agri/openfield/field-action-plain.ts 가 맡고, 문구는 여기 사전이 맡는다. */
export const FIELD_ACTION_KEYS = [
  "coverDeploy", "coverPrepare", "noNightIrrigation", "stopIrrigation", "irrigate", "mistOff",
  "shadeDeploy", "shadeRetract", "noDeploy", "frostCheck", "drainage", "sprayPrep", "machineHalt", "offline",
] as const
export type FieldActionKey = (typeof FIELD_ACTION_KEYS)[number]

export interface AgriOpenfieldDict {
  /** 카드 제목. */
  title: string
  /** 카드 부제 — 어느 베드인지. `{{name}}`. */
  subtitle: string
  /** 위험 유형 이름(농가 말). */
  risk: Record<FieldRiskType, string>
  /** 등급 0 정상 · 1 주의 · 2 경계 · 3 긴급 — OFDF LEVEL_NAMES 순서. */
  level: [string, string, string, string]
  /** 알람 띠 큰 글씨. index = level(0 은 쓰지 않음, 3 은 2 보다 센 말). */
  headline: Record<FieldRiskType, [string, string, string, string]>
  /** level 0 일 때의 큰 글씨·"언제". */
  allClear: string
  allClearWhen: string
  /** 예상 발생 시각이 있을 때 — `{{time}}`. */
  whenAt: string
  /** 없을 때 — `{{h}}` 시간 안. */
  whenWithin: string
  /** 근거 한 줄 접두. */
  evidence: string
  /** 미니 격자 제목·시간 축. */
  gridHeading: string
  horizon1: string
  horizon3: string
  /** 격자에서 판단이 없는 칸. */
  noJudgement: string
  /** 할 일. */
  todoHeading: string
  autoHandled: string
  /** 구동부가 없어 사람이 직접 해야 하는 조치 배지. */
  byHand: string
  /** rejected_by 가 있는 조치 배지 — `{{by}}`. */
  rejectedBy: string
  action: Record<FieldActionKey, { what: string; why: string }>
  /** 환경 항목 이름 9개. */
  env: Record<FieldEnvKey, string>
  /** soil_index 로 대신 보일 때(실측 아님). */
  estimated: string
  envHeading: string
  /** 접기 영역. */
  details: string
  confidence: string
  modelVersion: string
  judgedAt: string
  /** 알림 목록 이름표 — `{{risk}}`. alerts.parameter `field:<risk>` 를 이것으로 번역한다. */
  alertLabel: string
  /** 판단이 아직 없음(카드 자체는 숨지만 aria·빈 격자에 쓴다). */
  empty: string
}

export const agriOpenfield: Record<Locale, AgriOpenfieldDict> = {
  ko: {
    title: "노지 재해위험",
    subtitle: "{{name}} · 앞으로 1·3시간 전망",
    risk: {
      heat_dry: "더위·가뭄", rain_wet: "비·물많음", disease: "병 생기기 쉬움", frost: "추위·서리", compound: "겹친 위험",
    },
    level: ["정상", "주의", "경계", "긴급"],
    headline: {
      frost: ["", "오늘 밤 서리가 내릴 수 있습니다", "오늘 밤 서리가 내립니다", "지금 서리가 내리고 있습니다"],
      heat_dry: ["", "낮에 더위·가뭄 피해가 올 수 있습니다", "낮에 더위·가뭄 피해가 옵니다", "더위·가뭄 피해가 바로 옵니다"],
      rain_wet: ["", "비로 물이 많아질 수 있습니다", "비로 물이 많아집니다", "물이 넘칩니다 — 바로 빼야 합니다"],
      disease: ["", "병이 생기기 쉬운 날씨가 됩니다", "병이 생기기 아주 쉬운 날씨입니다", "병이 번지기 가장 쉬운 날씨입니다"],
      compound: ["", "위험이 둘 겹칠 수 있습니다", "위험이 둘 겹칩니다", "위험이 겹쳐 바로 조치가 필요합니다"],
    },
    allClear: "지금 조치할 일이 없습니다",
    allClearWhen: "앞으로 3시간 안에 올 위험이 없습니다",
    whenAt: "{{time}}쯤",
    whenWithin: "앞으로 {{h}}시간 안",
    evidence: "근거",
    gridHeading: "위험별 전망",
    horizon1: "1시간",
    horizon3: "3시간",
    noJudgement: "—",
    todoHeading: "할 일",
    autoHandled: "자동으로 처리 중입니다",
    byHand: "직접",
    rejectedBy: "보류 · {{by}}",
    action: {
      coverDeploy: { what: "비닐·부직포 덮기", why: "해 지면 덮고 해 뜨면 걷습니다" },
      coverPrepare: { what: "해 진 뒤 덮을 준비", why: "낮에 덮으면 햇빛이 모자랍니다" },
      noNightIrrigation: { what: "밤·새벽에 물 주지 않기", why: "물을 주면 더 얼어붙습니다" },
      stopIrrigation: { what: "물 주기 멈추기", why: "흙에 물이 이미 많습니다" },
      irrigate: { what: "물 주기", why: "흙이 말라 뿌리가 마릅니다" },
      mistOff: { what: "미세살수 끄기", why: "잎이 젖으면 병이 번집니다" },
      shadeDeploy: { what: "차광막 치기", why: "가장 더운 때만, 최대 2시간" },
      shadeRetract: { what: "차광막·피복 걷기", why: "바람에 찢어지거나 시간이 다 됐습니다" },
      noDeploy: { what: "차광막·피복 펴지 않기", why: "바람이 셉니다" },
      frostCheck: { what: "내일 아침 잎 끝 살펴보기", why: "언 자리가 있으면 사진을 남겨 주세요" },
      drainage: { what: "고랑·배수로 터 주기", why: "물이 고이면 뿌리가 상합니다" },
      sprayPrep: { what: "약 칠 준비", why: "노균병·잎마름병이 번지기 쉽습니다" },
      machineHalt: { what: "기계 멈춤 — 현장 확인 필요", why: "안전장치가 걸렸습니다" },
      offline: { what: "통신 끊김 — 제어기가 혼자 돌고 있음", why: "복구되면 기록이 올라갑니다" },
    },
    env: {
      t_air: "기온", canopy_temp: "잎 높이 온도", rh: "습도", leaf_wetness: "잎 젖음", solar_w: "햇빛",
      rain: "비", soil_moisture: "흙 수분", soil_index: "흙 수분", wind_speed: "바람",
    },
    estimated: "추정",
    envHeading: "지금 날씨",
    details: "자세히",
    confidence: "신뢰도",
    modelVersion: "모델",
    judgedAt: "판단 시각",
    alertLabel: "노지 · {{risk}}",
    empty: "아직 판단이 없습니다",
  },
  en: {
    title: "Open-field weather risk",
    subtitle: "{{name}} · next 1 h and 3 h",
    risk: {
      heat_dry: "Heat & drought", rain_wet: "Rain & waterlogging", disease: "Disease-prone", frost: "Cold & frost", compound: "Combined risk",
    },
    level: ["Normal", "Caution", "Warning", "Emergency"],
    headline: {
      frost: ["", "Frost is possible tonight", "Frost tonight", "Frost is forming now"],
      heat_dry: ["", "Heat and drought stress possible today", "Heat and drought stress today", "Heat and drought damage imminent"],
      rain_wet: ["", "Rain may waterlog the field", "Rain will waterlog the field", "Field flooding — drain now"],
      disease: ["", "Weather is turning disease-prone", "Weather is highly disease-prone", "Peak conditions for disease spread"],
      compound: ["", "Two risks may overlap", "Two risks are overlapping", "Overlapping risks — act now"],
    },
    allClear: "Nothing to do right now",
    allClearWhen: "No risk expected in the next 3 hours",
    whenAt: "around {{time}}",
    whenWithin: "within {{h}} h",
    evidence: "Why",
    gridHeading: "Outlook by risk",
    horizon1: "1 h",
    horizon3: "3 h",
    noJudgement: "—",
    todoHeading: "To do",
    autoHandled: "Being handled automatically",
    byHand: "By hand",
    rejectedBy: "On hold · {{by}}",
    action: {
      coverDeploy: { what: "Cover with film or fleece", why: "Cover at sunset, uncover at sunrise" },
      coverPrepare: { what: "Get covers ready for after sunset", why: "Covering by day cuts off sunlight" },
      noNightIrrigation: { what: "No watering at night or dawn", why: "Water makes freezing worse" },
      stopIrrigation: { what: "Stop watering", why: "The soil is already wet" },
      irrigate: { what: "Water the field", why: "Dry soil dries the roots" },
      mistOff: { what: "Turn off misting", why: "Wet leaves spread disease" },
      shadeDeploy: { what: "Pull the shade net", why: "Hottest hours only, 2 h max" },
      shadeRetract: { what: "Retract shade and covers", why: "Wind damage or time is up" },
      noDeploy: { what: "Do not deploy shade or covers", why: "Wind is strong" },
      frostCheck: { what: "Check leaf tips tomorrow morning", why: "Photograph any frozen spots" },
      drainage: { what: "Open furrows and drains", why: "Standing water rots roots" },
      sprayPrep: { what: "Prepare to spray", why: "Downy mildew and leaf blight spread easily" },
      machineHalt: { what: "Equipment stopped — check on site", why: "A safety interlock tripped" },
      offline: { what: "Link down — controller running alone", why: "Records upload once restored" },
    },
    env: {
      t_air: "Air temp", canopy_temp: "Canopy temp", rh: "Humidity", leaf_wetness: "Leaf wetness", solar_w: "Sunlight",
      rain: "Rain", soil_moisture: "Soil moisture", soil_index: "Soil moisture", wind_speed: "Wind",
    },
    estimated: "est.",
    envHeading: "Weather now",
    details: "Details",
    confidence: "Confidence",
    modelVersion: "Model",
    judgedAt: "Judged at",
    alertLabel: "Field · {{risk}}",
    empty: "No judgement yet",
  },
  vi: {
    title: "Rủi ro thời tiết ngoài đồng",
    subtitle: "{{name}} · dự báo 1 giờ và 3 giờ tới",
    risk: {
      heat_dry: "Nóng & hạn", rain_wet: "Mưa & úng nước", disease: "Dễ phát bệnh", frost: "Lạnh & sương giá", compound: "Rủi ro chồng chéo",
    },
    level: ["Bình thường", "Chú ý", "Cảnh báo", "Khẩn cấp"],
    headline: {
      frost: ["", "Đêm nay có thể có sương giá", "Đêm nay có sương giá", "Sương giá đang hình thành"],
      heat_dry: ["", "Ban ngày có thể bị nóng và hạn", "Ban ngày sẽ bị nóng và hạn", "Thiệt hại do nóng hạn sắp xảy ra"],
      rain_wet: ["", "Mưa có thể gây úng nước", "Mưa sẽ gây úng nước", "Ruộng ngập — cần tiêu nước ngay"],
      disease: ["", "Thời tiết đang chuyển sang dễ phát bệnh", "Thời tiết rất dễ phát bệnh", "Điều kiện lan bệnh cao nhất"],
      compound: ["", "Hai rủi ro có thể chồng lên nhau", "Hai rủi ro đang chồng lên nhau", "Rủi ro chồng chéo — cần xử lý ngay"],
    },
    allClear: "Hiện không có việc cần làm",
    allClearWhen: "Không có rủi ro trong 3 giờ tới",
    whenAt: "khoảng {{time}}",
    whenWithin: "trong {{h}} giờ tới",
    evidence: "Lý do",
    gridHeading: "Dự báo theo rủi ro",
    horizon1: "1 giờ",
    horizon3: "3 giờ",
    noJudgement: "—",
    todoHeading: "Việc cần làm",
    autoHandled: "Đang xử lý tự động",
    byHand: "Làm tay",
    rejectedBy: "Tạm dừng · {{by}}",
    action: {
      coverDeploy: { what: "Phủ màng hoặc vải không dệt", why: "Phủ khi mặt trời lặn, mở khi mặt trời mọc" },
      coverPrepare: { what: "Chuẩn bị phủ sau khi trời tối", why: "Phủ ban ngày sẽ thiếu nắng" },
      noNightIrrigation: { what: "Không tưới ban đêm và rạng sáng", why: "Tưới nước làm đóng băng nặng hơn" },
      stopIrrigation: { what: "Ngừng tưới", why: "Đất đã quá ẩm" },
      irrigate: { what: "Tưới nước", why: "Đất khô làm rễ khô" },
      mistOff: { what: "Tắt phun sương", why: "Lá ướt làm bệnh lan" },
      shadeDeploy: { what: "Kéo lưới che nắng", why: "Chỉ lúc nóng nhất, tối đa 2 giờ" },
      shadeRetract: { what: "Thu lưới che và màng phủ", why: "Gió làm rách hoặc đã hết giờ" },
      noDeploy: { what: "Không kéo lưới che hay màng phủ", why: "Gió mạnh" },
      frostCheck: { what: "Sáng mai kiểm tra chóp lá", why: "Có chỗ bị đông thì chụp ảnh lại" },
      drainage: { what: "Khơi rãnh và mương tiêu", why: "Nước đọng làm hỏng rễ" },
      sprayPrep: { what: "Chuẩn bị phun thuốc", why: "Bệnh sương mai, cháy lá dễ lan" },
      machineHalt: { what: "Máy dừng — cần kiểm tra tại chỗ", why: "Thiết bị an toàn đã ngắt" },
      offline: { what: "Mất kết nối — bộ điều khiển chạy độc lập", why: "Khôi phục xong sẽ tải lên bản ghi" },
    },
    env: {
      t_air: "Nhiệt độ không khí", canopy_temp: "Nhiệt độ tán lá", rh: "Độ ẩm", leaf_wetness: "Lá ướt", solar_w: "Nắng",
      rain: "Mưa", soil_moisture: "Ẩm đất", soil_index: "Ẩm đất", wind_speed: "Gió",
    },
    estimated: "ước tính",
    envHeading: "Thời tiết hiện tại",
    details: "Chi tiết",
    confidence: "Độ tin cậy",
    modelVersion: "Mô hình",
    judgedAt: "Thời điểm đánh giá",
    alertLabel: "Ngoài đồng · {{risk}}",
    empty: "Chưa có đánh giá",
  },
  id: {
    title: "Risiko cuaca lahan terbuka",
    subtitle: "{{name}} · prakiraan 1 jam dan 3 jam",
    risk: {
      heat_dry: "Panas & kering", rain_wet: "Hujan & tergenang", disease: "Rawan penyakit", frost: "Dingin & embun beku", compound: "Risiko gabungan",
    },
    level: ["Normal", "Waspada", "Peringatan", "Darurat"],
    headline: {
      frost: ["", "Malam ini mungkin ada embun beku", "Malam ini ada embun beku", "Embun beku sedang terbentuk"],
      heat_dry: ["", "Siang ini mungkin terjadi stres panas dan kering", "Siang ini terjadi stres panas dan kering", "Kerusakan akibat panas dan kering segera terjadi"],
      rain_wet: ["", "Hujan dapat menggenangi lahan", "Hujan akan menggenangi lahan", "Lahan tergenang — segera buang air"],
      disease: ["", "Cuaca mulai rawan penyakit", "Cuaca sangat rawan penyakit", "Kondisi puncak penyebaran penyakit"],
      compound: ["", "Dua risiko dapat bertumpuk", "Dua risiko sedang bertumpuk", "Risiko bertumpuk — segera bertindak"],
    },
    allClear: "Tidak ada yang perlu dilakukan sekarang",
    allClearWhen: "Tidak ada risiko dalam 3 jam ke depan",
    whenAt: "sekitar {{time}}",
    whenWithin: "dalam {{h}} jam",
    evidence: "Alasan",
    gridHeading: "Prakiraan per risiko",
    horizon1: "1 jam",
    horizon3: "3 jam",
    noJudgement: "—",
    todoHeading: "Yang perlu dilakukan",
    autoHandled: "Sedang ditangani otomatis",
    byHand: "Manual",
    rejectedBy: "Ditunda · {{by}}",
    action: {
      coverDeploy: { what: "Tutup dengan plastik atau kain nonwoven", why: "Tutup saat matahari terbenam, buka saat terbit" },
      coverPrepare: { what: "Siapkan penutup untuk setelah gelap", why: "Menutup di siang hari mengurangi sinar matahari" },
      noNightIrrigation: { what: "Jangan menyiram malam atau subuh", why: "Air membuat pembekuan lebih parah" },
      stopIrrigation: { what: "Hentikan penyiraman", why: "Tanah sudah terlalu basah" },
      irrigate: { what: "Siram lahan", why: "Tanah kering membuat akar kering" },
      mistOff: { what: "Matikan pengabutan", why: "Daun basah menyebarkan penyakit" },
      shadeDeploy: { what: "Pasang jaring peneduh", why: "Hanya saat terpanas, maksimal 2 jam" },
      shadeRetract: { what: "Gulung jaring peneduh dan penutup", why: "Robek karena angin atau waktunya habis" },
      noDeploy: { what: "Jangan pasang jaring peneduh atau penutup", why: "Angin kencang" },
      frostCheck: { what: "Periksa ujung daun besok pagi", why: "Foto bagian yang membeku" },
      drainage: { what: "Buka alur dan saluran drainase", why: "Air menggenang merusak akar" },
      sprayPrep: { what: "Siapkan penyemprotan", why: "Embun bulu dan hawar daun mudah menyebar" },
      machineHalt: { what: "Mesin berhenti — periksa di lokasi", why: "Pengaman terpicu" },
      offline: { what: "Koneksi putus — pengendali berjalan sendiri", why: "Catatan diunggah setelah pulih" },
    },
    env: {
      t_air: "Suhu udara", canopy_temp: "Suhu tajuk", rh: "Kelembapan", leaf_wetness: "Daun basah", solar_w: "Sinar matahari",
      rain: "Hujan", soil_moisture: "Kelembapan tanah", soil_index: "Kelembapan tanah", wind_speed: "Angin",
    },
    estimated: "perkiraan",
    envHeading: "Cuaca saat ini",
    details: "Rincian",
    confidence: "Keyakinan",
    modelVersion: "Model",
    judgedAt: "Waktu penilaian",
    alertLabel: "Lahan · {{risk}}",
    empty: "Belum ada penilaian",
  },
}
