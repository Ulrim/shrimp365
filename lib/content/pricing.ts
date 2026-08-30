import type { Locale } from "@/lib/i18n"

export type PricingContent = {
  badge: string
  h1: string
  h1Highlight: string
  lede: string
  cta: string
  ctaNote: string
  featuresTitle: string
  features: { label: string; desc: string }[]
  whyTitle: string
  whyBody: string
  endTitle: string
  endLede: string
  endCta: string
  endGuide: string
}

const KO: PricingContent = {
  badge: "완전 무료 · 광고 기반 운영",
  h1: "모든 기능,",
  h1Highlight: "영원히 무료",
  lede: "Shrimp365는 광고 수익으로 운영됩니다.\n구독료 없이 모든 기능을 제한 없이 사용하세요.",
  cta: "무료로 시작하기",
  ctaNote: "신용카드 불필요 · 즉시 사용 가능",
  featuresTitle: "포함된 기능 전부",
  features: [
    { label: "수질 모니터링", desc: "수온·pH·DO·암모니아 등 9가지 항목, 기준 초과 즉시 알림" },
    { label: "AI 어드바이저", desc: "수질 이상 원인 분석·대처법을 4개 언어로 안내" },
    { label: "양식 일지", desc: "급이·폐사·환수·소독·미생물 기록을 단계별로 간편 입력" },
    { label: "질병 진단", desc: "AHPND·EHP·WSSV·Vibrio 검사 결과 기록 및 추이 분석" },
    { label: "재고 관리", desc: "사료·미생물제·소독제 재고 추적, 소진 전 자동 알림" },
    { label: "리포트", desc: "7일·30일·90일 수질·생산 트렌드 분석 및 내보내기" },
    { label: "양식장·수조", desc: "복수 양식장·수조를 한 화면에서 통합 관리" },
    { label: "IoT 센서 연동", desc: "수질 센서 자동 수집으로 수기 입력 대체" },
  ],
  whyTitle: "왜 무료인가요?",
  whyBody: "Shrimp365는 앱 내 광고 수익으로 운영 비용을 충당합니다.\n사용자는 구독료 없이 전체 기능을 이용하고,\n광고주는 양식업 종사자에게 관련 제품·서비스를 노출합니다.",
  endTitle: "지금 바로 시작하세요",
  endLede: "동남아·미국·유럽 어디서나 스마트폰 브라우저로 접속 가능",
  endCta: "무료 가입",
  endGuide: "사용 가이드 보기",
}

const EN: PricingContent = {
  badge: "Completely free · ad-supported",
  h1: "Every feature,",
  h1Highlight: "free forever",
  lede: "Shrimp365 is funded by advertising.\nUse every feature without limits and without a subscription.",
  cta: "Start free",
  ctaNote: "No credit card · usable immediately",
  featuresTitle: "Everything included",
  features: [
    { label: "Water quality monitoring", desc: "Nine parameters including temperature, pH, DO and ammonia, with instant alerts when a threshold is crossed" },
    { label: "AI advisor", desc: "Cause analysis and remedies for water quality problems, in four languages" },
    { label: "Farm journal", desc: "Feeding, mortality, water exchange, disinfection and probiotics — entered step by step" },
    { label: "Disease diagnosis", desc: "Record and trend AHPND, EHP, WSSV and Vibrio test results" },
    { label: "Inventory", desc: "Track feed, probiotics and disinfectant stock with alerts before you run out" },
    { label: "Reports", desc: "7, 30 and 90-day water quality and production trends, with export" },
    { label: "Farms & tanks", desc: "Manage multiple farms and tanks from a single screen" },
    { label: "IoT sensor integration", desc: "Collect water quality automatically instead of entering it by hand" },
  ],
  whyTitle: "Why is it free?",
  whyBody: "Shrimp365 covers its running costs through in-app advertising.\nUsers get every feature with no subscription,\nand advertisers reach people working in aquaculture.",
  endTitle: "Get started now",
  endLede: "Works from a phone browser anywhere — Southeast Asia, the US, Europe",
  endCta: "Sign up free",
  endGuide: "Read the user guide",
}

const VI: PricingContent = {
  badge: "Hoàn toàn miễn phí · vận hành bằng quảng cáo",
  h1: "Mọi tính năng,",
  h1Highlight: "miễn phí mãi mãi",
  lede: "Shrimp365 hoạt động bằng doanh thu quảng cáo.\nDùng toàn bộ tính năng không giới hạn, không phí thuê bao.",
  cta: "Bắt đầu miễn phí",
  ctaNote: "Không cần thẻ tín dụng · dùng được ngay",
  featuresTitle: "Bao gồm toàn bộ",
  features: [
    { label: "Giám sát chất lượng nước", desc: "Chín chỉ tiêu gồm nhiệt độ, pH, DO, amoniac; cảnh báo ngay khi vượt ngưỡng" },
    { label: "Trợ lý AI", desc: "Phân tích nguyên nhân và cách xử lý sự cố chất lượng nước, bằng bốn ngôn ngữ" },
    { label: "Nhật ký nuôi", desc: "Cho ăn, tôm chết, thay nước, sát trùng, men vi sinh — nhập theo từng bước" },
    { label: "Chẩn đoán bệnh", desc: "Ghi và theo dõi xu hướng kết quả xét nghiệm AHPND, EHP, WSSV, Vibrio" },
    { label: "Quản lý kho", desc: "Theo dõi tồn kho thức ăn, men vi sinh, thuốc sát trùng và báo trước khi sắp hết" },
    { label: "Báo cáo", desc: "Xu hướng chất lượng nước và sản xuất theo 7, 30, 90 ngày, có xuất dữ liệu" },
    { label: "Trại nuôi & ao", desc: "Quản lý nhiều trại và nhiều ao trên cùng một màn hình" },
    { label: "Kết nối cảm biến IoT", desc: "Tự động thu thập chất lượng nước thay cho nhập tay" },
  ],
  whyTitle: "Vì sao miễn phí?",
  whyBody: "Shrimp365 bù đắp chi phí vận hành bằng quảng cáo trong ứng dụng.\nNgười dùng có đầy đủ tính năng mà không mất phí thuê bao,\ncòn nhà quảng cáo tiếp cận được người làm nghề nuôi trồng thủy sản.",
  endTitle: "Bắt đầu ngay",
  endLede: "Dùng được trên trình duyệt điện thoại ở bất cứ đâu — Đông Nam Á, Mỹ, châu Âu",
  endCta: "Đăng ký miễn phí",
  endGuide: "Xem hướng dẫn sử dụng",
}

const ID: PricingContent = {
  badge: "Sepenuhnya gratis · didukung iklan",
  h1: "Semua fitur,",
  h1Highlight: "gratis selamanya",
  lede: "Shrimp365 dibiayai oleh pendapatan iklan.\nPakai semua fitur tanpa batas dan tanpa biaya langganan.",
  cta: "Mulai gratis",
  ctaNote: "Tanpa kartu kredit · langsung bisa dipakai",
  featuresTitle: "Semua sudah termasuk",
  features: [
    { label: "Pemantauan kualitas air", desc: "Sembilan parameter termasuk suhu, pH, DO, dan amonia, dengan peringatan seketika saat melewati ambang" },
    { label: "AI advisor", desc: "Analisis penyebab dan cara penanganan masalah kualitas air, dalam empat bahasa" },
    { label: "Jurnal tambak", desc: "Pakan, kematian, ganti air, disinfeksi, probiotik — diisi selangkah demi selangkah" },
    { label: "Diagnosis penyakit", desc: "Catat dan pantau tren hasil uji AHPND, EHP, WSSV, dan Vibrio" },
    { label: "Manajemen stok", desc: "Lacak stok pakan, probiotik, dan disinfektan dengan peringatan sebelum habis" },
    { label: "Laporan", desc: "Tren kualitas air dan produksi 7, 30, dan 90 hari, lengkap dengan ekspor" },
    { label: "Tambak & petak", desc: "Kelola banyak tambak dan petak dari satu layar" },
    { label: "Integrasi sensor IoT", desc: "Kumpulkan data kualitas air otomatis, menggantikan pencatatan manual" },
  ],
  whyTitle: "Kenapa gratis?",
  whyBody: "Shrimp365 menutup biaya operasional dari iklan di dalam aplikasi.\nPengguna mendapat seluruh fitur tanpa biaya langganan,\ndan pengiklan menjangkau para pelaku budidaya perairan.",
  endTitle: "Mulai sekarang",
  endLede: "Bisa dibuka dari browser ponsel di mana saja — Asia Tenggara, AS, Eropa",
  endCta: "Daftar gratis",
  endGuide: "Baca panduan pengguna",
}

export const PRICING: Record<Locale, PricingContent> = { ko: KO, en: EN, vi: VI, id: ID }
