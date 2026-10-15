// 농업(스마트팜) 사전 — farms 섹션. 4개 언어를 한 파일에 둔다(설계서 mode-split.md 6장).
//
// `/daumlabs/farms` 농장·베드·기기 관리 화면(components/agri/agri-farms-view.tsx 와
// components/agri/farms/*)이 읽는다. 저장·취소·삭제·"n분 전" 같은 범용 문구는
// 기존 `useT().t.common / t.time` 을 쓰고, 상태 라벨·항목 이름은 `common` 섹션을 쓴다.
//
// 어휘 원칙: 베드·정식·수확 — 새우 어휘는 쓰지 않는다(수아 시안 mode-split-ui.md 1-6).
// 데이터 모델 이름(tank·stocking_date·harvest_date)은 코드에만 남고 화면에는 나오지 않는다.
import type { Locale } from "@/lib/i18n"

export interface AgriFarmsDict {
  title: string
  subtitle: string
  mapAria: string

  // ── 농장 ──
  farmsHeading: string
  farmInfo: string
  addFarm: string
  editFarm: string
  deleteFarm: string
  farmName: string
  farmNamePlaceholder: string
  farmNameRequired: string
  address: string
  addressPlaceholder: string
  owner: string
  ownerPlaceholder: string
  area: string
  areaPlaceholder: string
  farmType: string
  farmTypeShrimp: string
  farmTypeAgri: string
  /** 수정 폼 유형 2택 아래 한 줄 안내. */
  farmTypeChangeNote: string
  /** 양식장으로 바꿔 저장했을 때 토스트. */
  farmMoved: string
  deleteFarmConfirm: string
  farmCreated: string
  farmUpdated: string
  farmDeleted: string
  farmLimitMsg: string

  // ── 베드 ──
  /** `{{name}}` = 농장 이름. */
  bedsHeading: string
  /** `{{n}}` = 베드 수. */
  bedCountN: string
  /** `{{n}}` = 재배 일차. 정식일이 있을 때만 쓴다. */
  cropDayN: string
  addBed: string
  editBed: string
  deleteBed: string
  bedName: string
  bedNamePlaceholder: string
  bedNameRequired: string
  bedType: string
  bedTypeIndoor: string
  bedTypeSemi: string
  bedTypeOutdoor: string
  volume: string
  volumeOptional: string
  volumeHint: string
  volumeUnit: string
  volumePlaceholder: string
  volumeRangeError: string
  plantingDate: string
  harvestPlanDate: string
  recipeTitle: string
  recipeNotSet: string
  recipeOptional: string
  recipeHint: string
  targetEc: string
  ecUnit: string
  targetEcPlaceholder: string
  ecTolerance: string
  targetPh: string
  targetPhPlaceholder: string
  phTolerance: string
  ecRangeError: string
  ecToleranceRangeError: string
  phRangeError: string
  phToleranceRangeError: string
  deleteBedConfirm: string
  bedCreated: string
  bedUpdated: string
  bedDeleted: string
  bedLimitMsg: string
  registered: string

  // ── 기기 ──
  devicesHeading: string
  noDevices: string
  /** `{{name}}` = 기기 이름. */
  deviceActiveAria: string
  deleteDevice: string
  /** `{{name}}` = 기기 이름. */
  deleteDeviceAria: string
  deleteDeviceConfirm: string
  deviceNeverSeen: string
  versionUnknown: string
  requestUpdate: string
  /** `{{v}}` = 새 버전. */
  newVersion: string
  updateStatusRequested: string
  updateStatusDownloading: string
  updateStatusApplied: string
  updateStatusFailed: string
  updateStatusRolledBack: string
  updatePendingNote: string
  cancelUpdate: string
  updateRequestFailed: string
  firmwareLatest: string

  // ── 빈 상태·오류 ──
  noFarms: string
  noFarmsMsg: string
  noBeds: string
  noBedsMsg: string
  saveFailed: string
  deleteFailed: string
}

export const agriFarms: Record<Locale, AgriFarmsDict> = {
  ko: {
    title: "농장·기기 관리",
    subtitle: "농장과 베드를 등록하고 기기를 연결하세요",
    mapAria: "농장 위치 지도",

    farmsHeading: "농장",
    farmInfo: "농장 정보",
    addFarm: "농장 추가",
    editFarm: "농장 수정",
    deleteFarm: "농장 삭제",
    farmName: "농장 이름",
    farmNamePlaceholder: "예: 제1온실",
    farmNameRequired: "농장 이름을 입력해 주세요.",
    address: "주소",
    addressPlaceholder: "주소를 검색하세요",
    owner: "대표자",
    ownerPlaceholder: "예: 김농부",
    area: "면적 (㎡)",
    areaPlaceholder: "예: 1200",
    farmType: "농장 유형",
    farmTypeShrimp: "양식장",
    farmTypeAgri: "스마트팜",
    farmTypeChangeNote: "유형을 양식장으로 바꾸면 이 농장은 양식장 화면으로 옮겨집니다.",
    farmMoved: "양식장 화면으로 옮겨졌습니다.",
    deleteFarmConfirm: "이 농장과 모든 베드 데이터가 삭제됩니다. 계속하시겠습니까?",
    farmCreated: "농장이 추가되었습니다.",
    farmUpdated: "농장이 수정되었습니다.",
    farmDeleted: "농장이 삭제되었습니다.",
    farmLimitMsg: "현재 플랜의 농장 최대 개수에 도달했습니다.",

    bedsHeading: "{{name}} 베드",
    bedCountN: "베드 {{n}}",
    cropDayN: "재배 {{n}}일차",
    addBed: "베드 추가",
    editBed: "베드 수정",
    deleteBed: "베드 삭제",
    bedName: "베드 이름",
    bedNamePlaceholder: "예: A동 1베드",
    bedNameRequired: "베드 이름을 입력해 주세요.",
    bedType: "베드 유형",
    bedTypeIndoor: "실내",
    bedTypeSemi: "반실내",
    bedTypeOutdoor: "노지",
    volume: "양액조 용량",
    volumeOptional: "(㎥, 선택)",
    volumeHint: "1 ㎥ = 1,000 L",
    volumeUnit: "㎥",
    volumePlaceholder: "예: 1",
    volumeRangeError: "양액조 용량은 0.1~100,000 ㎥ 범위로 입력해 주세요.",
    plantingDate: "정식일",
    harvestPlanDate: "수확 예정일",
    recipeTitle: "양액 레시피",
    recipeNotSet: "레시피 미설정",
    recipeOptional: "(선택)",
    recipeHint: "목표값을 벗어나면 알림을 보내드립니다.",
    targetEc: "목표 EC",
    ecUnit: "mS/cm",
    targetEcPlaceholder: "예: 1.8",
    ecTolerance: "EC 허용 오차",
    targetPh: "목표 pH",
    targetPhPlaceholder: "예: 6.0",
    phTolerance: "pH 허용 오차",
    ecRangeError: "목표 EC는 0.1~10 mS/cm 범위로 입력해 주세요.",
    ecToleranceRangeError: "EC 허용 오차는 0.01~2 mS/cm 범위로 입력해 주세요.",
    phRangeError: "목표 pH는 3~9 범위로 입력해 주세요.",
    phToleranceRangeError: "pH 허용 오차는 0.1~2 범위로 입력해 주세요.",
    deleteBedConfirm: "이 베드와 모든 측정 기록이 삭제됩니다. 계속하시겠습니까?",
    bedCreated: "베드가 추가되었습니다.",
    bedUpdated: "베드가 수정되었습니다.",
    bedDeleted: "베드가 삭제되었습니다.",
    bedLimitMsg: "현재 플랜의 베드 최대 개수에 도달했습니다.",
    registered: "등록",

    devicesHeading: "기기",
    noDevices: "연결된 기기가 없습니다",
    deviceActiveAria: "{{name}} 사용 여부",
    deleteDevice: "기기 삭제",
    deleteDeviceAria: "{{name}} 삭제",
    deleteDeviceConfirm: "이 기기 연결을 해제합니다. 기기는 더 이상 데이터를 보낼 수 없습니다.",
    deviceNeverSeen: "수신 기록 없음",
    versionUnknown: "버전 미확인",
    requestUpdate: "업데이트 요청",
    newVersion: "새 버전 {{v}}",
    updateStatusRequested: "업데이트 예정",
    updateStatusDownloading: "내려받는 중",
    updateStatusApplied: "적용됨",
    updateStatusFailed: "업데이트 실패",
    updateStatusRolledBack: "이전 버전으로 되돌림",
    updatePendingNote: "다음 확인 때 업데이트됩니다 (최대 5분).",
    cancelUpdate: "요청 취소",
    updateRequestFailed: "업데이트 요청에 실패했습니다. 다시 시도해 주세요.",
    firmwareLatest: "최신",

    noFarms: "등록된 농장이 없습니다",
    noFarmsMsg: "농장을 추가하여 양액 관리를 시작하세요.",
    noBeds: "등록된 베드가 없습니다",
    noBedsMsg: "베드를 추가하여 양액 모니터링을 시작하세요.",
    saveFailed: "저장하지 못했습니다. 다시 시도해 주세요.",
    deleteFailed: "삭제하지 못했습니다. 다시 시도해 주세요.",
  },
  en: {
    title: "Farms & devices",
    subtitle: "Register farms and beds, connect devices",
    mapAria: "Farm location map",

    farmsHeading: "Farms",
    farmInfo: "Farm details",
    addFarm: "Add farm",
    editFarm: "Edit farm",
    deleteFarm: "Delete farm",
    farmName: "Farm name",
    farmNamePlaceholder: "e.g. Greenhouse 1",
    farmNameRequired: "Enter a farm name.",
    address: "Address",
    addressPlaceholder: "Search for an address",
    owner: "Owner",
    ownerPlaceholder: "e.g. Jane Grower",
    area: "Area (m²)",
    areaPlaceholder: "e.g. 1200",
    farmType: "Farm type",
    farmTypeShrimp: "Aquaculture",
    farmTypeAgri: "Smart farm",
    farmTypeChangeNote: "Changing to aquaculture moves this farm to the aquaculture screens.",
    farmMoved: "Moved to the aquaculture screens.",
    deleteFarmConfirm: "This farm and all its bed data will be deleted. Continue?",
    farmCreated: "Farm added.",
    farmUpdated: "Farm updated.",
    farmDeleted: "Farm deleted.",
    farmLimitMsg: "Your plan's farm limit has been reached.",

    bedsHeading: "{{name}} beds",
    bedCountN: "{{n}} beds",
    cropDayN: "Day {{n}}",
    addBed: "Add bed",
    editBed: "Edit bed",
    deleteBed: "Delete bed",
    bedName: "Bed name",
    bedNamePlaceholder: "e.g. House A – Bed 1",
    bedNameRequired: "Enter a bed name.",
    bedType: "Bed type",
    bedTypeIndoor: "Indoor",
    bedTypeSemi: "Semi-indoor",
    bedTypeOutdoor: "Outdoor",
    volume: "Tank volume",
    volumeOptional: "(m³, optional)",
    volumeHint: "1 m³ = 1,000 L",
    volumeUnit: "m³",
    volumePlaceholder: "e.g. 1",
    volumeRangeError: "Enter a tank volume between 0.1 and 100,000 m³.",
    plantingDate: "Transplant date",
    harvestPlanDate: "Planned harvest",
    recipeTitle: "Nutrient recipe",
    recipeNotSet: "No recipe set",
    recipeOptional: "(optional)",
    recipeHint: "We alert you when readings leave the target range.",
    targetEc: "Target EC",
    ecUnit: "mS/cm",
    targetEcPlaceholder: "e.g. 1.8",
    ecTolerance: "EC tolerance",
    targetPh: "Target pH",
    targetPhPlaceholder: "e.g. 6.0",
    phTolerance: "pH tolerance",
    ecRangeError: "Enter a target EC between 0.1 and 10 mS/cm.",
    ecToleranceRangeError: "Enter an EC tolerance between 0.01 and 2 mS/cm.",
    phRangeError: "Enter a target pH between 3 and 9.",
    phToleranceRangeError: "Enter a pH tolerance between 0.1 and 2.",
    deleteBedConfirm: "This bed and all its readings will be deleted. Continue?",
    bedCreated: "Bed added.",
    bedUpdated: "Bed updated.",
    bedDeleted: "Bed deleted.",
    bedLimitMsg: "Your plan's bed limit has been reached.",
    registered: "Registered",

    devicesHeading: "Devices",
    noDevices: "No devices connected",
    deviceActiveAria: "{{name}} enabled",
    deleteDevice: "Remove device",
    deleteDeviceAria: "Remove {{name}}",
    deleteDeviceConfirm: "This device will be disconnected and can no longer send data.",
    deviceNeverSeen: "No data received yet",
    versionUnknown: "Version unknown",
    requestUpdate: "Request update",
    newVersion: "New version {{v}}",
    updateStatusRequested: "Update scheduled",
    updateStatusDownloading: "Downloading",
    updateStatusApplied: "Applied",
    updateStatusFailed: "Update failed",
    updateStatusRolledBack: "Rolled back",
    updatePendingNote: "Will update at the next check-in (within 5 min).",
    cancelUpdate: "Cancel request",
    updateRequestFailed: "Could not request the update. Please try again.",
    firmwareLatest: "Up to date",

    noFarms: "No farms yet",
    noFarmsMsg: "Add a farm to start managing nutrient solution.",
    noBeds: "No beds yet",
    noBedsMsg: "Add a bed to start monitoring.",
    saveFailed: "Could not save. Please try again.",
    deleteFailed: "Could not delete. Please try again.",
  },
  vi: {
    title: "Nông trại & thiết bị",
    subtitle: "Đăng ký nông trại, luống và kết nối thiết bị",
    mapAria: "Bản đồ vị trí nông trại",

    farmsHeading: "Nông trại",
    farmInfo: "Thông tin nông trại",
    addFarm: "Thêm nông trại",
    editFarm: "Sửa nông trại",
    deleteFarm: "Xóa nông trại",
    farmName: "Tên nông trại",
    farmNamePlaceholder: "VD: Nhà kính 1",
    farmNameRequired: "Nhập tên nông trại.",
    address: "Địa chỉ",
    addressPlaceholder: "Tìm địa chỉ",
    owner: "Chủ nông trại",
    ownerPlaceholder: "VD: Nguyễn Văn A",
    area: "Diện tích (m²)",
    areaPlaceholder: "VD: 1200",
    farmType: "Loại nông trại",
    farmTypeShrimp: "Trại tôm",
    farmTypeAgri: "Nông trại thông minh",
    farmTypeChangeNote: "Đổi sang trại tôm sẽ chuyển nông trại này sang màn hình trại tôm.",
    farmMoved: "Đã chuyển sang màn hình trại tôm.",
    deleteFarmConfirm: "Nông trại này và toàn bộ dữ liệu luống sẽ bị xóa. Tiếp tục?",
    farmCreated: "Đã thêm nông trại.",
    farmUpdated: "Đã cập nhật nông trại.",
    farmDeleted: "Đã xóa nông trại.",
    farmLimitMsg: "Đã đạt số nông trại tối đa của gói hiện tại.",

    bedsHeading: "Luống của {{name}}",
    bedCountN: "{{n}} luống",
    cropDayN: "Ngày {{n}}",
    addBed: "Thêm luống",
    editBed: "Sửa luống",
    deleteBed: "Xóa luống",
    bedName: "Tên luống",
    bedNamePlaceholder: "VD: Nhà A – Luống 1",
    bedNameRequired: "Nhập tên luống.",
    bedType: "Loại luống",
    bedTypeIndoor: "Trong nhà",
    bedTypeSemi: "Bán trong nhà",
    bedTypeOutdoor: "Ngoài trời",
    volume: "Dung tích bồn dinh dưỡng",
    volumeOptional: "(m³, tùy chọn)",
    volumeHint: "1 m³ = 1.000 L",
    volumeUnit: "m³",
    volumePlaceholder: "VD: 1",
    volumeRangeError: "Nhập dung tích từ 0,1 đến 100.000 m³.",
    plantingDate: "Ngày trồng",
    harvestPlanDate: "Ngày thu hoạch dự kiến",
    recipeTitle: "Công thức dinh dưỡng",
    recipeNotSet: "Chưa đặt công thức",
    recipeOptional: "(tùy chọn)",
    recipeHint: "Chúng tôi sẽ cảnh báo khi giá trị đo vượt khỏi mục tiêu.",
    targetEc: "EC mục tiêu",
    ecUnit: "mS/cm",
    targetEcPlaceholder: "VD: 1.8",
    ecTolerance: "Dung sai EC",
    targetPh: "pH mục tiêu",
    targetPhPlaceholder: "VD: 6.0",
    phTolerance: "Dung sai pH",
    ecRangeError: "Nhập EC mục tiêu từ 0,1 đến 10 mS/cm.",
    ecToleranceRangeError: "Nhập dung sai EC từ 0,01 đến 2 mS/cm.",
    phRangeError: "Nhập pH mục tiêu từ 3 đến 9.",
    phToleranceRangeError: "Nhập dung sai pH từ 0,1 đến 2.",
    deleteBedConfirm: "Luống này và toàn bộ dữ liệu đo sẽ bị xóa. Tiếp tục?",
    bedCreated: "Đã thêm luống.",
    bedUpdated: "Đã cập nhật luống.",
    bedDeleted: "Đã xóa luống.",
    bedLimitMsg: "Đã đạt số luống tối đa của gói hiện tại.",
    registered: "Đăng ký",

    devicesHeading: "Thiết bị",
    noDevices: "Chưa có thiết bị kết nối",
    deviceActiveAria: "Bật/tắt {{name}}",
    deleteDevice: "Gỡ thiết bị",
    deleteDeviceAria: "Gỡ {{name}}",
    deleteDeviceConfirm: "Thiết bị này sẽ bị ngắt kết nối và không thể gửi dữ liệu nữa.",
    deviceNeverSeen: "Chưa nhận dữ liệu",
    versionUnknown: "Chưa rõ phiên bản",
    requestUpdate: "Yêu cầu cập nhật",
    newVersion: "Phiên bản mới {{v}}",
    updateStatusRequested: "Đã lên lịch cập nhật",
    updateStatusDownloading: "Đang tải xuống",
    updateStatusApplied: "Đã áp dụng",
    updateStatusFailed: "Cập nhật thất bại",
    updateStatusRolledBack: "Đã khôi phục bản cũ",
    updatePendingNote: "Sẽ cập nhật ở lần kiểm tra tiếp theo (trong 5 phút).",
    cancelUpdate: "Hủy yêu cầu",
    updateRequestFailed: "Không thể yêu cầu cập nhật. Vui lòng thử lại.",
    firmwareLatest: "Mới nhất",

    noFarms: "Chưa có nông trại",
    noFarmsMsg: "Thêm nông trại để bắt đầu quản lý dung dịch dinh dưỡng.",
    noBeds: "Chưa có luống",
    noBedsMsg: "Thêm luống để bắt đầu giám sát.",
    saveFailed: "Không lưu được. Vui lòng thử lại.",
    deleteFailed: "Không xóa được. Vui lòng thử lại.",
  },
  id: {
    title: "Kebun & perangkat",
    subtitle: "Daftarkan kebun dan bedeng, sambungkan perangkat",
    mapAria: "Peta lokasi kebun",

    farmsHeading: "Kebun",
    farmInfo: "Detail kebun",
    addFarm: "Tambah kebun",
    editFarm: "Ubah kebun",
    deleteFarm: "Hapus kebun",
    farmName: "Nama kebun",
    farmNamePlaceholder: "mis. Rumah kaca 1",
    farmNameRequired: "Masukkan nama kebun.",
    address: "Alamat",
    addressPlaceholder: "Cari alamat",
    owner: "Pemilik",
    ownerPlaceholder: "mis. Budi Petani",
    area: "Luas (m²)",
    areaPlaceholder: "mis. 1200",
    farmType: "Jenis kebun",
    farmTypeShrimp: "Tambak udang",
    farmTypeAgri: "Smart farm",
    farmTypeChangeNote: "Mengubah ke tambak udang memindahkan kebun ini ke layar tambak udang.",
    farmMoved: "Dipindahkan ke layar tambak udang.",
    deleteFarmConfirm: "Kebun ini dan semua data bedengnya akan dihapus. Lanjutkan?",
    farmCreated: "Kebun ditambahkan.",
    farmUpdated: "Kebun diperbarui.",
    farmDeleted: "Kebun dihapus.",
    farmLimitMsg: "Batas jumlah kebun pada paket Anda telah tercapai.",

    bedsHeading: "Bedeng {{name}}",
    bedCountN: "{{n}} bedeng",
    cropDayN: "Hari ke-{{n}}",
    addBed: "Tambah bedeng",
    editBed: "Ubah bedeng",
    deleteBed: "Hapus bedeng",
    bedName: "Nama bedeng",
    bedNamePlaceholder: "mis. Rumah A – Bedeng 1",
    bedNameRequired: "Masukkan nama bedeng.",
    bedType: "Jenis bedeng",
    bedTypeIndoor: "Dalam ruangan",
    bedTypeSemi: "Semi dalam ruangan",
    bedTypeOutdoor: "Luar ruangan",
    volume: "Volume tangki nutrisi",
    volumeOptional: "(m³, opsional)",
    volumeHint: "1 m³ = 1.000 L",
    volumeUnit: "m³",
    volumePlaceholder: "mis. 1",
    volumeRangeError: "Masukkan volume antara 0,1 dan 100.000 m³.",
    plantingDate: "Tanggal tanam",
    harvestPlanDate: "Rencana panen",
    recipeTitle: "Resep nutrisi",
    recipeNotSet: "Resep belum diatur",
    recipeOptional: "(opsional)",
    recipeHint: "Kami memberi peringatan saat pembacaan keluar dari rentang target.",
    targetEc: "EC target",
    ecUnit: "mS/cm",
    targetEcPlaceholder: "mis. 1.8",
    ecTolerance: "Toleransi EC",
    targetPh: "pH target",
    targetPhPlaceholder: "mis. 6.0",
    phTolerance: "Toleransi pH",
    ecRangeError: "Masukkan EC target antara 0,1 dan 10 mS/cm.",
    ecToleranceRangeError: "Masukkan toleransi EC antara 0,01 dan 2 mS/cm.",
    phRangeError: "Masukkan pH target antara 3 dan 9.",
    phToleranceRangeError: "Masukkan toleransi pH antara 0,1 dan 2.",
    deleteBedConfirm: "Bedeng ini dan semua pembacaannya akan dihapus. Lanjutkan?",
    bedCreated: "Bedeng ditambahkan.",
    bedUpdated: "Bedeng diperbarui.",
    bedDeleted: "Bedeng dihapus.",
    bedLimitMsg: "Batas jumlah bedeng pada paket Anda telah tercapai.",
    registered: "Terdaftar",

    devicesHeading: "Perangkat",
    noDevices: "Belum ada perangkat tersambung",
    deviceActiveAria: "Aktifkan {{name}}",
    deleteDevice: "Lepas perangkat",
    deleteDeviceAria: "Lepas {{name}}",
    deleteDeviceConfirm: "Perangkat ini akan diputus dan tidak dapat mengirim data lagi.",
    deviceNeverSeen: "Belum ada data diterima",
    versionUnknown: "Versi tidak diketahui",
    requestUpdate: "Minta pembaruan",
    newVersion: "Versi baru {{v}}",
    updateStatusRequested: "Pembaruan dijadwalkan",
    updateStatusDownloading: "Mengunduh",
    updateStatusApplied: "Diterapkan",
    updateStatusFailed: "Pembaruan gagal",
    updateStatusRolledBack: "Dikembalikan ke versi lama",
    updatePendingNote: "Akan diperbarui pada pengecekan berikutnya (dalam 5 menit).",
    cancelUpdate: "Batalkan permintaan",
    updateRequestFailed: "Tidak dapat meminta pembaruan. Silakan coba lagi.",
    firmwareLatest: "Terbaru",

    noFarms: "Belum ada kebun",
    noFarmsMsg: "Tambahkan kebun untuk mulai mengelola larutan nutrisi.",
    noBeds: "Belum ada bedeng",
    noBedsMsg: "Tambahkan bedeng untuk mulai memantau.",
    saveFailed: "Tidak dapat menyimpan. Silakan coba lagi.",
    deleteFailed: "Tidak dapat menghapus. Silakan coba lagi.",
  },
}
