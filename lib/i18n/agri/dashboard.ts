// 농업(스마트팜) 사전 — dashboard 섹션. 4개 언어를 한 파일에 둔다(설계서 mode-split.md 6장).
//
// `/daumlabs/dashboard`(components/agri/agri-dashboard-view.tsx) 전용 문구. 상태 라벨·
// 항목 이름·단위·농장 0개 빈 상태는 common 섹션에 있다. 시간 표현("3분 전")은 기존
// `useT().t.time` 을 쓴다. 자리표시자는 `{{count}}` `{{n}}` `{{name}}` `{{ago}}` `{{v}}`.
import type { Locale } from "@/lib/i18n"

export interface AgriDashboardDict {
  title: string
  subtitle: string
  actionRecord: string
  actionNutrient: string
  /** 상단 red 배너 — `{{count}}` 건. */
  alertBanner: string
  /** 배너 베드 이름이 3개를 넘을 때 — `{{n}}`. */
  alertBannerMore: string
  viewAlerts: string
  /** 자동 갱신 표시 — `{{ago}}`. */
  autoRefresh: string

  statFarms: string
  statFarmsSub: string
  statBeds: string
  statBedsSub: string
  statAlerts: string
  statAlertsSub: string
  statEcDeviation: string
  statEcDeviationSub: string

  bedsHeading: string
  bedDetail: string
  bedSelectAria: string
  /** 베드 카드 하단 — `{{ago}}`. */
  lastMeasuredAgo: string
  noReading: string
  flowStopped: string
  /** 레시피 요약 줄 — `{{ec}}` `{{ecTol}}` `{{ph}}` `{{phTol}}`. 한쪽만 있을 수 있어 둘로 나눈다. */
  recipeEc: string
  recipePh: string
  recipeNotSet: string
  cropDayN: string
  noBedsTitle: string
  noBedsMsg: string
  addBedCta: string

  nutrientHeading: string
  dpTrendTitle: string
  dpDelta: string
  dpRisingHint: string
  dpSteadyHint: string
  dpNoData: string
  dpNeedMore: string
  noDataCompact: string

  recentAlerts: string
  noAlerts: string
  resolve: string
  resolveAria: string
  resolveFailed: string
  viewAllAlerts: string
}

export const agriDashboard: Record<Locale, AgriDashboardDict> = {
  ko: {
    title: "모니터링",
    subtitle: "재배 시설 현황을 한눈에",
    actionRecord: "측정값 입력",
    actionNutrient: "양액 관리",
    alertBanner: "미처리 알림 {{count}}건",
    alertBannerMore: "외 {{n}}개 베드",
    viewAlerts: "알림 보기",
    autoRefresh: "1분마다 자동 갱신 · 마지막 {{ago}}",

    statFarms: "운영 농장",
    statFarmsSub: "베드 {{n}}개",
    statBeds: "가동 베드",
    statBedsSub: "정상 {{ok}} · 주의 {{warn}} · 위험 {{danger}}",
    statAlerts: "미처리 알림",
    statAlertsSub: "오늘",
    statEcDeviation: "EC 이탈 알림",
    statEcDeviationSub: "베드 레시피 기준 이탈",

    bedsHeading: "베드 현황",
    bedDetail: "상세",
    bedSelectAria: "{{name}} 선택",
    lastMeasuredAgo: "{{ago}} 측정",
    noReading: "측정 데이터가 없습니다",
    flowStopped: "유량 0 — 순환 펌프를 확인하세요",
    recipeEc: "EC {{ec}} ±{{ecTol}}",
    recipePh: "pH {{ph}} ±{{phTol}}",
    recipeNotSet: "레시피 미설정",
    cropDayN: "재배 {{n}}일차",
    noBedsTitle: "등록된 베드가 없습니다",
    noBedsMsg: "베드를 추가하면 측정과 모니터링을 시작할 수 있습니다.",
    addBedCta: "베드 추가하기",

    nutrientHeading: "양액 상태 · {{name}}",
    dpTrendTitle: "차압 추세 · 최근 24시간",
    dpDelta: "24시간 전 대비 {{v}} kPa",
    dpRisingHint: "올라가는 추세입니다 — UV 살균기·필터 막힘을 점검해 보세요.",
    dpSteadyHint: "특이한 변화가 없습니다.",
    dpNoData: "차압 데이터가 아직 없습니다.",
    dpNeedMore: "추세를 말하기에는 측정이 아직 적습니다 — 6회 이상 쌓이면 비교합니다.",
    noDataCompact: "측정 데이터가 없습니다 — 측정값을 입력해 주세요.",

    recentAlerts: "최근 알림",
    noAlerts: "미처리 알림이 없습니다",
    resolve: "처리",
    resolveAria: "{{name}} 알림 처리",
    resolveFailed: "알림을 처리하지 못했습니다. 다시 시도해 주세요.",
    viewAllAlerts: "알림 전체 보기",
  },
  en: {
    title: "Monitoring",
    subtitle: "Your growing facility at a glance",
    actionRecord: "Log readings",
    actionNutrient: "Nutrient solution",
    alertBanner: "{{count}} open alerts",
    alertBannerMore: "and {{n}} more beds",
    viewAlerts: "View alerts",
    autoRefresh: "Auto-refresh every minute · last {{ago}}",

    statFarms: "Farms",
    statFarmsSub: "{{n}} beds",
    statBeds: "Active beds",
    statBedsSub: "OK {{ok}} · Warn {{warn}} · Danger {{danger}}",
    statAlerts: "Open alerts",
    statAlertsSub: "Today",
    statEcDeviation: "EC deviations",
    statEcDeviationSub: "Outside bed recipe range",

    bedsHeading: "Bed status",
    bedDetail: "Details",
    bedSelectAria: "Select {{name}}",
    lastMeasuredAgo: "measured {{ago}}",
    noReading: "No readings yet",
    flowStopped: "Flow 0 — check the circulation pump",
    recipeEc: "EC {{ec}} ±{{ecTol}}",
    recipePh: "pH {{ph}} ±{{phTol}}",
    recipeNotSet: "No recipe set",
    cropDayN: "Day {{n}}",
    noBedsTitle: "No beds yet",
    noBedsMsg: "Add a bed to start logging and monitoring.",
    addBedCta: "Add a bed",

    nutrientHeading: "Nutrient status · {{name}}",
    dpTrendTitle: "Diff. pressure · last 24 h",
    dpDelta: "{{v}} kPa vs. 24 h ago",
    dpRisingHint: "Trending up — check the UV unit and filter for clogging.",
    dpSteadyHint: "No notable change.",
    dpNoData: "No pressure data yet.",
    dpNeedMore: "Not enough readings for a trend — compares after 6 or more.",
    noDataCompact: "No readings yet — log a reading.",

    recentAlerts: "Recent alerts",
    noAlerts: "No open alerts",
    resolve: "Resolve",
    resolveAria: "Resolve alert for {{name}}",
    resolveFailed: "Could not resolve the alert. Please try again.",
    viewAllAlerts: "View all alerts",
  },
  vi: {
    title: "Giám sát",
    subtitle: "Toàn cảnh cơ sở canh tác của bạn",
    actionRecord: "Ghi số đo",
    actionNutrient: "Dung dịch dinh dưỡng",
    alertBanner: "{{count}} cảnh báo chưa xử lý",
    alertBannerMore: "và {{n}} luống khác",
    viewAlerts: "Xem cảnh báo",
    autoRefresh: "Tự làm mới mỗi phút · lần cuối {{ago}}",

    statFarms: "Nông trại",
    statFarmsSub: "{{n}} luống",
    statBeds: "Luống đang hoạt động",
    statBedsSub: "Bình thường {{ok}} · Cảnh báo {{warn}} · Nguy hiểm {{danger}}",
    statAlerts: "Cảnh báo chưa xử lý",
    statAlertsSub: "Hôm nay",
    statEcDeviation: "Lệch EC",
    statEcDeviationSub: "Ngoài phạm vi công thức của luống",

    bedsHeading: "Tình trạng luống",
    bedDetail: "Chi tiết",
    bedSelectAria: "Chọn {{name}}",
    lastMeasuredAgo: "đo {{ago}}",
    noReading: "Chưa có số đo",
    flowStopped: "Lưu lượng 0 — kiểm tra bơm tuần hoàn",
    recipeEc: "EC {{ec}} ±{{ecTol}}",
    recipePh: "pH {{ph}} ±{{phTol}}",
    recipeNotSet: "Chưa đặt công thức",
    cropDayN: "Ngày {{n}}",
    noBedsTitle: "Chưa có luống",
    noBedsMsg: "Thêm luống để bắt đầu ghi chép và giám sát.",
    addBedCta: "Thêm luống",

    nutrientHeading: "Tình trạng dinh dưỡng · {{name}}",
    dpTrendTitle: "Áp suất chênh lệch · 24 giờ qua",
    dpDelta: "{{v}} kPa so với 24 giờ trước",
    dpRisingHint: "Đang tăng — kiểm tra đèn UV và lọc có bị tắc không.",
    dpSteadyHint: "Không có thay đổi đáng kể.",
    dpNoData: "Chưa có dữ liệu áp suất.",
    dpNeedMore: "Chưa đủ số đo để nói xu hướng — so sánh khi có từ 6 lần trở lên.",
    noDataCompact: "Chưa có số đo — hãy ghi một số đo.",

    recentAlerts: "Cảnh báo gần đây",
    noAlerts: "Không có cảnh báo chưa xử lý",
    resolve: "Xử lý",
    resolveAria: "Xử lý cảnh báo của {{name}}",
    resolveFailed: "Không xử lý được cảnh báo. Vui lòng thử lại.",
    viewAllAlerts: "Xem tất cả cảnh báo",
  },
  id: {
    title: "Pemantauan",
    subtitle: "Fasilitas budidaya Anda dalam sekilas",
    actionRecord: "Catat pengukuran",
    actionNutrient: "Larutan nutrisi",
    alertBanner: "{{count}} peringatan belum ditangani",
    alertBannerMore: "dan {{n}} bedeng lainnya",
    viewAlerts: "Lihat peringatan",
    autoRefresh: "Muat ulang otomatis tiap menit · terakhir {{ago}}",

    statFarms: "Kebun",
    statFarmsSub: "{{n}} bedeng",
    statBeds: "Bedeng aktif",
    statBedsSub: "Normal {{ok}} · Waspada {{warn}} · Bahaya {{danger}}",
    statAlerts: "Peringatan belum ditangani",
    statAlertsSub: "Hari ini",
    statEcDeviation: "Penyimpangan EC",
    statEcDeviationSub: "Di luar rentang resep bedeng",

    bedsHeading: "Status bedeng",
    bedDetail: "Detail",
    bedSelectAria: "Pilih {{name}}",
    lastMeasuredAgo: "diukur {{ago}}",
    noReading: "Belum ada pengukuran",
    flowStopped: "Aliran 0 — periksa pompa sirkulasi",
    recipeEc: "EC {{ec}} ±{{ecTol}}",
    recipePh: "pH {{ph}} ±{{phTol}}",
    recipeNotSet: "Resep belum diatur",
    cropDayN: "Hari ke-{{n}}",
    noBedsTitle: "Belum ada bedeng",
    noBedsMsg: "Tambahkan bedeng untuk mulai mencatat dan memantau.",
    addBedCta: "Tambah bedeng",

    nutrientHeading: "Status nutrisi · {{name}}",
    dpTrendTitle: "Tekanan diferensial · 24 jam terakhir",
    dpDelta: "{{v}} kPa dibanding 24 jam lalu",
    dpRisingHint: "Cenderung naik — periksa unit UV dan filter dari penyumbatan.",
    dpSteadyHint: "Tidak ada perubahan berarti.",
    dpNoData: "Belum ada data tekanan.",
    dpNeedMore: "Pengukuran belum cukup untuk tren — dibandingkan setelah 6 kali atau lebih.",
    noDataCompact: "Belum ada pengukuran — catat satu pengukuran.",

    recentAlerts: "Peringatan terbaru",
    noAlerts: "Tidak ada peringatan belum ditangani",
    resolve: "Tangani",
    resolveAria: "Tangani peringatan {{name}}",
    resolveFailed: "Gagal menangani peringatan. Silakan coba lagi.",
    viewAllAlerts: "Lihat semua peringatan",
  },
}
