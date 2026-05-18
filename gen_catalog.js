// Usage: node gen_catalog.js
// Generates Shrimp365_guide.pdf in .shots/

const { Document, Page, View, Text, Image, StyleSheet, Font, renderToFile } = require('@react-pdf/renderer')
const { createElement: h } = require('react')
const sharp = require('sharp')
const path = require('path')

const FONT = '/tmp/NanumGothic.ttf'
const FONT_BOLD = '/tmp/NanumGothic-Bold.ttf'
Font.register({ family: 'Nanum', fonts: [{ src: FONT }, { src: FONT_BOLD, fontWeight: 'bold' }] })
Font.registerHyphenationCallback(w => [w])

const SHOTS = path.resolve(__dirname, '.shots')
const SHOT = f => path.join(SHOTS, `full-${f}.jpg`)
const OUT = path.join(SHOTS, 'Shrimp365_guide.pdf')

// A4 points
const PW = 595.28, PH = 841.89
const LW = 841.89, LH = 595.28
const MARGIN = 28

const s = StyleSheet.create({
  body: { fontFamily: 'Nanum', fontSize: 10, color: '#e2e8f0' },
  page: { width: PW, height: PH, backgroundColor: '#0f172a', padding: MARGIN, fontFamily: 'Nanum' },
  pageLand: { width: LW, height: LH, backgroundColor: '#0f172a', padding: MARGIN, fontFamily: 'Nanum' },
  shotPage: { width: PW, height: PH, backgroundColor: '#0f172a', padding: 0, fontFamily: 'Nanum' },
  shotPageLand: { width: LW, height: LH, backgroundColor: '#0f172a', padding: 0, fontFamily: 'Nanum' },
  bar: { position: 'absolute', top: 0, left: 0, width: 6, height: PH, backgroundColor: '#06b6d4' },
  heading: { fontSize: 22, fontWeight: 'bold', color: '#ffffff', marginBottom: 6 },
  subhead: { fontSize: 13, color: '#67e8f9', marginBottom: 18 },
  body14: { fontSize: 11, lineHeight: 1.7, color: '#cbd5e1' },
  stepRow: { flexDirection: 'row', marginBottom: 8, alignItems: 'flex-start' },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#0e7490', color: '#ffffff', fontSize: 10, fontWeight: 'bold', textAlign: 'center', lineHeight: 2.2, marginRight: 8, flexShrink: 0 },
  stepText: { flex: 1, fontSize: 10.5, lineHeight: 1.65, color: '#e2e8f0' },
  tipBox: { backgroundColor: '#134e4a', borderRadius: 6, padding: 10, marginTop: 14 },
  tipLabel: { fontSize: 9, fontWeight: 'bold', color: '#2dd4bf', marginBottom: 4 },
  tipText: { fontSize: 10, lineHeight: 1.6, color: '#99f6e4' },
  header: { height: 30, backgroundColor: '#0f172a', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#1e3a5f' },
  headerTitle: { fontSize: 9, color: '#94a3b8', fontFamily: 'Nanum' },
  headerRight: { marginLeft: 'auto', fontSize: 9, color: '#475569', fontFamily: 'Nanum' },
  coverTitle: { fontSize: 36, fontWeight: 'bold', color: '#ffffff', marginBottom: 8 },
  coverSub: { fontSize: 16, color: '#67e8f9', marginBottom: 40 },
  tocEntry: { flexDirection: 'row', marginBottom: 6, alignItems: 'center' },
  tocNum: { width: 24, fontSize: 10, color: '#06b6d4', fontWeight: 'bold', fontFamily: 'Nanum' },
  tocTitle: { flex: 1, fontSize: 10.5, color: '#e2e8f0', fontFamily: 'Nanum' },
  tocPage: { fontSize: 10, color: '#64748b', fontFamily: 'Nanum' },
})

let PAGENO = 1

function CoverPage() {
  PAGENO++
  return h(Page, { style: s.page },
    h(View, { style: s.bar }),
    h(View, { style: { flex: 1, justifyContent: 'center', paddingLeft: 24 } },
      h(Text, { style: { fontSize: 11, color: '#06b6d4', marginBottom: 20, fontFamily: 'Nanum', fontWeight: 'bold', letterSpacing: 3 } }, 'USER GUIDE'),
      h(Text, { style: s.coverTitle }, 'Shrimp365'),
      h(Text, { style: s.coverSub }, '흰다리새우 스마트 양식 관리 플랫폼'),
      h(View, { style: { width: 60, height: 3, backgroundColor: '#06b6d4', marginBottom: 32 } }),
      h(Text, { style: { fontSize: 11, color: '#94a3b8', lineHeight: 1.8, fontFamily: 'Nanum' } },
        '이 가이드는 Shrimp365의 모든 기능을\n단계별로 소개합니다.\n실제 화면 캡처와 함께 사용법을 익혀보세요.'),
    ),
    h(View, { style: { position: 'absolute', bottom: MARGIN, left: MARGIN + 24, right: MARGIN } },
      h(Text, { style: { fontSize: 9, color: '#475569', fontFamily: 'Nanum' } }, `© 2025 Shrimp365  ·  v1.0`),
    ),
  )
}

const TOC_FEATURES = [
  { title: '홈페이지', sub: '서비스 소개 및 특징' },
  { title: '로그인', sub: '계정 인증' },
  { title: '회원가입', sub: '신규 계정 생성' },
  { title: '요금제', sub: '플랜 선택 및 구독' },
  { title: '가이드', sub: '기능 사용법 안내' },
  { title: '이용약관', sub: '서비스 약관' },
  { title: '개인정보처리방침', sub: '개인정보 보호' },
  { title: '환불정책', sub: '환불 규정' },
  { title: '대시보드', sub: '종합 현황 모니터링' },
  { title: '수질 관리', sub: '수질 데이터 기록 및 분석' },
  { title: 'AI 어드바이저', sub: '인공지능 양식 상담' },
  { title: '양식 일지', sub: '일별 관리 기록' },
  { title: '양식장 관리', sub: '수조 및 시설 관리' },
  { title: '재고 관리', sub: '소모품 및 약품 관리' },
  { title: '생산 관리', sub: '생산량 추적 및 출하 관리' },
  { title: '보고서', sub: '분석 리포트 생성' },
  { title: '관리자', sub: '시스템 관리' },
]

function TocPage() {
  PAGENO++
  return h(Page, { style: s.page },
    h(View, { style: s.bar }),
    h(View, { style: { paddingLeft: 24 } },
      h(Text, { style: { ...s.heading, marginBottom: 4 } }, '목차'),
      h(View, { style: { width: 40, height: 2, backgroundColor: '#06b6d4', marginBottom: 24 } }),
      ...TOC_FEATURES.map((f, i) =>
        h(View, { key: i, style: s.tocEntry },
          h(Text, { style: s.tocNum }, String(i + 1).padStart(2, '0')),
          h(View, { style: { flex: 1 } },
            h(Text, { style: s.tocTitle }, f.title),
            h(Text, { style: { fontSize: 9, color: '#64748b', fontFamily: 'Nanum' } }, f.sub),
          ),
          h(Text, { style: s.tocPage }, String(i * 2 + 3)),
        )
      ),
    ),
  )
}

function ExplainPage({ title, sub, body, steps, tip }) {
  PAGENO++
  const pg = PAGENO
  return h(Page, { style: s.page },
    h(View, { style: s.bar }),
    h(View, { style: { flex: 1, paddingLeft: 24 } },
      h(Text, { style: { fontSize: 9, color: '#475569', marginBottom: 16, fontFamily: 'Nanum' } }, `${pg - 2} / ${TOC_FEATURES.length * 2}`),
      h(Text, { style: s.heading }, title),
      h(Text, { style: s.subhead }, sub),
      h(View, { style: { width: 40, height: 2, backgroundColor: '#06b6d4', marginBottom: 20 } }),
      body && h(Text, { style: s.body14 }, body),
      steps && steps.length > 0 && h(View, { style: { marginTop: 16 } },
        h(Text, { style: { fontSize: 10, fontWeight: 'bold', color: '#94a3b8', marginBottom: 10, fontFamily: 'Nanum' } }, '주요 기능'),
        ...steps.map((st, i) =>
          h(View, { key: i, style: s.stepRow },
            h(Text, { style: s.stepNum }, String(i + 1)),
            h(Text, { style: s.stepText }, st),
          )
        ),
      ),
      tip && h(View, { style: s.tipBox },
        h(Text, { style: s.tipLabel }, '💡 TIP'),
        h(Text, { style: s.tipText }, tip),
      ),
    ),
    h(View, { style: { position: 'absolute', bottom: MARGIN, left: MARGIN + 24, right: MARGIN, flexDirection: 'row' } },
      h(Text, { style: { fontSize: 9, color: '#334155', fontFamily: 'Nanum' } }, 'Shrimp365 User Guide'),
      h(Text, { style: { fontSize: 9, color: '#334155', marginLeft: 'auto', fontFamily: 'Nanum' } }, String(pg)),
    ),
  )
}

// shotFile: e.g. '02-login'
// forceLandscape: true only for 04-pricing
function ShotPage({ title, shotFile, forceLandscape }) {
  const meta = META[shotFile]
  const isLand = forceLandscape === true
  const pw = isLand ? LW : PW
  const ph = isLand ? LH : PH
  const ps = isLand ? s.shotPageLand : s.shotPage
  const headerH = 30
  const availW = pw
  const availH = ph - headerH
  // Scale image to fit
  const imgW = meta.w, imgH = meta.h
  const scaleW = availW / imgW
  const scaleH = availH / imgH
  const scale = Math.min(scaleW, scaleH)
  const dw = imgW * scale
  const dh = imgH * scale
  const ox = (availW - dw) / 2
  const oy = headerH + (availH - dh) / 2

  PAGENO++
  const pg = PAGENO
  return h(Page, { style: ps },
    h(View, { style: { ...s.header, width: pw } },
      h(Text, { style: s.headerTitle }, `Shrimp365  ·  ${title}`),
      h(Text, { style: s.headerRight }, String(pg)),
    ),
    h(Image, {
      src: SHOT(shotFile),
      style: { position: 'absolute', top: oy, left: ox, width: dw, height: dh },
    }),
  )
}

// Pre-computed metadata
let META = {}

async function computeMeta() {
  const files = TOC_FEATURES.map((_, i) => {
    const n = String(i + 1).padStart(2, '0')
    const names = ['01-home','02-login','03-signup','04-pricing','05-guide','06-terms','07-privacy','08-refund','09-dashboard','10-water-quality','11-ai-advisor','12-journal','13-farms','14-inventory','15-production','16-reports','17-admin']
    return names[i]
  })
  for (const f of files) {
    const m = await sharp(SHOT(f)).metadata()
    META[f] = { w: m.width, h: m.height }
  }
}

const FEATURES = [
  {
    shotFile: '01-home',
    title: '홈페이지',
    sub: '서비스 소개 및 핵심 특징 확인',
    body: 'Shrimp365 홈페이지는 서비스의 핵심 가치와 기능을 한눈에 파악할 수 있도록 구성되어 있습니다. 흰다리새우 양식의 스마트화를 지원하는 다양한 기능들이 시각적으로 소개됩니다.',
    steps: [
      '히어로 섹션에서 서비스 핵심 메시지와 주요 지표(생존율 개선, 비용 절감 등)를 확인합니다.',
      '특징(Features) 섹션에서 실시간 모니터링, AI 진단, 데이터 분석 기능을 살펴봅니다.',
      '요금제(Pricing) 섹션에서 무료~엔터프라이즈 플랜을 비교합니다.',
      '"무료로 시작하기" 또는 "로그인" 버튼으로 서비스를 시작합니다.',
    ],
    tip: '홈페이지 상단 네비게이션에서 가이드, 요금제 등 주요 페이지로 바로 이동할 수 있습니다.',
  },
  {
    shotFile: '02-login',
    title: '로그인',
    sub: '이메일/비밀번호로 계정에 접속',
    body: '등록된 이메일과 비밀번호로 Shrimp365에 로그인합니다. 이메일 인증이 완료된 계정만 로그인이 가능합니다.',
    steps: [
      '이메일 주소와 비밀번호를 입력합니다.',
      '"로그인" 버튼을 클릭합니다.',
      '로그인 성공 시 대시보드로 자동 이동됩니다.',
      '비밀번호를 잊었다면 "비밀번호 찾기" 링크를 클릭합니다.',
    ],
    tip: '이메일 인증을 완료하지 않은 계정은 로그인이 제한됩니다. 인증 메일을 재발송하려면 로그인 실패 후 나타나는 안내를 따르세요.',
  },
  {
    shotFile: '03-signup',
    title: '회원가입',
    sub: '신규 계정 생성 및 이메일 인증',
    body: '이메일, 비밀번호, 이름을 입력하여 Shrimp365 계정을 생성합니다. 가입 후 이메일 인증을 완료해야 서비스를 이용할 수 있습니다.',
    steps: [
      '이름, 이메일, 비밀번호(8자 이상)를 입력합니다.',
      '이용약관에 동의 후 "회원가입" 버튼을 클릭합니다.',
      '가입한 이메일로 인증 메일이 발송됩니다.',
      '메일 내 인증 링크를 클릭하여 가입을 완료합니다.',
    ],
    tip: '인증 메일이 오지 않으면 스팸함을 확인하거나, 로그인 페이지에서 "인증 메일 재발송"을 이용하세요.',
  },
  {
    shotFile: '04-pricing',
    title: '요금제',
    sub: '플랜 선택 및 구독 관리',
    body: 'Shrimp365는 양식장 규모와 필요에 맞는 4가지 요금제를 제공합니다. 무료 플랜으로 시작하여 필요에 따라 업그레이드할 수 있습니다.',
    steps: [
      '무료(Free): 수조 2개, 기본 수질 기록, 7일 데이터 보관',
      '베이직(Basic): 수조 5개, AI 기본 진단, 30일 데이터 보관',
      '프로(Pro): 수조 무제한, 고급 AI 분석, 1년 데이터 보관, 보고서',
      '엔터프라이즈: 다중 양식장, 전용 지원, API 연동',
    ],
    tip: '연간 결제 시 월 결제 대비 최대 20% 할인됩니다. 14일 무료 체험 후 자동 결제되지 않으니 안심하고 시작하세요.',
  },
  {
    shotFile: '05-guide',
    title: '가이드',
    sub: '기능 사용법 및 카탈로그 다운로드',
    body: '가이드 페이지에서는 Shrimp365의 각 기능에 대한 상세 사용법을 확인할 수 있습니다. PDF 카탈로그를 다운로드하여 오프라인에서도 참고할 수 있습니다.',
    steps: [
      '카탈로그 PDF 다운로드 버튼으로 전체 기능 안내서를 저장합니다.',
      '각 기능별 사용법 카드를 통해 단계별로 학습합니다.',
      '자주 묻는 질문(FAQ) 섹션에서 궁금한 사항을 확인합니다.',
    ],
    tip: '이 PDF 문서도 가이드 페이지에서 다운로드할 수 있습니다.',
  },
  {
    shotFile: '06-terms',
    title: '이용약관',
    sub: '서비스 이용 조건 및 규정',
    body: '서비스 이용에 관한 권리와 의무, 금지행위, 책임 범위 등을 규정합니다. 회원가입 전 반드시 확인하세요.',
    steps: [
      '서비스 이용 조건 및 회원의 의무 사항을 확인합니다.',
      '금지된 행위와 계정 해지 조건을 숙지합니다.',
      '지식재산권 및 분쟁 해결 방법을 확인합니다.',
    ],
    tip: '이용약관은 서비스 개선에 따라 변경될 수 있으며, 변경 시 이메일로 사전 안내됩니다.',
  },
  {
    shotFile: '07-privacy',
    title: '개인정보처리방침',
    sub: '개인정보 수집 및 처리 안내',
    body: '수집하는 개인정보의 항목, 처리 목적, 보관 기간, 제3자 제공 여부 등을 안내합니다.',
    steps: [
      '수집하는 개인정보 항목(이메일, 이름, 양식 데이터 등)을 확인합니다.',
      '개인정보 처리 목적 및 보관 기간을 확인합니다.',
      '개인정보 열람·수정·삭제 요청 방법을 확인합니다.',
    ],
    tip: '계정 탈퇴 시 개인정보는 관련 법령에 따라 일정 기간 보관 후 삭제됩니다.',
  },
  {
    shotFile: '08-refund',
    title: '환불정책',
    sub: '결제 취소 및 환불 규정',
    body: '구독 요금제의 환불 조건, 부분 환불 기준, 환불 처리 기간 등을 안내합니다.',
    steps: [
      '결제 후 7일 이내 미사용 시 전액 환불 가능합니다.',
      '7일 초과 시 잔여 기간에 대한 일할 계산으로 환불됩니다.',
      '환불 요청은 고객센터 이메일 또는 계정 설정에서 신청합니다.',
    ],
    tip: '이벤트 할인가로 구매한 경우 환불 금액이 상이할 수 있습니다. 환불 전 고객센터에 문의하세요.',
  },
  {
    shotFile: '09-dashboard',
    title: '대시보드',
    sub: '양식장 전체 현황 한눈에 파악',
    body: '대시보드는 Shrimp365의 메인 화면으로, 모든 수조의 현황을 한눈에 확인할 수 있습니다. 주요 지표, 알림, 최근 기록이 통합되어 표시됩니다.',
    steps: [
      '상단 알림 배너에서 수질 이상, 재고 부족 등 즉각적인 경고를 확인합니다.',
      '수조별 상태 카드에서 수온, pH, DO, 생존율을 빠르게 파악합니다.',
      '차트 섹션에서 최근 24시간 수질 트렌드를 시각적으로 분석합니다.',
      '최근 일지 섹션에서 가장 최근 기록된 관리 내용을 확인합니다.',
    ],
    tip: '상단 알림 아이콘을 클릭하면 모든 알림 내역을 슬라이드 패널에서 확인하고, 해당 수조로 바로 이동할 수 있습니다.',
  },
  {
    shotFile: '10-water-quality',
    title: '수질 관리',
    sub: '수질 데이터 기록 및 이상 감지',
    body: '수조별 수질 데이터를 기록하고 시계열 차트로 분석합니다. AI 기반 이상 감지로 위험 수치에 즉시 대응할 수 있습니다.',
    steps: [
      '수조를 선택하고 수온(°C), pH, DO(mg/L), 염도(ppt), 탁도(NTU), 암모니아(mg/L) 등을 입력합니다.',
      '"저장" 버튼으로 측정값을 기록합니다.',
      '차트에서 최근 24시간/7일/30일 트렌드를 분석합니다.',
      '이상 수치 감지 시 빨간색 경고 표시와 함께 알림이 발생합니다.',
    ],
    tip: '정확한 모니터링을 위해 하루 2회 이상 측정을 권장합니다. 수질 이상 시 AI 어드바이저에게 원인 분석을 요청하세요.',
  },
  {
    shotFile: '11-ai-advisor',
    title: 'AI 어드바이저',
    sub: '인공지능 기반 양식 상담 및 진단',
    body: 'Claude AI를 활용한 전문 양식 상담 시스템입니다. 수질 이상, 질병 의심, 관리 방법 등 다양한 질문에 전문적인 답변을 제공합니다.',
    steps: [
      '채팅창에 현재 상황(수질 이상, 새우 행동 변화 등)을 입력합니다.',
      'AI가 양식 데이터를 분석하여 원인과 대처 방법을 제안합니다.',
      '추천 조치를 참고하여 수질 조정 또는 치료를 진행합니다.',
      '이전 상담 내역을 통해 패턴을 파악하고 예방 조치를 취합니다.',
    ],
    tip: 'AI 어드바이저는 현재 수조 데이터를 자동으로 참조합니다. 증상을 구체적으로 설명할수록 더 정확한 답변을 받을 수 있습니다.',
  },
  {
    shotFile: '12-journal',
    title: '양식 일지',
    sub: '일별 관리 기록 및 이력 추적',
    body: '매일의 양식 관리 활동을 체계적으로 기록합니다. 급이, 사망, 수질 처리, 약품 사용 등 모든 관리 이력이 한 곳에 저장됩니다.',
    steps: [
      '"일지 작성" 버튼으로 새 기록을 시작합니다.',
      '수조 선택, 날짜, 급이량, 사료 종류, 사망 개체수 등을 입력합니다.',
      '미생물제, 소독제 사용 여부와 수질 처리 내용을 기록합니다.',
      '특이사항은 메모 칸에 자유롭게 입력합니다.',
    ],
    tip: '이전 입력값이 자동으로 기억되어 매일 반복되는 항목(사료 종류, 급이 횟수 등)을 다시 입력하지 않아도 됩니다.',
  },
  {
    shotFile: '13-farms',
    title: '양식장 관리',
    sub: '수조 및 양식장 정보 관리',
    body: '양식장과 수조의 기본 정보를 등록하고 관리합니다. 다중 양식장 운영 시 각 시설의 현황을 체계적으로 파악할 수 있습니다.',
    steps: [
      '"양식장 추가" 버튼으로 새 양식장을 등록합니다.',
      '양식장별로 수조를 추가하고 용량, 타입, 시설 정보를 입력합니다.',
      '수조별 현재 입식 정보(입식일, 마리수, 밀도)를 관리합니다.',
      '수조 상태(활성/휴지/세척중)를 업데이트합니다.',
    ],
    tip: '수조 이름은 직관적으로 지정하세요(예: A-1, B동-3호). 이름이 모든 화면에서 식별자로 사용됩니다.',
  },
  {
    shotFile: '14-inventory',
    title: '재고 관리',
    sub: '소모품 및 약품 재고 추적',
    body: '사료, 약품, 소모품의 재고를 체계적으로 관리합니다. 재주문 수량 설정으로 재고 부족 알림을 자동으로 받을 수 있습니다.',
    steps: [
      '"재고 입고" 버튼으로 새 물품을 추가하거나 기존 재고를 늘립니다.',
      '품목별 현재 재고, 단위, 재주문 기준량을 설정합니다.',
      '재고가 기준량 이하로 떨어지면 대시보드에 경고가 표시됩니다.',
      '"사용" 버튼으로 일지 연동 시 자동으로 재고가 차감됩니다.',
    ],
    tip: '재주문 수준(Reorder Level)을 현실적으로 설정하면 긴급 구매를 예방할 수 있습니다. 배송 기간을 고려하여 여유 있게 설정하세요.',
  },
  {
    shotFile: '15-production',
    title: '생산 관리',
    sub: '생산량 추적 및 출하 관리',
    body: '수조별 생산 현황을 추적하고 출하 기록을 관리합니다. 입식부터 출하까지 전 과정의 데이터를 통합하여 생산 효율을 분석합니다.',
    steps: [
      '수조별 현재 입식 정보(입식일, 마리수, 평균 체중)를 업데이트합니다.',
      '출하 시 출하 중량, 단가, 구매처를 기록합니다.',
      '생산 주기별 생존율, FCR(사료전환율), 수익성을 확인합니다.',
      '출하 이력을 통해 최적 출하 시기와 거래처별 단가를 분석합니다.',
    ],
    tip: '정기적인 샘플 계측(평균 체중 측정)으로 출하 예측 정확도를 높일 수 있습니다.',
  },
  {
    shotFile: '16-reports',
    title: '보고서',
    sub: '종합 분석 리포트 생성',
    body: '양식 데이터를 종합 분석한 보고서를 자동으로 생성합니다. 기간별 성과 지표, 수질 트렌드, 비용 분석 등을 PDF로 출력할 수 있습니다.',
    steps: [
      '보고서 기간(주간/월간/사용자 지정)을 선택합니다.',
      '포함할 수조와 분석 항목을 선택합니다.',
      '"보고서 생성" 버튼으로 AI 기반 분석 리포트를 만듭니다.',
      'PDF 다운로드 또는 이메일 발송으로 기록을 보관합니다.',
    ],
    tip: '월간 보고서를 정기적으로 발행하면 장기적인 양식 트렌드를 파악하고 다음 시즌 계획 수립에 활용할 수 있습니다.',
  },
  {
    shotFile: '17-admin',
    title: '관리자',
    sub: '시스템 관리 및 사용자 관리',
    body: '관리자 계정으로 전체 사용자, 요금제 현황, 시스템 상태를 관리합니다. 엔터프라이즈 플랜의 멀티 사용자 환경을 지원합니다.',
    steps: [
      '전체 사용자 목록과 각 계정의 플랜, 사용 현황을 확인합니다.',
      '특정 사용자의 플랜 변경 또는 계정 정지를 처리합니다.',
      '시스템 공지사항을 등록하여 모든 사용자에게 안내합니다.',
      '사용 통계 및 시스템 성능 지표를 모니터링합니다.',
    ],
    tip: '관리자 페이지는 admin 권한이 있는 계정만 접근 가능합니다. 일반 사용자는 표시되지 않습니다.',
  },
]

async function buildDoc() {
  await computeMeta()

  const pages = [
    CoverPage(),
    TocPage(),
    ...FEATURES.flatMap(f => {
      const forceLandscape = f.shotFile === '04-pricing'
      return [
        ExplainPage(f),
        ShotPage({ title: f.title, shotFile: f.shotFile, forceLandscape }),
      ]
    }),
  ]

  return h(Document, { title: 'Shrimp365 User Guide', author: 'Shrimp365', creator: 'Shrimp365' },
    ...pages,
  )
}

async function main() {
  console.log('Computing metadata...')
  const doc = await buildDoc()
  console.log('Rendering PDF...')
  await renderToFile(doc, OUT)
  console.log('Done:', OUT)
}

main().catch(e => { console.error(e); process.exit(1) })
