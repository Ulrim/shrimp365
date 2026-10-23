// 농업(스마트팜) 사전 — nutrient 섹션(양액 관리 `/daumlabs/water-quality`).
// 4개 언어를 한 파일에 둔다(설계서 mode-split.md 6장, 시안 mode-split-ui.md 6-4).
//
// 항목 이름·단위·상태 라벨은 common 섹션(`useAgriT().common`)에 있고 여기엔 없다.
// 저장·취소·닫기·"n분 전" 같은 범용 문구는 `useT().t.common / t.time` 을 그대로 쓴다.
import type { Locale } from "@/lib/i18n"
import type { AgriParamDictKey } from "@/lib/agri-params"

export interface AgriNutrientDict {
  title: string
  subtitle: string

  /** 선택 줄 */
  bedSelectAria: string
  sensorSelectAria: string
  /** 센서 칩 첫 칸 — 기기 구분 없이 베드 전체(합산). */
  allSensors: string
  periodSelectAria: string
  period24h: string
  period72h: string
  period7d: string
  /** `{{n}}` = 분. */
  autoRefresh: string

  /** 상태 스트립·최신값 카드 */
  statusStripTitle: string
  /** 장비 [센서 설정]에서 수질 센서를 모두 끈 베드(환경·기상만 쓰는 노지) */
  noWaterSensors: string
  statusLabel: string
  latestHeading: string
  /** `{{target}}`, `{{tol}}` — 단위는 호출부가 붙인다. */
  targetWithTol: string
  /** 차트 목표선 라벨. `{{v}}` = 목표값. */
  targetLine: string
  rangeBetween: string
  rangeAtLeast: string
  rangeAtMost: string
  flowStoppedHint: string

  /** 추세 차트 */
  /** `{{range}}` = 기간 라벨. */
  trendTitle: string
  /** `{{label}}` = 항목 이름. */
  trendChartAria: string
  noRecipeLine: string
  /** `{{name}}` = 베드 이름. EC 캡션 뒤에 붙인다. */
  recipeOf: string
  /** 항목별 캡션. 키는 `lib/agri-params.ts` 의 dictKey. */
  caption: Record<AgriParamDictKey, string>
  noChartData: string
  noChartDataCta: string

  /** 전체화면·전광판 */
  fullscreen: string
  boardMode: string
  boardCycleNote: string

  /** 센서별 비교 */
  compareTitle: string
  compareNoHistory: string
  compareNoTag: string

  /** CSV */
  csv: string
  csvPrefix: string
  csvTime: string
  csvSensor: string

  /** 알림 */
  alertsTitle: string
  /** `{{n}}` = 미처리 건수. */
  alertsOpenN: string
  noAlerts: string
  resolve: string
  /** `{{v}}` = 기준값(단위 포함). */
  thresholdLine: string

  /** 빈 상태 */
  noBedsTitle: string
  noBedsMsg: string
  addBedCta: string
  noData: string
  noDataHint: string
  logReading: string
  connectDevice: string
}

export const agriNutrient: Record<Locale, AgriNutrientDict> = {
  ko: {
    title: "양액 관리",
    subtitle: "베드별 양액 데이터를 기록하고 분석하세요",
    bedSelectAria: "베드 선택",
    sensorSelectAria: "센서 선택",
    allSensors: "베드 전체",
    periodSelectAria: "기간 선택",
    period24h: "24시간",
    period72h: "3일",
    period7d: "7일",
    autoRefresh: "자동 갱신 {{n}}분",
    statusStripTitle: "항목별 현재 양액 상태",
    noWaterSensors: "이 베드의 장비는 수질 센서를 쓰지 않습니다(장비 [센서 설정]에서 모두 꺼 둠). 환경·기상 값은 대시보드에서 봅니다.",
    statusLabel: "상태",
    latestHeading: "최신 측정값",
    targetWithTol: "목표 {{target}} ±{{tol}}",
    targetLine: "목표 {{v}}",
    rangeBetween: "{{min}}~{{max}}",
    rangeAtLeast: "{{v}} 이상",
    rangeAtMost: "{{v}} 이하",
    flowStoppedHint: "유량 0 — 순환 펌프가 멈췄는지 확인하세요.",
    trendTitle: "{{range}} 추세",
    trendChartAria: "{{label}} 추세 차트",
    noRecipeLine: "레시피가 없어 목표선을 그리지 않습니다.",
    recipeOf: "레시피: {{name}}",
    caption: {
      ec: "EC (mS/cm) — 양액 농도. 목표를 벗어나면 보충·교환으로 맞춥니다.",
      ph: "pH — 양분 흡수 효율. 레시피가 없으면 엽채류 권장 5.5~6.5 를 표시합니다.",
      temperature: "양액 온도 (°C) — 근권 온도. 칠러 가동 상태와 함께 봅니다.",
      do: "DO (ppm) — 양액 용존산소. 낮으면 뿌리 호흡이 떨어집니다.",
      flowRate: "순환 유량 (L/min) — 급락 시 펌프·배관 점검",
      diffPressure: "차압 (kPa) — 상승 시 UV 살균기·필터 막힘 의심",
    },
    noChartData: "이 기간에 측정이 없습니다",
    noChartDataCta: "측정값 입력",
    fullscreen: "전체화면",
    boardMode: "전광판 모드",
    boardCycleNote: "15초마다 전환",
    compareTitle: "센서별 비교",
    compareNoHistory: "센서 기록이 아직 없습니다",
    compareNoTag: "센서가 표시되지 않은 기록만 있습니다",
    csv: "CSV",
    csvPrefix: "양액데이터",
    csvTime: "측정 시각",
    csvSensor: "센서",
    alertsTitle: "알림",
    alertsOpenN: "미처리 {{n}}건",
    noAlerts: "미처리 알림이 없습니다 — 양액이 목표 범위에 있습니다.",
    resolve: "처리",
    thresholdLine: "기준 {{v}}",
    noBedsTitle: "등록된 베드가 없습니다",
    noBedsMsg: "베드를 추가하면 측정과 모니터링을 시작할 수 있습니다.",
    addBedCta: "베드 추가하기",
    noData: "측정 데이터가 없습니다",
    noDataHint: "측정값을 입력하거나 센서를 연결해 주세요.",
    logReading: "측정값 입력",
    connectDevice: "기기 연결",
  },
  en: {
    title: "Nutrient solution",
    subtitle: "Track and analyse nutrient data per bed",
    bedSelectAria: "Select bed",
    sensorSelectAria: "Select sensor",
    allSensors: "Whole bed",
    periodSelectAria: "Select period",
    period24h: "24 h",
    period72h: "3 days",
    period7d: "7 days",
    autoRefresh: "Auto-refresh {{n}} min",
    statusStripTitle: "Current status by parameter",
    noWaterSensors: "This bed's device has no water-quality sensors turned on (all off in the device's [Sensor settings]). See environment & weather on the dashboard.",
    statusLabel: "Status",
    latestHeading: "Latest readings",
    targetWithTol: "Target {{target}} ±{{tol}}",
    targetLine: "Target {{v}}",
    rangeBetween: "{{min}}–{{max}}",
    rangeAtLeast: "{{v}} or more",
    rangeAtMost: "{{v}} or less",
    flowStoppedHint: "Flow 0 — check whether the circulation pump has stopped.",
    trendTitle: "{{range}} trend",
    trendChartAria: "{{label}} trend chart",
    noRecipeLine: "No recipe set, so no target line is drawn.",
    recipeOf: "Recipe: {{name}}",
    caption: {
      ec: "EC (mS/cm) — solution strength. Correct with refills or exchange when off target.",
      ph: "pH — nutrient uptake. Without a recipe the 5.5–6.5 leafy-greens band is shown.",
      temperature: "Solution temp. (°C) — root-zone temperature; read alongside chiller status.",
      do: "DO (ppm) — dissolved oxygen; low values stress roots.",
      flowRate: "Circulation flow (L/min) — sudden drops: check pump and piping",
      diffPressure: "Differential pressure (kPa) — rising: suspect UV unit or filter clogging",
    },
    noChartData: "No readings in this period",
    noChartDataCta: "Log a reading",
    fullscreen: "Full screen",
    boardMode: "Display board",
    boardCycleNote: "Switches every 15 s",
    compareTitle: "Compare sensors",
    compareNoHistory: "No sensor history yet",
    compareNoTag: "Readings are not tagged by sensor",
    csv: "CSV",
    csvPrefix: "nutrient-data",
    csvTime: "Measured at",
    csvSensor: "Sensor",
    alertsTitle: "Alerts",
    alertsOpenN: "{{n}} open",
    noAlerts: "No open alerts — the solution is within range.",
    resolve: "Resolve",
    thresholdLine: "Limit {{v}}",
    noBedsTitle: "No beds yet",
    noBedsMsg: "Add a bed to start logging and monitoring.",
    addBedCta: "Add a bed",
    noData: "No readings yet",
    noDataHint: "Log a reading or connect a sensor.",
    logReading: "Log a reading",
    connectDevice: "Connect a device",
  },
  vi: {
    title: "Dung dịch dinh dưỡng",
    subtitle: "Theo dõi và phân tích dữ liệu dinh dưỡng theo luống",
    bedSelectAria: "Chọn luống",
    sensorSelectAria: "Chọn cảm biến",
    allSensors: "Toàn luống",
    periodSelectAria: "Chọn khoảng thời gian",
    period24h: "24 giờ",
    period72h: "3 ngày",
    period7d: "7 ngày",
    autoRefresh: "Tự làm mới mỗi {{n}} phút",
    statusStripTitle: "Trạng thái hiện tại theo chỉ số",
    noWaterSensors: "Thiết bị của luống này không dùng cảm biến chất lượng nước (đã tắt hết trong [Cài đặt cảm biến]). Xem môi trường & thời tiết trên bảng điều khiển.",
    statusLabel: "Trạng thái",
    latestHeading: "Số đo mới nhất",
    targetWithTol: "Mục tiêu {{target}} ±{{tol}}",
    targetLine: "Mục tiêu {{v}}",
    rangeBetween: "{{min}}–{{max}}",
    rangeAtLeast: "từ {{v}} trở lên",
    rangeAtMost: "từ {{v}} trở xuống",
    flowStoppedHint: "Lưu lượng 0 — kiểm tra xem bơm tuần hoàn có dừng không.",
    trendTitle: "Xu hướng {{range}}",
    trendChartAria: "Biểu đồ xu hướng {{label}}",
    noRecipeLine: "Chưa có công thức nên không vẽ đường mục tiêu.",
    recipeOf: "Công thức: {{name}}",
    caption: {
      ec: "EC (mS/cm) — độ đậm dung dịch. Lệch mục tiêu thì bổ sung hoặc thay dung dịch.",
      ph: "pH — hiệu quả hấp thu dinh dưỡng. Không có công thức thì hiển thị dải 5.5–6.5 cho rau ăn lá.",
      temperature: "Nhiệt độ dung dịch (°C) — nhiệt độ vùng rễ; xem cùng trạng thái máy làm lạnh.",
      do: "DO (ppm) — oxy hòa tan; thấp sẽ làm rễ bị stress.",
      flowRate: "Lưu lượng tuần hoàn (L/min) — giảm đột ngột: kiểm tra bơm và đường ống",
      diffPressure: "Áp suất chênh lệch (kPa) — tăng: nghi bộ UV hoặc lọc bị tắc",
    },
    noChartData: "Không có số đo trong khoảng này",
    noChartDataCta: "Ghi số đo",
    fullscreen: "Toàn màn hình",
    boardMode: "Chế độ bảng hiển thị",
    boardCycleNote: "Chuyển mỗi 15 giây",
    compareTitle: "So sánh cảm biến",
    compareNoHistory: "Chưa có lịch sử cảm biến",
    compareNoTag: "Các số đo chưa được gắn cảm biến",
    csv: "CSV",
    csvPrefix: "du-lieu-dinh-duong",
    csvTime: "Thời điểm đo",
    csvSensor: "Cảm biến",
    alertsTitle: "Cảnh báo",
    alertsOpenN: "{{n}} chưa xử lý",
    noAlerts: "Không có cảnh báo chưa xử lý — dung dịch đang trong phạm vi.",
    resolve: "Xử lý",
    thresholdLine: "Giới hạn {{v}}",
    noBedsTitle: "Chưa có luống",
    noBedsMsg: "Thêm luống để bắt đầu ghi số đo và giám sát.",
    addBedCta: "Thêm luống",
    noData: "Chưa có số đo",
    noDataHint: "Ghi số đo hoặc kết nối cảm biến.",
    logReading: "Ghi số đo",
    connectDevice: "Kết nối thiết bị",
  },
  id: {
    title: "Larutan nutrisi",
    subtitle: "Pantau dan analisis data nutrisi per bedeng",
    bedSelectAria: "Pilih bedeng",
    sensorSelectAria: "Pilih sensor",
    allSensors: "Seluruh bedeng",
    periodSelectAria: "Pilih periode",
    period24h: "24 jam",
    period72h: "3 hari",
    period7d: "7 hari",
    autoRefresh: "Muat ulang otomatis {{n}} mnt",
    statusStripTitle: "Status saat ini per parameter",
    noWaterSensors: "Perangkat bedengan ini tidak memakai sensor kualitas air (semua dimatikan di [Pengaturan sensor]). Lihat lingkungan & cuaca di dasbor.",
    statusLabel: "Status",
    latestHeading: "Pengukuran terbaru",
    targetWithTol: "Target {{target}} ±{{tol}}",
    targetLine: "Target {{v}}",
    rangeBetween: "{{min}}–{{max}}",
    rangeAtLeast: "{{v}} atau lebih",
    rangeAtMost: "{{v}} atau kurang",
    flowStoppedHint: "Aliran 0 — periksa apakah pompa sirkulasi berhenti.",
    trendTitle: "Tren {{range}}",
    trendChartAria: "Grafik tren {{label}}",
    noRecipeLine: "Belum ada resep, jadi garis target tidak digambar.",
    recipeOf: "Resep: {{name}}",
    caption: {
      ec: "EC (mS/cm) — kepekatan larutan. Jika meleset dari target, koreksi dengan penambahan atau penggantian.",
      ph: "pH — efisiensi serapan nutrisi. Tanpa resep, ditampilkan rentang 5.5–6.5 untuk sayuran daun.",
      temperature: "Suhu larutan (°C) — suhu zona akar; baca bersama status chiller.",
      do: "DO (ppm) — oksigen terlarut; nilai rendah membuat akar stres.",
      flowRate: "Aliran sirkulasi (L/min) — turun mendadak: periksa pompa dan pipa",
      diffPressure: "Tekanan diferensial (kPa) — naik: curigai unit UV atau filter tersumbat",
    },
    noChartData: "Tidak ada pengukuran pada periode ini",
    noChartDataCta: "Catat pengukuran",
    fullscreen: "Layar penuh",
    boardMode: "Mode papan tampilan",
    boardCycleNote: "Berganti setiap 15 detik",
    compareTitle: "Bandingkan sensor",
    compareNoHistory: "Belum ada riwayat sensor",
    compareNoTag: "Pengukuran belum ditandai per sensor",
    csv: "CSV",
    csvPrefix: "data-nutrisi",
    csvTime: "Waktu pengukuran",
    csvSensor: "Sensor",
    alertsTitle: "Peringatan",
    alertsOpenN: "{{n}} belum ditangani",
    noAlerts: "Tidak ada peringatan terbuka — larutan dalam rentang target.",
    resolve: "Tangani",
    thresholdLine: "Batas {{v}}",
    noBedsTitle: "Belum ada bedeng",
    noBedsMsg: "Tambahkan bedeng untuk mulai mencatat dan memantau.",
    addBedCta: "Tambah bedeng",
    noData: "Belum ada pengukuran",
    noDataHint: "Catat pengukuran atau sambungkan sensor.",
    logReading: "Catat pengukuran",
    connectDevice: "Sambungkan perangkat",
  },
}
