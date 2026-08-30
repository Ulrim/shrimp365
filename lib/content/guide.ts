import type { Locale } from "@/lib/i18n"

export type GuideStep = {
  id: string
  step: string
  icon: string
  accent: string
  title: string
  desc: string
  items: { icon: string; text: string }[]
  tip: string
}

export type GuideContent = {
  badge: string
  h1: string
  h1Highlight: string
  lede: string
  steps: GuideStep[]
  routineTitle: string
  routineSub: string
  routine: { step: string; icon: string; title: string; desc: string }[]
  faqTitle: string
  faqs: { q: string; a: string }[]
  ctaTitle: string
  ctaDesc: string
  ctaStart: string
  ctaPdf: string
  nextStep: string
  goToStep: string
}

// 단계 구조는 언어마다 같고 문구만 다르다. 아이콘/색은 공통 메타로 둔다.
const META = [
  { id: "start", step: "01", icon: "🔑", accent: "ocean" },
  { id: "farm", step: "02", icon: "🏠", accent: "teal" },
  { id: "home", step: "03", icon: "🏡", accent: "ocean" },
  { id: "water", step: "04", icon: "💧", accent: "blue" },
  { id: "journal", step: "05", icon: "📔", accent: "emerald" },
  { id: "monitor", step: "06", icon: "📊", accent: "teal" },
  { id: "ai", step: "07", icon: "🤖", accent: "purple" },
  { id: "alert", step: "08", icon: "🔔", accent: "amber" },
  { id: "inventory", step: "09", icon: "📦", accent: "amber" },
  { id: "report", step: "10", icon: "📊", accent: "rose" },
]

type StepText = { title: string; desc: string; items: [string, string][]; tip: string }

function build(texts: StepText[]): GuideStep[] {
  return META.map((m, i) => ({
    ...m,
    title: texts[i].title,
    desc: texts[i].desc,
    items: texts[i].items.map(([icon, text]) => ({ icon, text })),
    tip: texts[i].tip,
  }))
}

const KO: GuideContent = {
  badge: "📖 사용 가이드",
  h1: "처음 사용하시나요?",
  h1Highlight: "5분이면 시작할 수 있습니다",
  lede: "아래 단계를 순서대로 따라하면 양식장 등록부터 수질 모니터링까지 바로 시작할 수 있습니다.",
  steps: build([
    {
      title: "계정 만들기 & 로그인",
      desc: "이메일로 바로 가입할 수 있습니다. 가입 후 이메일 인증만 마치면 즉시 사용 가능합니다.",
      items: [["📧", "shrimp365.kr에서 '무료로 시작하기' 클릭"], ["✉️", "이메일 주소와 비밀번호 입력 후 가입"], ["✅", "발송된 인증 메일의 링크 클릭 (스팸함 확인)"], ["🚀", "로그인 후 홈 화면으로 자동 이동"]],
      tip: "카카오·구글 계정으로도 바로 시작할 수 있습니다. 별도 비밀번호를 만들지 않아도 됩니다.",
    },
    {
      title: "양식장 & 수조 등록",
      desc: "가장 먼저 양식장과 수조를 등록하세요. 이후 모든 기록은 수조 단위로 관리됩니다.",
      items: [["📱", "하단 메뉴 또는 좌측 메뉴 → '양식장·수조 관리' 클릭"], ["➕", "'+ 양식장 추가' → 양식장 이름·지역 입력 후 저장"], ["🔵", "생성된 양식장 아래 '+ 수조 추가' 클릭"], ["📝", "수조 이름, 면적(㎡), 목표 수량 입력 후 저장"]],
      tip: "수조를 여러 개 등록하면 각 수조별로 수질·일지·재고를 따로 관리할 수 있습니다. 수조 이름은 언제든 수정 가능합니다.",
    },
    {
      title: "홈 화면 — 오늘 무엇을 할까요?",
      desc: "로그인 후 나타나는 홈 화면에서 '기록'과 '현황 보기' 두 가지 중 하나를 선택합니다.",
      items: [["📝", "'오늘 기록하기' — 수질·양식 일지를 입력할 때"], ["📊", "'현황 보기' — 대시보드에서 지금 상태 확인할 때"], ["🔔", "우측 상단 종 아이콘 — 알림·경고 확인"], ["🔍", "검색(⌘K) — 페이지·양식장·수조 빠른 이동"]],
      tip: "매일 아침 홈 화면에서 '오늘 기록하기'로 시작하고, 저장 후 '현황 보기'로 상태를 확인하는 루틴을 추천합니다.",
    },
    {
      title: "수질 기록 — 단계별 입력",
      desc: "수질 기록은 한 번에 한 항목씩 입력합니다. 처음 쓰는 분도 막히지 않도록 단계별로 안내합니다.",
      items: [["📱", "홈 → '오늘 기록하기' → '수질 기록' 선택"], ["🔵", "수조 선택 → 날짜 확인 → 수온 입력 → 다음"], ["📏", "pH → 용존산소(DO) → 염도 → 암모니아 … 순서대로"], ["✅", "마지막 '저장' 버튼 → 대시보드로 자동 이동"]],
      tip: "수온 28~32℃, pH 7.5~8.5, DO 5mg/L 이상이 흰다리새우의 적정 범위입니다. 기준값을 벗어나면 알림으로 즉시 알려드립니다.",
    },
    {
      title: "양식 일지 — 단계별 기록",
      desc: "급이량·폐사·환수·소독 등 일상 작업 내역을 화면마다 하나씩 입력합니다.",
      items: [["📱", "홈 → '오늘 기록하기' → '양식 일지' 선택"], ["🐟", "수조 → 날짜 → 사료 종류 → 급이량(kg) → 급이 횟수"], ["💧", "폐사 수 → 환수율 → 소독 여부 → 미생물제 사용"], ["🔧", "설비 점검 항목 체크 → 메모 → 저장"]],
      tip: "이전 입력값이 자동으로 채워집니다. 매일 달라지는 숫자만 수정하면 되므로 2분이면 완료됩니다.",
    },
    {
      title: "현황 보기 — 대시보드 & 수질 모니터링",
      desc: "기록을 마쳤다면 대시보드에서 전체 수조 상태를, 수질 모니터링에서 차트와 이력을 확인하세요.",
      items: [["🏠", "홈 → '현황 보기' 또는 좌측 메뉴 → '대시보드'"], ["🔴", "빨간 수조 카드 = 즉시 확인 필요 / 초록 = 정상"], ["📈", "좌측 메뉴 → '수질 모니터링' → 수조별 차트 확인"], ["📅", "날짜 범위 선택으로 과거 추이 비교 가능"]],
      tip: "차트에서 특정 날짜 점을 클릭하면 그날 입력된 값을 확인할 수 있습니다. 이상값이 있으면 해당 날짜가 빨간 점으로 표시됩니다.",
    },
    {
      title: "AI 어드바이저 활용",
      desc: "수질 이상이나 알림 발생 시 AI에게 물어보세요. 원인 분석부터 대처 방법까지 구체적으로 안내합니다.",
      items: [["🧠", "좌측 메뉴 → 'AI 어드바이저' 클릭"], ["💬", "현재 상황을 편한 말로 자유롭게 입력"], ["📋", "AI가 내 수조 데이터를 참고해 맞춤 답변 제공"], ["🔁", "추가 질문으로 대화를 이어 나갈 수 있음"]],
      tip: "\"pH가 갑자기 내려갔는데 어떻게 해야 하나요?\", \"오늘 폐사가 늘었어요\" 같이 일반 대화체로 물어봐도 됩니다.",
    },
    {
      title: "알림 & 경고 확인",
      desc: "수질 기준 초과, 재고 부족 등 중요한 상황은 우측 상단 종 아이콘에 빨간 숫자로 표시됩니다.",
      items: [["🔴", "화면 우측 상단 종 아이콘의 숫자 확인"], ["📋", "클릭 시 알림 목록 표시 (수조·항목·시각 포함)"], ["➡️", "알림 항목 클릭 → 해당 수조 수질 페이지로 바로 이동"], ["✅", "조치 완료 후 '해결됨' 처리하면 목록에서 사라짐"]],
      tip: "알림은 최신 순으로 표시됩니다. '모두 해결' 버튼으로 한 번에 처리할 수 있습니다.",
    },
    {
      title: "재고 관리",
      desc: "사료·미생물제·소독약 재고를 등록해 두면 부족할 때 자동으로 알림을 드립니다.",
      items: [["📦", "좌측 메뉴 → '재고 관리' 클릭"], ["➕", "'+ 품목 추가'로 사료·약품 등록"], ["📉", "재주문 기준량(최소 보유 수량) 설정"], ["🚨", "재고가 기준량 이하로 떨어지면 대시보드에 경고 표시"]],
      tip: "일지 작성 시 사용한 미생물제·소독제를 재고에 연결하면 사용할 때마다 수량이 자동으로 차감됩니다.",
    },
    {
      title: "리포트 & 분석",
      desc: "기간별 수질 통계, 급이 현황, 생산 실적 등을 확인하고 PDF로 저장할 수 있습니다.",
      items: [["📈", "좌측 메뉴 → '리포트' 클릭"], ["📅", "조회 기간·수조 선택 후 리포트 생성"], ["📑", "수질 추이·급이량·폐사율 그래프 확인"], ["⬇️", "PDF로 내보내기 가능"]],
      tip: "월별 리포트를 정기적으로 확인하면 수익성 분석과 다음 사육 계획 수립에 도움이 됩니다.",
    },
  ]),
  routineTitle: "매일 이렇게 사용하세요",
  routineSub: "로그인 → 기록 → 확인의 3단계 루틴",
  routine: [
    { step: "① 아침", icon: "📝", title: "오늘 기록하기", desc: "홈 → 수질 기록 + 양식 일지\n약 5분이면 완료" },
    { step: "② 확인", icon: "🔔", title: "알림 확인", desc: "우측 상단 종 아이콘\n이상 수치 즉시 파악" },
    { step: "③ 분석", icon: "📊", title: "현황 보기", desc: "대시보드·수질 모니터링\n이상 징후 조기 발견" },
  ],
  faqTitle: "자주 묻는 질문",
  faqs: [
    { q: "스마트폰에서도 사용할 수 있나요?", a: "네, 별도 앱 설치 없이 스마트폰 브라우저(Chrome·Safari)에서 바로 사용할 수 있습니다. 브라우저에서 '홈 화면에 추가'하면 앱처럼 아이콘으로 실행할 수 있습니다." },
    { q: "수질 기록은 꼭 모든 항목을 입력해야 하나요?", a: "수온, pH, DO(용존산소), 염도는 핵심 항목으로 매일 기록을 권장합니다. 암모니아·아질산 등 나머지 항목은 측정하지 않은 날에는 건너뛰기(선택 사항) 버튼을 누르면 됩니다." },
    { q: "수조가 여러 개인 경우 한 번에 확인할 수 있나요?", a: "대시보드에서 모든 수조의 현재 상태를 한눈에 볼 수 있습니다. 각 수조 카드를 클릭하면 해당 수조의 상세 수질 이력으로 바로 이동합니다." },
    { q: "이전에 입력한 값을 수정하거나 삭제할 수 있나요?", a: "수질 모니터링 페이지의 이력 탭과 양식 일지 페이지에서 이전 기록을 수정하거나 삭제할 수 있습니다. 수정 버튼(연필 아이콘)을 클릭하면 됩니다." },
    { q: "AI 어드바이저는 항상 정확한 답변을 주나요?", a: "AI는 입력된 수질 데이터와 새우 양식 지식을 바탕으로 조언을 드리지만, 현장 상황에 따라 다를 수 있습니다. 심각한 질병 의심 시에는 반드시 전문가에게도 문의하세요." },
    { q: "데이터를 백업하거나 내보낼 수 있나요?", a: "리포트 메뉴에서 기간을 선택해 PDF로 내보낼 수 있습니다. 서버에 저장된 데이터는 삭제하지 않는 한 보관됩니다." },
    { q: "무료로 어디까지 쓸 수 있나요?", a: "수질 기록·양식 일지·대시보드·리포트 등 핵심 기능을 무료로 사용할 수 있습니다. 요금제 페이지에서 자세한 내용을 확인하세요." },
  ],
  ctaTitle: "준비 되셨나요?",
  ctaDesc: "무료로 시작하고, 언제든지 업그레이드할 수 있습니다.",
  ctaStart: "무료로 시작하기",
  ctaPdf: "사용설명서 PDF 다운로드",
  nextStep: "다음 단계",
  goToStep: "단계",
}

const EN: GuideContent = {
  badge: "📖 User guide",
  h1: "First time here?",
  h1Highlight: "You can be up and running in 5 minutes",
  lede: "Follow the steps below in order and you'll go from registering a farm to monitoring water quality right away.",
  steps: build([
    {
      title: "Create an account & sign in",
      desc: "Sign up with an email address. Once you confirm the verification email you can start immediately.",
      items: [["📧", "Click 'Start free' on shrimp365.kr"], ["✉️", "Enter your email and password to sign up"], ["✅", "Click the link in the verification email (check spam)"], ["🚀", "You land on the home screen after signing in"]],
      tip: "You can also start straight away with a Kakao or Google account — no separate password needed.",
    },
    {
      title: "Register your farm & tanks",
      desc: "Start by registering a farm and its tanks. Every record from then on is kept per tank.",
      items: [["📱", "Bottom or side menu → 'Farms & tanks'"], ["➕", "'+ Add farm' → enter name and location, save"], ["🔵", "Click '+ Add tank' under the farm you created"], ["📝", "Enter tank name, area (㎡) and target stock, save"]],
      tip: "With several tanks registered you can track water quality, journals and inventory separately for each. Tank names can be changed at any time.",
    },
    {
      title: "Home screen — what to do today",
      desc: "The home screen after sign-in offers two paths: record something, or check status.",
      items: [["📝", "'Record today' — to enter water quality or the farm journal"], ["📊", "'View status' — to check the dashboard now"], ["🔔", "Bell icon, top right — alerts and warnings"], ["🔍", "Search (⌘K) — jump to a page, farm or tank"]],
      tip: "A good routine: start each morning with 'Record today', then check 'View status' after saving.",
    },
    {
      title: "Water quality — one field at a time",
      desc: "Water quality is entered one parameter per screen, so first-time users never get stuck.",
      items: [["📱", "Home → 'Record today' → 'Water quality'"], ["🔵", "Pick a tank → confirm the date → enter temperature → next"], ["📏", "pH → dissolved oxygen (DO) → salinity → ammonia, in order"], ["✅", "Press 'Save' at the end → you're taken to the dashboard"]],
      tip: "Target ranges for whiteleg shrimp: 28–32°C, pH 7.5–8.5, DO above 5 mg/L. You get an alert the moment a value leaves its range.",
    },
    {
      title: "Farm journal — step by step",
      desc: "Record daily work — feeding, mortality, water exchange, disinfection — one item per screen.",
      items: [["📱", "Home → 'Record today' → 'Farm journal'"], ["🐟", "Tank → date → feed type → amount (kg) → number of feedings"], ["💧", "Mortality count → exchange rate → disinfection → probiotics used"], ["🔧", "Check equipment items → notes → save"]],
      tip: "Yesterday's values are pre-filled. You only change the numbers that differ, so it takes about two minutes.",
    },
    {
      title: "View status — dashboard & monitoring",
      desc: "Once recorded, check every tank at a glance on the dashboard, and charts and history under water quality monitoring.",
      items: [["🏠", "Home → 'View status', or side menu → 'Dashboard'"], ["🔴", "Red tank card = needs attention now / green = normal"], ["📈", "Side menu → 'Water quality' → per-tank charts"], ["📅", "Select a date range to compare past trends"]],
      tip: "Click a point on the chart to see the values entered that day. Out-of-range days are marked with a red dot.",
    },
    {
      title: "Using the AI advisor",
      desc: "When something looks wrong, ask the AI. It explains likely causes and what to do about them.",
      items: [["🧠", "Side menu → 'AI advisor'"], ["💬", "Describe the situation in plain language"], ["📋", "The AI answers using your own tank data"], ["🔁", "Keep asking follow-up questions in the same conversation"]],
      tip: "Everyday phrasing works fine — \"pH dropped suddenly, what should I do?\" or \"mortality went up today\".",
    },
    {
      title: "Alerts & warnings",
      desc: "Threshold breaches and low stock appear as a red number on the bell icon at the top right.",
      items: [["🔴", "Check the number on the bell icon, top right"], ["📋", "Click to see the list (tank, parameter, time)"], ["➡️", "Click an alert → jump straight to that tank's water quality page"], ["✅", "Mark as resolved once handled and it leaves the list"]],
      tip: "Alerts are listed newest first. Use 'Resolve all' to clear them in one go.",
    },
    {
      title: "Inventory management",
      desc: "Register feed, probiotics and disinfectant stock and you'll be warned before you run out.",
      items: [["📦", "Side menu → 'Inventory'"], ["➕", "'+ Add item' to register feed or chemicals"], ["📉", "Set a reorder level (minimum quantity to hold)"], ["🚨", "A warning appears on the dashboard when stock falls below it"]],
      tip: "Link the probiotics or disinfectant used in a journal entry to an inventory item and the quantity is deducted automatically.",
    },
    {
      title: "Reports & analysis",
      desc: "Review water quality statistics, feeding and production over any period, and save as PDF.",
      items: [["📈", "Side menu → 'Reports'"], ["📅", "Choose the period and tanks, then generate"], ["📑", "Review water quality trends, feed amounts and mortality rate"], ["⬇️", "Export as PDF"]],
      tip: "Reviewing a monthly report regularly helps with profitability analysis and planning the next cycle.",
    },
  ]),
  routineTitle: "How to use it every day",
  routineSub: "A three-step routine: sign in → record → check",
  routine: [
    { step: "① Morning", icon: "📝", title: "Record today", desc: "Home → water quality + journal\nAbout five minutes" },
    { step: "② Check", icon: "🔔", title: "Check alerts", desc: "Bell icon, top right\nSpot out-of-range values at once" },
    { step: "③ Review", icon: "📊", title: "View status", desc: "Dashboard & monitoring\nCatch problems early" },
  ],
  faqTitle: "Frequently asked questions",
  faqs: [
    { q: "Can I use it on a smartphone?", a: "Yes — no app to install. It runs in your phone browser (Chrome or Safari). Use 'Add to home screen' and it launches from an icon like an app." },
    { q: "Do I have to fill in every water quality field?", a: "Temperature, pH, DO and salinity are the core parameters and we recommend recording them daily. For ammonia, nitrite and the rest, just press skip on days you didn't measure." },
    { q: "Can I see several tanks at once?", a: "The dashboard shows the current state of every tank at a glance. Click a tank card to jump to its detailed water quality history." },
    { q: "Can I edit or delete a past entry?", a: "Yes — from the history tab on the water quality page and from the farm journal page. Click the edit (pencil) button." },
    { q: "Is the AI advisor always right?", a: "The AI advises based on your recorded data and shrimp farming knowledge, but conditions on site vary. If you suspect a serious disease, always consult a specialist as well." },
    { q: "Can I back up or export my data?", a: "You can export a chosen period as PDF from the Reports menu. Data stored on the server is kept unless you delete it." },
    { q: "What can I use for free?", a: "Core features — water quality records, farm journal, dashboard and reports — are free. See the pricing page for details." },
  ],
  ctaTitle: "Ready to start?",
  ctaDesc: "Start free and upgrade whenever you need to.",
  ctaStart: "Start free",
  ctaPdf: "Download the manual (PDF)",
  nextStep: "Next step",
  goToStep: "Step",
}

const VI: GuideContent = {
  badge: "📖 Hướng dẫn sử dụng",
  h1: "Lần đầu sử dụng?",
  h1Highlight: "Chỉ 5 phút là bắt đầu được",
  lede: "Làm theo các bước dưới đây theo thứ tự, bạn sẽ đi từ đăng ký trại nuôi đến theo dõi chất lượng nước ngay.",
  steps: build([
    {
      title: "Tạo tài khoản & đăng nhập",
      desc: "Đăng ký bằng email. Xác nhận email là dùng được ngay.",
      items: [["📧", "Nhấn 'Bắt đầu miễn phí' tại shrimp365.kr"], ["✉️", "Nhập email và mật khẩu để đăng ký"], ["✅", "Nhấn liên kết trong email xác nhận (kiểm tra cả hộp thư rác)"], ["🚀", "Sau khi đăng nhập sẽ vào màn hình chính"]],
      tip: "Bạn cũng có thể bắt đầu ngay bằng tài khoản Kakao hoặc Google, không cần tạo mật khẩu riêng.",
    },
    {
      title: "Đăng ký trại nuôi & ao",
      desc: "Trước tiên hãy đăng ký trại và các ao. Mọi ghi chép sau đó đều quản lý theo từng ao.",
      items: [["📱", "Menu dưới hoặc menu trái → 'Trại nuôi & ao'"], ["➕", "'+ Thêm trại' → nhập tên, khu vực rồi lưu"], ["🔵", "Nhấn '+ Thêm ao' bên dưới trại vừa tạo"], ["📝", "Nhập tên ao, diện tích (㎡), số lượng mục tiêu rồi lưu"]],
      tip: "Đăng ký nhiều ao thì chất lượng nước, nhật ký và kho được quản lý riêng cho từng ao. Tên ao có thể sửa bất cứ lúc nào.",
    },
    {
      title: "Màn hình chính — hôm nay làm gì?",
      desc: "Sau khi đăng nhập, màn hình chính cho hai lựa chọn: ghi chép hoặc xem tình trạng.",
      items: [["📝", "'Ghi hôm nay' — khi nhập chất lượng nước hoặc nhật ký"], ["📊", "'Xem tình trạng' — khi muốn kiểm tra bảng điều khiển"], ["🔔", "Biểu tượng chuông góc trên phải — cảnh báo"], ["🔍", "Tìm kiếm (⌘K) — chuyển nhanh tới trang, trại, ao"]],
      tip: "Thói quen tốt: sáng nào cũng bắt đầu bằng 'Ghi hôm nay', lưu xong thì xem 'Xem tình trạng'.",
    },
    {
      title: "Ghi chất lượng nước — từng bước",
      desc: "Mỗi màn hình chỉ nhập một chỉ tiêu, người mới cũng không bị rối.",
      items: [["📱", "Trang chủ → 'Ghi hôm nay' → 'Chất lượng nước'"], ["🔵", "Chọn ao → xác nhận ngày → nhập nhiệt độ → tiếp"], ["📏", "pH → oxy hòa tan (DO) → độ mặn → amoniac, lần lượt"], ["✅", "Nhấn 'Lưu' ở bước cuối → chuyển sang bảng điều khiển"]],
      tip: "Ngưỡng thích hợp cho tôm thẻ chân trắng: 28–32°C, pH 7,5–8,5, DO trên 5 mg/L. Vượt ngưỡng là có cảnh báo ngay.",
    },
    {
      title: "Nhật ký nuôi — từng bước",
      desc: "Ghi công việc hằng ngày — cho ăn, tôm chết, thay nước, sát trùng — mỗi màn hình một mục.",
      items: [["📱", "Trang chủ → 'Ghi hôm nay' → 'Nhật ký nuôi'"], ["🐟", "Ao → ngày → loại thức ăn → lượng (kg) → số lần cho ăn"], ["💧", "Số tôm chết → tỷ lệ thay nước → sát trùng → men vi sinh"], ["🔧", "Kiểm tra thiết bị → ghi chú → lưu"]],
      tip: "Giá trị hôm trước được điền sẵn. Bạn chỉ sửa những con số thay đổi, mất khoảng hai phút.",
    },
    {
      title: "Xem tình trạng — bảng điều khiển & theo dõi",
      desc: "Ghi xong thì xem toàn bộ ao trên bảng điều khiển, và biểu đồ, lịch sử ở mục chất lượng nước.",
      items: [["🏠", "Trang chủ → 'Xem tình trạng', hoặc menu trái → 'Bảng điều khiển'"], ["🔴", "Thẻ ao màu đỏ = cần kiểm tra ngay / xanh = bình thường"], ["📈", "Menu trái → 'Chất lượng nước' → biểu đồ từng ao"], ["📅", "Chọn khoảng thời gian để so sánh xu hướng"]],
      tip: "Nhấn vào một điểm trên biểu đồ để xem giá trị nhập hôm đó. Ngày vượt ngưỡng được đánh dấu chấm đỏ.",
    },
    {
      title: "Dùng trợ lý AI",
      desc: "Khi thấy bất thường, hãy hỏi AI. AI phân tích nguyên nhân và hướng dẫn cách xử lý cụ thể.",
      items: [["🧠", "Menu trái → 'Trợ lý AI'"], ["💬", "Mô tả tình hình bằng lời nói thường ngày"], ["📋", "AI trả lời dựa trên dữ liệu ao của bạn"], ["🔁", "Hỏi tiếp trong cùng cuộc trò chuyện"]],
      tip: "Nói bình thường cũng được — \"pH tụt đột ngột thì làm sao?\" hay \"hôm nay tôm chết nhiều hơn\".",
    },
    {
      title: "Cảnh báo",
      desc: "Vượt ngưỡng chất lượng nước, thiếu vật tư… đều hiện thành số đỏ trên biểu tượng chuông góc trên phải.",
      items: [["🔴", "Xem con số trên biểu tượng chuông"], ["📋", "Nhấn để xem danh sách (ao, chỉ tiêu, thời gian)"], ["➡️", "Nhấn một cảnh báo → tới thẳng trang chất lượng nước của ao đó"], ["✅", "Xử lý xong thì đánh dấu 'đã giải quyết', mục đó biến mất"]],
      tip: "Cảnh báo sắp xếp mới nhất trước. Dùng nút 'Giải quyết tất cả' để xử lý một lượt.",
    },
    {
      title: "Quản lý kho",
      desc: "Đăng ký tồn kho thức ăn, men vi sinh, thuốc sát trùng thì sắp hết sẽ được báo trước.",
      items: [["📦", "Menu trái → 'Kho'"], ["➕", "'+ Thêm mục' để đăng ký thức ăn, thuốc"], ["📉", "Đặt mức đặt lại (số lượng tối thiểu cần giữ)"], ["🚨", "Xuống dưới mức đó sẽ có cảnh báo trên bảng điều khiển"]],
      tip: "Liên kết men vi sinh hoặc thuốc đã dùng trong nhật ký với mục trong kho thì số lượng tự động trừ đi.",
    },
    {
      title: "Báo cáo & phân tích",
      desc: "Xem thống kê chất lượng nước, tình hình cho ăn, kết quả sản xuất theo kỳ và lưu thành PDF.",
      items: [["📈", "Menu trái → 'Báo cáo'"], ["📅", "Chọn kỳ và ao rồi tạo báo cáo"], ["📑", "Xem biểu đồ xu hướng nước, lượng cho ăn, tỷ lệ chết"], ["⬇️", "Xuất ra PDF"]],
      tip: "Xem báo cáo hằng tháng đều đặn sẽ giúp phân tích hiệu quả kinh tế và lên kế hoạch vụ sau.",
    },
  ]),
  routineTitle: "Dùng hằng ngày như thế này",
  routineSub: "Ba bước: đăng nhập → ghi chép → kiểm tra",
  routine: [
    { step: "① Sáng", icon: "📝", title: "Ghi hôm nay", desc: "Trang chủ → chất lượng nước + nhật ký\nKhoảng năm phút" },
    { step: "② Kiểm tra", icon: "🔔", title: "Xem cảnh báo", desc: "Biểu tượng chuông góc trên phải\nNhận ra chỉ số bất thường ngay" },
    { step: "③ Phân tích", icon: "📊", title: "Xem tình trạng", desc: "Bảng điều khiển & theo dõi\nPhát hiện sớm dấu hiệu bất thường" },
  ],
  faqTitle: "Câu hỏi thường gặp",
  faqs: [
    { q: "Dùng được trên điện thoại không?", a: "Được, không cần cài ứng dụng. Chạy thẳng trên trình duyệt điện thoại (Chrome, Safari). Chọn 'Thêm vào màn hình chính' là mở được bằng biểu tượng như một ứng dụng." },
    { q: "Có bắt buộc nhập đủ mọi chỉ tiêu không?", a: "Nhiệt độ, pH, DO và độ mặn là các chỉ tiêu cốt lõi, nên ghi hằng ngày. Amoniac, nitrit và các mục còn lại thì hôm nào không đo cứ nhấn bỏ qua." },
    { q: "Nhiều ao thì xem cùng lúc được không?", a: "Bảng điều khiển hiển thị tình trạng hiện tại của tất cả các ao. Nhấn vào thẻ ao là tới lịch sử chất lượng nước chi tiết của ao đó." },
    { q: "Có sửa hay xóa dữ liệu đã nhập được không?", a: "Được, ở tab lịch sử trong trang chất lượng nước và ở trang nhật ký nuôi. Nhấn nút sửa (biểu tượng bút chì)." },
    { q: "Trợ lý AI có luôn chính xác không?", a: "AI tư vấn dựa trên dữ liệu bạn ghi và kiến thức nuôi tôm, nhưng thực tế mỗi ao mỗi khác. Khi nghi ngờ bệnh nặng, hãy hỏi thêm chuyên gia." },
    { q: "Có sao lưu hay xuất dữ liệu được không?", a: "Ở mục Báo cáo, chọn khoảng thời gian rồi xuất ra PDF. Dữ liệu trên máy chủ được giữ cho tới khi bạn xóa." },
    { q: "Miễn phí thì dùng được tới đâu?", a: "Các chức năng cốt lõi — ghi chất lượng nước, nhật ký, bảng điều khiển, báo cáo — đều miễn phí. Xem chi tiết ở trang bảng giá." },
  ],
  ctaTitle: "Sẵn sàng chưa?",
  ctaDesc: "Bắt đầu miễn phí, nâng cấp lúc nào cũng được.",
  ctaStart: "Bắt đầu miễn phí",
  ctaPdf: "Tải hướng dẫn (PDF)",
  nextStep: "Bước tiếp theo",
  goToStep: "Bước",
}

const ID: GuideContent = {
  badge: "📖 Panduan pengguna",
  h1: "Baru pertama kali?",
  h1Highlight: "Lima menit sudah bisa mulai",
  lede: "Ikuti langkah-langkah berikut secara berurutan, dari mendaftarkan tambak sampai memantau kualitas air.",
  steps: build([
    {
      title: "Buat akun & masuk",
      desc: "Daftar dengan email. Setelah verifikasi email, langsung bisa dipakai.",
      items: [["📧", "Klik 'Mulai gratis' di shrimp365.kr"], ["✉️", "Masukkan email dan kata sandi untuk mendaftar"], ["✅", "Klik tautan pada email verifikasi (cek folder spam)"], ["🚀", "Setelah masuk, Anda langsung ke layar utama"]],
      tip: "Bisa juga langsung mulai dengan akun Kakao atau Google — tanpa perlu membuat kata sandi terpisah.",
    },
    {
      title: "Daftarkan tambak & petak",
      desc: "Daftarkan tambak dan petaknya lebih dulu. Semua catatan setelahnya dikelola per petak.",
      items: [["📱", "Menu bawah atau menu kiri → 'Tambak & petak'"], ["➕", "'+ Tambah tambak' → isi nama dan lokasi, simpan"], ["🔵", "Klik '+ Tambah petak' di bawah tambak yang dibuat"], ["📝", "Isi nama petak, luas (㎡), target tebar, lalu simpan"]],
      tip: "Dengan beberapa petak terdaftar, kualitas air, jurnal, dan stok dikelola terpisah untuk masing-masing. Nama petak bisa diubah kapan saja.",
    },
    {
      title: "Layar utama — hari ini mau apa?",
      desc: "Layar utama setelah masuk menawarkan dua jalur: mencatat, atau melihat status.",
      items: [["📝", "'Catat hari ini' — untuk mengisi kualitas air atau jurnal"], ["📊", "'Lihat status' — untuk mengecek dashboard sekarang"], ["🔔", "Ikon lonceng kanan atas — peringatan"], ["🔍", "Pencarian (⌘K) — lompat ke halaman, tambak, petak"]],
      tip: "Rutinitas yang baik: setiap pagi mulai dari 'Catat hari ini', setelah tersimpan lihat 'Lihat status'.",
    },
    {
      title: "Catat kualitas air — selangkah demi selangkah",
      desc: "Satu layar satu parameter, sehingga pengguna baru tidak kebingungan.",
      items: [["📱", "Beranda → 'Catat hari ini' → 'Kualitas air'"], ["🔵", "Pilih petak → cek tanggal → isi suhu → lanjut"], ["📏", "pH → oksigen terlarut (DO) → salinitas → amonia, berurutan"], ["✅", "Tekan 'Simpan' di akhir → otomatis ke dashboard"]],
      tip: "Kisaran ideal udang vaname: 28–32°C, pH 7,5–8,5, DO di atas 5 mg/L. Begitu keluar kisaran, peringatan langsung muncul.",
    },
    {
      title: "Jurnal tambak — selangkah demi selangkah",
      desc: "Catat pekerjaan harian — pakan, kematian, ganti air, disinfeksi — satu item per layar.",
      items: [["📱", "Beranda → 'Catat hari ini' → 'Jurnal tambak'"], ["🐟", "Petak → tanggal → jenis pakan → jumlah (kg) → frekuensi"], ["💧", "Jumlah kematian → persentase ganti air → disinfeksi → probiotik"], ["🔧", "Cek item peralatan → catatan → simpan"]],
      tip: "Nilai kemarin sudah terisi otomatis. Anda hanya mengubah angka yang berbeda, jadi cukup dua menit.",
    },
    {
      title: "Lihat status — dashboard & pemantauan",
      desc: "Setelah dicatat, lihat semua petak sekaligus di dashboard, serta grafik dan riwayat di menu kualitas air.",
      items: [["🏠", "Beranda → 'Lihat status', atau menu kiri → 'Dashboard'"], ["🔴", "Kartu petak merah = perlu dicek sekarang / hijau = normal"], ["📈", "Menu kiri → 'Kualitas air' → grafik per petak"], ["📅", "Pilih rentang tanggal untuk membandingkan tren"]],
      tip: "Klik satu titik pada grafik untuk melihat nilai yang diisi hari itu. Hari di luar kisaran ditandai titik merah.",
    },
    {
      title: "Memakai AI advisor",
      desc: "Kalau ada yang janggal, tanyakan ke AI. AI menjelaskan kemungkinan penyebab dan cara menanganinya.",
      items: [["🧠", "Menu kiri → 'AI advisor'"], ["💬", "Ceritakan kondisinya dengan bahasa sehari-hari"], ["📋", "AI menjawab berdasarkan data petak Anda sendiri"], ["🔁", "Lanjutkan bertanya dalam percakapan yang sama"]],
      tip: "Bahasa sehari-hari pun tidak masalah — \"pH tiba-tiba turun, harus bagaimana?\" atau \"hari ini kematian naik\".",
    },
    {
      title: "Peringatan",
      desc: "Pelanggaran ambang dan stok menipis muncul sebagai angka merah di ikon lonceng kanan atas.",
      items: [["🔴", "Cek angka pada ikon lonceng kanan atas"], ["📋", "Klik untuk melihat daftarnya (petak, parameter, waktu)"], ["➡️", "Klik satu peringatan → langsung ke halaman kualitas air petak itu"], ["✅", "Tandai selesai setelah ditangani, item hilang dari daftar"]],
      tip: "Peringatan diurutkan dari yang terbaru. Gunakan tombol 'Selesaikan semua' untuk membereskan sekaligus.",
    },
    {
      title: "Manajemen stok",
      desc: "Daftarkan stok pakan, probiotik, dan disinfektan agar diperingatkan sebelum habis.",
      items: [["📦", "Menu kiri → 'Stok'"], ["➕", "'+ Tambah item' untuk mendaftarkan pakan atau obat"], ["📉", "Tetapkan batas pemesanan ulang (jumlah minimum)"], ["🚨", "Bila stok turun di bawahnya, peringatan muncul di dashboard"]],
      tip: "Hubungkan probiotik atau disinfektan yang dipakai di jurnal dengan item stok, maka jumlahnya berkurang otomatis.",
    },
    {
      title: "Laporan & analisis",
      desc: "Lihat statistik kualitas air, pakan, dan hasil produksi per periode, lalu simpan sebagai PDF.",
      items: [["📈", "Menu kiri → 'Laporan'"], ["📅", "Pilih periode dan petak, lalu buat laporan"], ["📑", "Lihat grafik tren air, jumlah pakan, tingkat kematian"], ["⬇️", "Ekspor sebagai PDF"]],
      tip: "Rutin melihat laporan bulanan membantu analisis keuntungan dan perencanaan siklus berikutnya.",
    },
  ]),
  routineTitle: "Begini cara memakainya setiap hari",
  routineSub: "Rutinitas tiga langkah: masuk → catat → cek",
  routine: [
    { step: "① Pagi", icon: "📝", title: "Catat hari ini", desc: "Beranda → kualitas air + jurnal\nSekitar lima menit" },
    { step: "② Cek", icon: "🔔", title: "Cek peringatan", desc: "Ikon lonceng kanan atas\nLangsung tahu nilai yang menyimpang" },
    { step: "③ Analisis", icon: "📊", title: "Lihat status", desc: "Dashboard & pemantauan\nDeteksi dini tanda bahaya" },
  ],
  faqTitle: "Pertanyaan yang sering diajukan",
  faqs: [
    { q: "Bisa dipakai di ponsel?", a: "Bisa, tanpa memasang aplikasi. Jalan langsung di browser ponsel (Chrome atau Safari). Gunakan 'Tambahkan ke layar utama' agar bisa dibuka lewat ikon seperti aplikasi." },
    { q: "Apakah semua kolom kualitas air wajib diisi?", a: "Suhu, pH, DO, dan salinitas adalah parameter inti dan sebaiknya dicatat setiap hari. Untuk amonia, nitrit, dan sisanya, cukup tekan lewati pada hari yang tidak diukur." },
    { q: "Kalau petaknya banyak, bisa dilihat sekaligus?", a: "Dashboard menampilkan kondisi semua petak sekaligus. Klik kartu petak untuk masuk ke riwayat kualitas air detailnya." },
    { q: "Bisa mengubah atau menghapus data yang sudah diisi?", a: "Bisa, dari tab riwayat di halaman kualitas air dan dari halaman jurnal tambak. Klik tombol edit (ikon pensil)." },
    { q: "Apakah AI advisor selalu benar?", a: "AI memberi saran berdasarkan data yang Anda catat dan pengetahuan budidaya udang, tetapi kondisi lapangan berbeda-beda. Bila mencurigai penyakit serius, konsultasikan juga ke ahli." },
    { q: "Bisa mencadangkan atau mengekspor data?", a: "Di menu Laporan, pilih periode lalu ekspor sebagai PDF. Data di server disimpan sampai Anda menghapusnya." },
    { q: "Sampai mana yang gratis?", a: "Fitur inti — catatan kualitas air, jurnal, dashboard, dan laporan — gratis. Lihat detailnya di halaman harga." },
  ],
  ctaTitle: "Siap memulai?",
  ctaDesc: "Mulai gratis, tingkatkan kapan saja Anda perlu.",
  ctaStart: "Mulai gratis",
  ctaPdf: "Unduh panduan (PDF)",
  nextStep: "Langkah berikutnya",
  goToStep: "Langkah",
}

export const GUIDE: Record<Locale, GuideContent> = { ko: KO, en: EN, vi: VI, id: ID }
