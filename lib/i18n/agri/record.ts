// 농업(스마트팜) 사전 — record 섹션. 4개 언어를 한 파일에 둔다(설계서 mode-split.md 6장).
//
// 기록 허브(`/daumlabs/record`) · 측정 입력 폼(`/daumlabs/record/water-quality`) ·
// 영농 일지 폼(`/daumlabs/record/journal`) 문구. 저장·다음·이전·날짜 같은 위저드
// 공용 문구는 기존 `useT().t.wizard` 를 그대로 쓴다. 자리표시자는 `{{target}}` 등.
//
// 어휘: 측정 항목 이름·단위는 common.param / common.unit 에 있다(여기 중복 금지).
import type { Locale } from "@/lib/i18n"

export interface AgriRecordDict {
  // ── 허브 ──
  chooseTitle: string
  backToHomeAria: string
  measureTitle: string
  measureSub: string
  journalTitle: string
  journalSub: string

  // ── 공통(두 폼) ──
  bedLoadFailed: string
  noBedsTitle: string
  noBedsMeasureMsg: string
  noBedsJournalMsg: string
  saveFailed: string
  invalidNumber: string
  savedAgain: string

  // ── 측정 폼 ──
  stepBed: string
  stepConcentration: string
  stepEnvironment: string
  stepCirculation: string
  notice: string
  ecPlaceholder: string
  phPlaceholder: string
  tempPlaceholder: string
  doPlaceholder: string
  flowPlaceholder: string
  dpPlaceholder: string
  ecTarget: string
  ecNoTarget: string
  phTarget: string
  phNoTarget: string
  tempHint: string
  doHint: string
  flowHint: string
  dpHint: string
  ecRangeError: string
  phRangeError: string
  savedViewTrend: string

  // ── 영농 일지 폼 ──
  jStepBedDate: string
  jStepNutrient: string
  jStepWork: string
  jStepCheck: string
  nutrientType: string
  nutrientRefill: string
  nutrientRefillUnit: string
  nutrientRefillPlaceholder: string
  nutrientRefillHint: string
  refillTimes: string
  refillTimesUnit: string
  refillTimesPlaceholder: string
  exchangeRate: string
  exchangeRatePlaceholder: string
  exchangeRateHint: string
  pestControl: string
  pestAgent: string
  pestAgentPlaceholder: string
  inputApplied: string
  inputType: string
  inputAmount: string
  inputAmountUnit: string
  inputAmountPlaceholder: string
  inputAmountHint: string
  checkPump: string
  checkFilterUv: string
  checkChiller: string
  checkGrowth: string
  notes: string
  notesPlaceholder: string
  savedViewJournal: string
}

export const agriRecord: Record<Locale, AgriRecordDict> = {
  ko: {
    chooseTitle: "무엇을 기록할까요?",
    backToHomeAria: "홈으로",
    measureTitle: "측정 기록",
    measureSub: "EC·pH·양액 온도 등",
    journalTitle: "영농 일지",
    journalSub: "양액 보충·교환·설비 점검 등",

    bedLoadFailed: "베드 목록을 불러오지 못했습니다.",
    noBedsTitle: "등록된 베드가 없습니다",
    noBedsMeasureMsg: "측정 기록을 시작하려면 먼저 농장과 베드를 등록해 주세요.",
    noBedsJournalMsg: "영농 일지를 쓰려면 먼저 농장과 베드를 등록해 주세요.",
    saveFailed: "저장하지 못했습니다. 다시 시도해 주세요.",
    invalidNumber: "{{field}}: 숫자를 입력해 주세요.",
    savedAgain: "한 건 더 기록",

    stepBed: "베드 선택",
    stepConcentration: "양액 농도",
    stepEnvironment: "양액 환경",
    stepCirculation: "순환 라인",
    notice: "센서가 자동으로 기록하고 있습니다. 이 화면은 휴대용 측정기로 잰 값을 함께 남겨 센서와 대조하는 곳입니다.",
    ecPlaceholder: "예: 1.85",
    phPlaceholder: "예: 6.0",
    tempPlaceholder: "예: 21.5",
    doPlaceholder: "예: 7.0",
    flowPlaceholder: "예: 12",
    dpPlaceholder: "예: 15",
    ecTarget: "이 베드 목표 {{target}} ±{{tol}} mS/cm",
    ecNoTarget: "이 베드에 목표 EC가 없습니다 — 농장·기기 관리에서 레시피를 설정하면 여기에 목표가 표시됩니다.",
    phTarget: "이 베드 목표 {{target}} ±{{tol}}",
    phNoTarget: "엽채류 권장 5.5~6.5",
    tempHint: "근권 권장 18~22 °C (칠러 가동 시)",
    doHint: "5 ppm 이상 권장",
    flowHint: "평소 유량과 크게 다르면 펌프·배관을 점검하세요.",
    dpHint: "평소보다 오르면 UV 살균기·필터 막힘을 의심하세요.",
    ecRangeError: "EC는 0.1~10 mS/cm 범위로 입력해 주세요.",
    phRangeError: "pH는 0~14 범위로 입력해 주세요.",
    savedViewTrend: "추세 보기",

    jStepBedDate: "베드·날짜",
    jStepNutrient: "양액 관리",
    jStepWork: "재배 작업",
    jStepCheck: "설비 점검",
    nutrientType: "양액 종류",
    nutrientRefill: "양액 보충량",
    nutrientRefillUnit: "L",
    nutrientRefillPlaceholder: "예: 40",
    nutrientRefillHint: "오늘 양액조에 새로 채운 양입니다.",
    refillTimes: "보충 횟수",
    refillTimesUnit: "회/일",
    refillTimesPlaceholder: "예: 2",
    exchangeRate: "양액 교환율",
    exchangeRatePlaceholder: "예: 30",
    exchangeRateHint: "전량 교환이면 100. 일부만 바꿨으면 바꾼 비율을 적습니다.",
    pestControl: "방제 실시",
    pestAgent: "약제명",
    pestAgentPlaceholder: "약제 이름을 입력하세요",
    inputApplied: "자재 투입",
    inputType: "자재 종류",
    inputAmount: "투입량",
    inputAmountUnit: "kg",
    inputAmountPlaceholder: "예: 0.5",
    inputAmountHint: "액상 자재는 L 단위로 적습니다 (1 L = 1 kg 로 봅니다).",
    checkPump: "순환 펌프",
    checkFilterUv: "필터·UV 살균기",
    checkChiller: "근권 냉방 칠러",
    checkGrowth: "생육 상태",
    notes: "메모",
    notesPlaceholder: "특이사항을 적어 주세요. 수확량도 여기에 적습니다.",
    savedViewJournal: "영농 일지 보기",
  },
  en: {
    chooseTitle: "What would you like to log?",
    backToHomeAria: "Back to home",
    measureTitle: "Log readings",
    measureSub: "EC, pH, solution temp. and more",
    journalTitle: "Farm journal",
    journalSub: "Refills, exchanges, maintenance",

    bedLoadFailed: "Could not load beds.",
    noBedsTitle: "No beds yet",
    noBedsMeasureMsg: "Register a farm and a bed before logging readings.",
    noBedsJournalMsg: "Register a farm and a bed before writing a journal entry.",
    saveFailed: "Could not save. Please try again.",
    invalidNumber: "{{field}}: enter a number.",
    savedAgain: "Log another",

    stepBed: "Choose bed",
    stepConcentration: "Solution strength",
    stepEnvironment: "Solution environment",
    stepCirculation: "Circulation line",
    notice: "Sensors log automatically. Use this screen to record handheld readings alongside them for comparison.",
    ecPlaceholder: "e.g. 1.85",
    phPlaceholder: "e.g. 6.0",
    tempPlaceholder: "e.g. 21.5",
    doPlaceholder: "e.g. 7.0",
    flowPlaceholder: "e.g. 12",
    dpPlaceholder: "e.g. 15",
    ecTarget: "Bed target {{target}} ±{{tol}} mS/cm",
    ecNoTarget: "No target EC for this bed — set a recipe in Farms & devices to see it here.",
    phTarget: "Bed target {{target}} ±{{tol}}",
    phNoTarget: "Leafy greens: 5.5–6.5 recommended",
    tempHint: "Root zone 18–22 °C recommended (with chiller)",
    doHint: "5 ppm or higher recommended",
    flowHint: "If far from usual, check pump and piping.",
    dpHint: "Rising above usual suggests a clogged UV unit or filter.",
    ecRangeError: "Enter EC between 0.1 and 10 mS/cm.",
    phRangeError: "Enter pH between 0 and 14.",
    savedViewTrend: "View trend",

    jStepBedDate: "Bed & date",
    jStepNutrient: "Nutrient solution",
    jStepWork: "Crop work",
    jStepCheck: "Equipment check",
    nutrientType: "Nutrient type",
    nutrientRefill: "Refill amount",
    nutrientRefillUnit: "L",
    nutrientRefillPlaceholder: "e.g. 40",
    nutrientRefillHint: "Volume added to the tank today.",
    refillTimes: "Refills",
    refillTimesUnit: "per day",
    refillTimesPlaceholder: "e.g. 2",
    exchangeRate: "Exchange rate",
    exchangeRatePlaceholder: "e.g. 30",
    exchangeRateHint: "100 for a full exchange; otherwise the share replaced.",
    pestControl: "Pest control done",
    pestAgent: "Agent",
    pestAgentPlaceholder: "Enter the agent name",
    inputApplied: "Input applied",
    inputType: "Input type",
    inputAmount: "Amount",
    inputAmountUnit: "kg",
    inputAmountPlaceholder: "e.g. 0.5",
    inputAmountHint: "Liquids in L (1 L counted as 1 kg).",
    checkPump: "Circulation pump",
    checkFilterUv: "Filter & UV unit",
    checkChiller: "Root-zone chiller",
    checkGrowth: "Crop condition",
    notes: "Notes",
    notesPlaceholder: "Note anything unusual. Record harvest amounts here too.",
    savedViewJournal: "View farm journal",
  },
  vi: {
    chooseTitle: "Bạn muốn ghi chép gì?",
    backToHomeAria: "Về trang chủ",
    measureTitle: "Ghi số đo",
    measureSub: "EC, pH, nhiệt độ dung dịch và hơn nữa",
    journalTitle: "Nhật ký canh tác",
    journalSub: "Bổ sung, thay dung dịch, bảo trì",

    bedLoadFailed: "Không tải được danh sách luống.",
    noBedsTitle: "Chưa có luống",
    noBedsMeasureMsg: "Đăng ký nông trại và luống trước khi ghi số đo.",
    noBedsJournalMsg: "Đăng ký nông trại và luống trước khi viết nhật ký.",
    saveFailed: "Không lưu được. Vui lòng thử lại.",
    invalidNumber: "{{field}}: hãy nhập số.",
    savedAgain: "Ghi thêm một bản",

    stepBed: "Chọn luống",
    stepConcentration: "Nồng độ dung dịch",
    stepEnvironment: "Môi trường dung dịch",
    stepCirculation: "Đường tuần hoàn",
    notice: "Cảm biến đang tự ghi. Màn hình này dùng để ghi số đo cầm tay song song để đối chiếu với cảm biến.",
    ecPlaceholder: "vd: 1.85",
    phPlaceholder: "vd: 6.0",
    tempPlaceholder: "vd: 21.5",
    doPlaceholder: "vd: 7.0",
    flowPlaceholder: "vd: 12",
    dpPlaceholder: "vd: 15",
    ecTarget: "Mục tiêu luống {{target}} ±{{tol}} mS/cm",
    ecNoTarget: "Luống này chưa có EC mục tiêu — đặt công thức trong Nông trại & thiết bị để hiển thị ở đây.",
    phTarget: "Mục tiêu luống {{target}} ±{{tol}}",
    phNoTarget: "Rau ăn lá: khuyến nghị 5.5–6.5",
    tempHint: "Vùng rễ khuyến nghị 18–22 °C (khi chạy chiller)",
    doHint: "Khuyến nghị từ 5 ppm trở lên",
    flowHint: "Nếu khác nhiều so với bình thường, kiểm tra bơm và đường ống.",
    dpHint: "Tăng cao hơn bình thường gợi ý đèn UV hoặc lọc bị tắc.",
    ecRangeError: "Nhập EC trong khoảng 0.1–10 mS/cm.",
    phRangeError: "Nhập pH trong khoảng 0–14.",
    savedViewTrend: "Xem xu hướng",

    jStepBedDate: "Luống & ngày",
    jStepNutrient: "Dung dịch dinh dưỡng",
    jStepWork: "Công việc canh tác",
    jStepCheck: "Kiểm tra thiết bị",
    nutrientType: "Loại dung dịch",
    nutrientRefill: "Lượng bổ sung",
    nutrientRefillUnit: "L",
    nutrientRefillPlaceholder: "vd: 40",
    nutrientRefillHint: "Lượng đã thêm vào bồn hôm nay.",
    refillTimes: "Số lần bổ sung",
    refillTimesUnit: "lần/ngày",
    refillTimesPlaceholder: "vd: 2",
    exchangeRate: "Tỷ lệ thay dung dịch",
    exchangeRatePlaceholder: "vd: 30",
    exchangeRateHint: "100 nếu thay toàn bộ; nếu không, ghi phần đã thay.",
    pestControl: "Đã phòng trừ sâu bệnh",
    pestAgent: "Tên thuốc",
    pestAgentPlaceholder: "Nhập tên thuốc",
    inputApplied: "Đã bón vật tư",
    inputType: "Loại vật tư",
    inputAmount: "Lượng",
    inputAmountUnit: "kg",
    inputAmountPlaceholder: "vd: 0.5",
    inputAmountHint: "Vật tư dạng lỏng ghi theo L (1 L tính là 1 kg).",
    checkPump: "Bơm tuần hoàn",
    checkFilterUv: "Lọc & đèn UV",
    checkChiller: "Chiller vùng rễ",
    checkGrowth: "Tình trạng cây",
    notes: "Ghi chú",
    notesPlaceholder: "Ghi điều bất thường. Sản lượng thu hoạch cũng ghi ở đây.",
    savedViewJournal: "Xem nhật ký canh tác",
  },
  id: {
    chooseTitle: "Apa yang ingin dicatat?",
    backToHomeAria: "Kembali ke beranda",
    measureTitle: "Catat pengukuran",
    measureSub: "EC, pH, suhu larutan, dan lainnya",
    journalTitle: "Jurnal tani",
    journalSub: "Isi ulang, penggantian, perawatan",

    bedLoadFailed: "Gagal memuat daftar bedeng.",
    noBedsTitle: "Belum ada bedeng",
    noBedsMeasureMsg: "Daftarkan kebun dan bedeng sebelum mencatat pengukuran.",
    noBedsJournalMsg: "Daftarkan kebun dan bedeng sebelum menulis jurnal.",
    saveFailed: "Gagal menyimpan. Silakan coba lagi.",
    invalidNumber: "{{field}}: masukkan angka.",
    savedAgain: "Catat lagi",

    stepBed: "Pilih bedeng",
    stepConcentration: "Kepekatan larutan",
    stepEnvironment: "Lingkungan larutan",
    stepCirculation: "Jalur sirkulasi",
    notice: "Sensor mencatat otomatis. Layar ini untuk mencatat hasil alat ukur genggam agar bisa dibandingkan dengan sensor.",
    ecPlaceholder: "mis. 1.85",
    phPlaceholder: "mis. 6.0",
    tempPlaceholder: "mis. 21.5",
    doPlaceholder: "mis. 7.0",
    flowPlaceholder: "mis. 12",
    dpPlaceholder: "mis. 15",
    ecTarget: "Target bedeng {{target}} ±{{tol}} mS/cm",
    ecNoTarget: "Bedeng ini belum punya target EC — atur resep di Kebun & perangkat agar tampil di sini.",
    phTarget: "Target bedeng {{target}} ±{{tol}}",
    phNoTarget: "Sayuran daun: disarankan 5.5–6.5",
    tempHint: "Zona akar disarankan 18–22 °C (dengan chiller)",
    doHint: "Disarankan 5 ppm atau lebih",
    flowHint: "Jika jauh dari biasanya, periksa pompa dan pipa.",
    dpHint: "Naik di atas biasanya menandakan unit UV atau filter tersumbat.",
    ecRangeError: "Masukkan EC antara 0.1 dan 10 mS/cm.",
    phRangeError: "Masukkan pH antara 0 dan 14.",
    savedViewTrend: "Lihat tren",

    jStepBedDate: "Bedeng & tanggal",
    jStepNutrient: "Larutan nutrisi",
    jStepWork: "Pekerjaan budidaya",
    jStepCheck: "Pemeriksaan peralatan",
    nutrientType: "Jenis nutrisi",
    nutrientRefill: "Jumlah isi ulang",
    nutrientRefillUnit: "L",
    nutrientRefillPlaceholder: "mis. 40",
    nutrientRefillHint: "Volume yang ditambahkan ke tandon hari ini.",
    refillTimes: "Frekuensi isi ulang",
    refillTimesUnit: "kali/hari",
    refillTimesPlaceholder: "mis. 2",
    exchangeRate: "Persentase penggantian",
    exchangeRatePlaceholder: "mis. 30",
    exchangeRateHint: "100 jika diganti seluruhnya; jika tidak, tulis bagian yang diganti.",
    pestControl: "Pengendalian hama dilakukan",
    pestAgent: "Nama bahan",
    pestAgentPlaceholder: "Masukkan nama bahan",
    inputApplied: "Bahan diaplikasikan",
    inputType: "Jenis bahan",
    inputAmount: "Jumlah",
    inputAmountUnit: "kg",
    inputAmountPlaceholder: "mis. 0.5",
    inputAmountHint: "Bahan cair ditulis dalam L (1 L dihitung 1 kg).",
    checkPump: "Pompa sirkulasi",
    checkFilterUv: "Filter & unit UV",
    checkChiller: "Chiller zona akar",
    checkGrowth: "Kondisi tanaman",
    notes: "Catatan",
    notesPlaceholder: "Catat hal yang tidak biasa. Hasil panen juga ditulis di sini.",
    savedViewJournal: "Lihat jurnal tani",
  },
}
