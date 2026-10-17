// 농업(스마트팜) 사전 — journal 섹션(영농 일지 목록 `/daumlabs/journal`).
// 4개 언어를 한 파일에 둔다(설계서 mode-split.md 6장, 시안 mode-split-ui.md 6-5).
//
// 일지 쓰기 폼(`/daumlabs/record/journal`)의 문구는 record 섹션(2A)이다. 여기 있는
// 폼 라벨은 **수정 다이얼로그** 전용 — 목록 화면이 자기 사전만 읽게 하기 위해 둔다.
// 저장·취소·삭제·"회/일" 같은 범용 문구는 `useT().t.common` 을 그대로 쓴다.
import type { Locale } from "@/lib/i18n"

export interface AgriJournalDict {
  title: string
  subtitle: string
  newEntry: string

  /** 필터 줄 */
  allBeds: string
  bedFilterAria: string
  dateFrom: string
  dateTo: string
  searchPlaceholder: string
  searchAria: string
  resetFilters: string

  /** 빈 상태 */
  noBedsTitle: string
  noBedsMsg: string
  addBedCta: string
  noEntries: string
  noEntriesMsg: string
  noMatch: string

  /** 카드 — 4타일·요약 줄 */
  tileRefill: string
  tileRefillTimes: string
  tileExchange: string
  tileInput: string
  inputNone: string
  inputApplied: string
  nutrientLabel: string
  pestLabel: string
  checksLabel: string
  checkPump: string
  checkFilterUv: string
  checkChiller: string
  checkGrowth: string
  me: string
  loadMore: string

  /** 수정·삭제 */
  edit: string
  editTitle: string
  /** `{{date}}` */
  editAria: string
  delete: string
  deleteTitle: string
  /** `{{date}}` */
  deleteAria: string
  deleteConfirm: string
  updated: string
  deleted: string
  saveFailed: string
  deleteFailed: string

  /** 수정 폼 라벨 */
  nutrientType: string
  refillAmount: string
  refillTimes: string
  exchangeRate: string
  pestControl: string
  pestAgent: string
  pestAgentPlaceholder: string
  inputType: string
  inputAmount: string
  notes: string
  notesPlaceholder: string

  /** CSV — 열 머리. 단위는 코드가 괄호로 붙인다. */
  csv: string
  csvPrefix: string
  csvDate: string
  csvBed: string
  csvYes: string
  csvNo: string
}

export const agriJournal: Record<Locale, AgriJournalDict> = {
  ko: {
    title: "영농 일지",
    subtitle: "양액 교환·방제·설비 점검 등 일상 관리 기록",
    newEntry: "일지 쓰기",
    allBeds: "베드 전체",
    bedFilterAria: "베드로 필터",
    dateFrom: "시작일",
    dateTo: "종료일",
    searchPlaceholder: "메모 검색",
    searchAria: "메모 검색",
    resetFilters: "필터 초기화",
    noBedsTitle: "등록된 베드가 없습니다",
    noBedsMsg: "베드를 추가하면 영농 일지를 쓸 수 있습니다.",
    addBedCta: "베드 추가하기",
    noEntries: "일지 기록이 없습니다",
    noEntriesMsg: "양액 교환·방제·설비 점검 등 농장 작업을 기록하세요.",
    noMatch: "조건에 맞는 일지가 없습니다",
    tileRefill: "양액 보충",
    tileRefillTimes: "보충 횟수",
    tileExchange: "양액 교환",
    tileInput: "자재 투입",
    inputNone: "투입 없음",
    inputApplied: "투입",
    nutrientLabel: "양액",
    pestLabel: "방제",
    checksLabel: "점검",
    checkPump: "순환 펌프",
    checkFilterUv: "필터·UV",
    checkChiller: "칠러",
    checkGrowth: "생육",
    me: "나",
    loadMore: "더 보기",
    edit: "수정",
    editTitle: "일지 수정",
    editAria: "{{date}} 일지 수정",
    delete: "삭제",
    deleteTitle: "일지 삭제",
    deleteAria: "{{date}} 일지 삭제",
    deleteConfirm: "이 일지를 삭제합니다. 되돌릴 수 없습니다.",
    updated: "일지가 수정되었습니다.",
    deleted: "일지가 삭제되었습니다.",
    saveFailed: "저장하지 못했습니다. 다시 시도해 주세요.",
    deleteFailed: "삭제하지 못했습니다. 다시 시도해 주세요.",
    nutrientType: "양액 종류",
    refillAmount: "양액 보충량",
    refillTimes: "보충 횟수",
    exchangeRate: "양액 교환율",
    pestControl: "방제 실시",
    pestAgent: "약제명",
    pestAgentPlaceholder: "약제 이름을 입력하세요",
    inputType: "자재 종류",
    inputAmount: "투입량",
    notes: "메모",
    notesPlaceholder: "특이사항을 적어 주세요. 수확량도 여기에 적습니다.",
    csv: "CSV",
    csvPrefix: "영농일지",
    csvDate: "날짜",
    csvBed: "베드",
    csvYes: "예",
    csvNo: "아니오",
  },
  en: {
    title: "Farm journal",
    subtitle: "Daily log of exchanges, pest control and maintenance",
    newEntry: "New entry",
    allBeds: "All beds",
    bedFilterAria: "Filter by bed",
    dateFrom: "From",
    dateTo: "To",
    searchPlaceholder: "Search notes",
    searchAria: "Search notes",
    resetFilters: "Reset filters",
    noBedsTitle: "No beds yet",
    noBedsMsg: "Add a bed to start writing journal entries.",
    addBedCta: "Add a bed",
    noEntries: "No journal entries",
    noEntriesMsg: "Record exchanges, pest control and maintenance.",
    noMatch: "No entries match the filters",
    tileRefill: "Refill",
    tileRefillTimes: "Refills",
    tileExchange: "Exchange",
    tileInput: "Input",
    inputNone: "None",
    inputApplied: "Applied",
    nutrientLabel: "Nutrient",
    pestLabel: "Pest control",
    checksLabel: "Checks",
    checkPump: "Pump",
    checkFilterUv: "Filter & UV",
    checkChiller: "Chiller",
    checkGrowth: "Crop",
    me: "Me",
    loadMore: "Load more",
    edit: "Edit",
    editTitle: "Edit entry",
    editAria: "Edit entry for {{date}}",
    delete: "Delete",
    deleteTitle: "Delete entry",
    deleteAria: "Delete entry for {{date}}",
    deleteConfirm: "This entry will be deleted. This cannot be undone.",
    updated: "Entry updated.",
    deleted: "Entry deleted.",
    saveFailed: "Could not save. Please try again.",
    deleteFailed: "Could not delete. Please try again.",
    nutrientType: "Nutrient type",
    refillAmount: "Refill amount",
    refillTimes: "Refills",
    exchangeRate: "Exchange rate",
    pestControl: "Pest control done",
    pestAgent: "Agent",
    pestAgentPlaceholder: "Enter the agent name",
    inputType: "Input type",
    inputAmount: "Amount",
    notes: "Notes",
    notesPlaceholder: "Note anything unusual. Record harvest amounts here too.",
    csv: "CSV",
    csvPrefix: "farm-journal",
    csvDate: "Date",
    csvBed: "Bed",
    csvYes: "Yes",
    csvNo: "No",
  },
  vi: {
    title: "Nhật ký canh tác",
    subtitle: "Ghi chép hằng ngày: thay dung dịch, phòng trừ, kiểm tra thiết bị",
    newEntry: "Viết nhật ký",
    allBeds: "Tất cả luống",
    bedFilterAria: "Lọc theo luống",
    dateFrom: "Từ ngày",
    dateTo: "Đến ngày",
    searchPlaceholder: "Tìm trong ghi chú",
    searchAria: "Tìm trong ghi chú",
    resetFilters: "Đặt lại bộ lọc",
    noBedsTitle: "Chưa có luống",
    noBedsMsg: "Thêm luống để bắt đầu viết nhật ký.",
    addBedCta: "Thêm luống",
    noEntries: "Chưa có nhật ký",
    noEntriesMsg: "Ghi lại việc thay dung dịch, phòng trừ và kiểm tra thiết bị.",
    noMatch: "Không có nhật ký phù hợp với bộ lọc",
    tileRefill: "Bổ sung",
    tileRefillTimes: "Số lần bổ sung",
    tileExchange: "Thay dung dịch",
    tileInput: "Vật tư",
    inputNone: "Không",
    inputApplied: "Đã dùng",
    nutrientLabel: "Dung dịch",
    pestLabel: "Phòng trừ",
    checksLabel: "Kiểm tra",
    checkPump: "Bơm",
    checkFilterUv: "Lọc & UV",
    checkChiller: "Máy làm lạnh",
    checkGrowth: "Cây trồng",
    me: "Tôi",
    loadMore: "Xem thêm",
    edit: "Sửa",
    editTitle: "Sửa nhật ký",
    editAria: "Sửa nhật ký ngày {{date}}",
    delete: "Xóa",
    deleteTitle: "Xóa nhật ký",
    deleteAria: "Xóa nhật ký ngày {{date}}",
    deleteConfirm: "Nhật ký này sẽ bị xóa. Không thể hoàn tác.",
    updated: "Đã cập nhật nhật ký.",
    deleted: "Đã xóa nhật ký.",
    saveFailed: "Không lưu được. Vui lòng thử lại.",
    deleteFailed: "Không xóa được. Vui lòng thử lại.",
    nutrientType: "Loại dung dịch",
    refillAmount: "Lượng bổ sung",
    refillTimes: "Số lần bổ sung",
    exchangeRate: "Tỷ lệ thay",
    pestControl: "Đã phòng trừ",
    pestAgent: "Tên thuốc",
    pestAgentPlaceholder: "Nhập tên thuốc",
    inputType: "Loại vật tư",
    inputAmount: "Lượng dùng",
    notes: "Ghi chú",
    notesPlaceholder: "Ghi điều bất thường. Sản lượng thu hoạch cũng ghi ở đây.",
    csv: "CSV",
    csvPrefix: "nhat-ky-canh-tac",
    csvDate: "Ngày",
    csvBed: "Luống",
    csvYes: "Có",
    csvNo: "Không",
  },
  id: {
    title: "Jurnal tani",
    subtitle: "Catatan harian penggantian larutan, pengendalian hama, dan perawatan",
    newEntry: "Tulis jurnal",
    allBeds: "Semua bedeng",
    bedFilterAria: "Saring per bedeng",
    dateFrom: "Dari",
    dateTo: "Sampai",
    searchPlaceholder: "Cari catatan",
    searchAria: "Cari catatan",
    resetFilters: "Atur ulang filter",
    noBedsTitle: "Belum ada bedeng",
    noBedsMsg: "Tambahkan bedeng untuk mulai menulis jurnal.",
    addBedCta: "Tambah bedeng",
    noEntries: "Belum ada jurnal",
    noEntriesMsg: "Catat penggantian larutan, pengendalian hama, dan perawatan.",
    noMatch: "Tidak ada jurnal yang cocok dengan filter",
    tileRefill: "Penambahan",
    tileRefillTimes: "Jumlah penambahan",
    tileExchange: "Penggantian",
    tileInput: "Bahan",
    inputNone: "Tidak ada",
    inputApplied: "Diberikan",
    nutrientLabel: "Larutan",
    pestLabel: "Pengendalian hama",
    checksLabel: "Pemeriksaan",
    checkPump: "Pompa",
    checkFilterUv: "Filter & UV",
    checkChiller: "Chiller",
    checkGrowth: "Tanaman",
    me: "Saya",
    loadMore: "Muat lebih banyak",
    edit: "Ubah",
    editTitle: "Ubah jurnal",
    editAria: "Ubah jurnal tanggal {{date}}",
    delete: "Hapus",
    deleteTitle: "Hapus jurnal",
    deleteAria: "Hapus jurnal tanggal {{date}}",
    deleteConfirm: "Jurnal ini akan dihapus. Tidak dapat dibatalkan.",
    updated: "Jurnal diperbarui.",
    deleted: "Jurnal dihapus.",
    saveFailed: "Gagal menyimpan. Silakan coba lagi.",
    deleteFailed: "Gagal menghapus. Silakan coba lagi.",
    nutrientType: "Jenis larutan",
    refillAmount: "Volume penambahan",
    refillTimes: "Jumlah penambahan",
    exchangeRate: "Persentase penggantian",
    pestControl: "Pengendalian hama dilakukan",
    pestAgent: "Nama bahan",
    pestAgentPlaceholder: "Masukkan nama bahan",
    inputType: "Jenis bahan",
    inputAmount: "Jumlah",
    notes: "Catatan",
    notesPlaceholder: "Catat hal yang tidak biasa. Hasil panen juga dicatat di sini.",
    csv: "CSV",
    csvPrefix: "jurnal-tani",
    csvDate: "Tanggal",
    csvBed: "Bedeng",
    csvYes: "Ya",
    csvNo: "Tidak",
  },
}
