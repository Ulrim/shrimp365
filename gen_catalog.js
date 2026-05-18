// Usage: node --max-old-space-size=4096 gen_catalog.js
// Generates Shrimp365_guide.pdf and Shrimp365_guide.docx in .shots/

const { Document, Page, View, Text, Image, StyleSheet, Font, renderToFile } = require('@react-pdf/renderer')
const {
  Document: DocxDocument, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableRow, TableCell, WidthType,
  ShadingType, ImageRun, PageOrientation,
} = require('docx')
const { createElement: h } = require('react')
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const FONT = '/tmp/NanumGothic.ttf'
const FONT_BOLD = '/tmp/NanumGothic-Bold.ttf'
Font.register({ family: 'Nanum', fonts: [{ src: FONT }, { src: FONT_BOLD, fontWeight: 'bold' }] })
Font.registerHyphenationCallback(w => [w])

const SHOTS = path.resolve(__dirname, '.shots')
const SHOT = f => path.join(SHOTS, `opt-${f}.jpg`)
const OUT_PDF = path.join(SHOTS, 'Shrimp365_guide.pdf')
const OUT_DOCX = path.join(SHOTS, 'Shrimp365_guide.docx')

// A4 points
const PW = 595.28, PH = 841.89
const LW = 841.89, LH = 595.28
const MARGIN = 32

// Light theme colors
const C = {
  bg:       '#ffffff',
  bgShot:   '#f1f5f9',
  accent:   '#0284c7',
  text:     '#0f172a',
  textSub:  '#475569',
  textMuted:'#94a3b8',
  border:   '#e2e8f0',
  stepBg:   '#0284c7',
  tipBg:    '#f0fdf4',
  tipBorder:'#86efac',
  tipLabel: '#16a34a',
  tipText:  '#15803d',
}

const s = StyleSheet.create({
  page:        { width: PW, height: PH, backgroundColor: C.bg, padding: MARGIN, fontFamily: 'Nanum' },
  pageLand:    { width: LW, height: LH, backgroundColor: C.bg, padding: MARGIN, fontFamily: 'Nanum' },
  shotPage:    { width: PW, height: PH, backgroundColor: C.bgShot, padding: 0, fontFamily: 'Nanum' },
  shotPageLand:{ width: LW, height: LH, backgroundColor: C.bgShot, padding: 0, fontFamily: 'Nanum' },
  heading:     { fontSize: 22, fontWeight: 'bold', color: C.text, marginBottom: 5 },
  subhead:     { fontSize: 13, color: C.accent, marginBottom: 16 },
  bodyText:    { fontSize: 10.5, lineHeight: 1.75, color: C.textSub },
  stepRow:     { flexDirection: 'row', marginBottom: 9, alignItems: 'flex-start' },
  stepNum:     { width: 21, height: 21, borderRadius: 11, backgroundColor: C.stepBg, color: '#ffffff', fontSize: 10, fontWeight: 'bold', textAlign: 'center', lineHeight: 2.1, marginRight: 8, flexShrink: 0 },
  stepText:    { flex: 1, fontSize: 10.5, lineHeight: 1.65, color: C.textSub },
  tipBox:      { backgroundColor: C.tipBg, borderRadius: 6, borderWidth: 1, borderColor: C.tipBorder, padding: 10, marginTop: 14 },
  tipLabel:    { fontSize: 9, fontWeight: 'bold', color: C.tipLabel, marginBottom: 3 },
  tipText:     { fontSize: 10, lineHeight: 1.6, color: C.tipText },
  shotHeader:  { height: 28, backgroundColor: C.accent, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  shotHeaderTitle: { fontSize: 9, color: '#ffffff', fontFamily: 'Nanum', fontWeight: 'bold' },
  shotHeaderRight: { marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,0.7)', fontFamily: 'Nanum' },
  coverTitle:  { fontSize: 34, fontWeight: 'bold', color: C.text, marginBottom: 8 },
  coverSub:    { fontSize: 15, color: C.accent, marginBottom: 36 },
  tocEntry:    { flexDirection: 'row', marginBottom: 7, alignItems: 'flex-start' },
  tocNum:      { width: 26, fontSize: 10, color: C.accent, fontWeight: 'bold', fontFamily: 'Nanum', paddingTop: 1 },
  tocTitle:    { flex: 1, fontSize: 10.5, color: C.text, fontFamily: 'Nanum' },
  tocSub:      { fontSize: 9, color: C.textMuted, fontFamily: 'Nanum' },
  tocPage:     { fontSize: 10, color: C.textMuted, fontFamily: 'Nanum', paddingTop: 1 },
  footer:      { position: 'absolute', bottom: 20, left: MARGIN + 5, right: MARGIN, flexDirection: 'row' },
  footerLeft:  { fontSize: 8, color: C.textMuted, fontFamily: 'Nanum' },
  footerRight: { fontSize: 8, color: C.textMuted, marginLeft: 'auto', fontFamily: 'Nanum' },
})

let PAGENO = 1

function topBar(color = C.accent) {
  return [
    h(View, { key: 'tb', style: { position: 'absolute', top: 0, left: 0, right: 0, height: 5, backgroundColor: color } }),
    h(View, { key: 'bb', style: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, backgroundColor: color } }),
  ]
}

function CoverPage() {
  PAGENO++
  return h(Page, { style: s.page },
    ...topBar(),
    h(View, { style: { flex: 1, justifyContent: 'center', paddingLeft: 16 } },
      h(Text, { style: { fontSize: 10, color: C.accent, fontFamily: 'Nanum', fontWeight: 'bold', letterSpacing: 2, marginBottom: 20 } }, 'USER GUIDE'),
      h(Text, { style: s.coverTitle }, 'Shrimp365'),
      h(Text, { style: s.coverSub }, '흰다리새우 스마트 양식 관리 플랫폼'),
      h(View, { style: { width: 50, height: 3, backgroundColor: C.accent, marginBottom: 28 } }),
      h(Text, { style: { fontSize: 11, color: C.textSub, lineHeight: 1.9, fontFamily: 'Nanum' } },
        '이 가이드는 Shrimp365의 모든 기능을\n단계별 실제 화면과 함께 소개합니다.'),
    ),
    h(View, { style: s.footer },
      h(Text, { style: s.footerLeft }, '© 2025 Shrimp365'),
      h(Text, { style: s.footerRight }, 'v1.0'),
    ),
  )
}

const TOC_FEATURES = [
  { title: '홈페이지 (1/3)', sub: '히어로 · 통계' },
  { title: '홈페이지 (2/3)', sub: '기능 · 사용법' },
  { title: '홈페이지 (3/3)', sub: '요금제 · FAQ · CTA' },
  { title: '로그인', sub: '계정 인증' },
  { title: '회원가입', sub: '신규 계정 생성' },
  { title: '가이드', sub: '기능 사용법 안내' },
  { title: '대시보드', sub: '종합 현황 모니터링' },
  { title: '수질 관리', sub: '수질 데이터 기록 및 분석' },
  { title: 'AI 어드바이저', sub: '인공지능 양식 상담' },
  { title: '양식 일지', sub: '일별 관리 기록' },
  { title: '양식장 관리', sub: '수조 및 시설 관리' },
  { title: '재고 관리', sub: '소모품 및 약품 관리' },
  { title: '생산 관리', sub: '생산량 추적 및 출하 관리' },
  { title: '보고서', sub: '분석 리포트 생성' },
]

function TocPage() {
  PAGENO++
  return h(Page, { style: s.page },
    ...topBar(),
    h(View, { style: { paddingLeft: 8 } },
      h(Text, { style: { ...s.heading, marginBottom: 4 } }, '목차'),
      h(View, { style: { width: 36, height: 2.5, backgroundColor: C.accent, marginBottom: 18 } }),
      ...TOC_FEATURES.map((f, i) =>
        h(View, { key: i, style: s.tocEntry },
          h(Text, { style: s.tocNum }, String(i + 1).padStart(2, '0')),
          h(View, { style: { flex: 1 } },
            h(Text, { style: s.tocTitle }, f.title),
            h(Text, { style: s.tocSub }, f.sub),
          ),
          h(Text, { style: s.tocPage }, String(i * 2 + 3)),
        )
      ),
    ),
    h(View, { style: s.footer },
      h(Text, { style: s.footerLeft }, 'Shrimp365 User Guide'),
      h(Text, { style: s.footerRight }, '2'),
    ),
  )
}

function ExplainPage({ title, sub, body, steps, tip, index }) {
  PAGENO++
  const pg = PAGENO
  const total = TOC_FEATURES.length * 2
  return h(Page, { style: s.page },
    ...topBar(),
    h(View, { style: { flex: 1, paddingLeft: 8 } },
      h(Text, { style: { fontSize: 8.5, color: C.textMuted, marginBottom: 14, fontFamily: 'Nanum' } },
        `${index * 2 + 1} / ${total}`),
      h(Text, { style: s.heading }, title),
      h(Text, { style: s.subhead }, sub),
      h(View, { style: { width: 36, height: 2.5, backgroundColor: C.accent, marginBottom: 18 } }),
      body && h(Text, { style: s.bodyText }, body),
      steps && steps.length > 0 && h(View, { style: { marginTop: 18 } },
        h(Text, { style: { fontSize: 9.5, fontWeight: 'bold', color: C.text, marginBottom: 10, fontFamily: 'Nanum' } }, '주요 기능'),
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
    h(View, { style: s.footer },
      h(Text, { style: s.footerLeft }, 'Shrimp365 User Guide'),
      h(Text, { style: s.footerRight }, String(pg)),
    ),
  )
}

function ShotPage({ title, shotFile, forceLandscape, index }) {
  const meta = META[shotFile]
  const isLand = forceLandscape === true
  const pw = isLand ? LW : PW
  const ph = isLand ? LH : PH
  const ps = isLand ? s.shotPageLand : s.shotPage
  const headerH = 28
  const pad = 14
  const availW = pw - pad * 2
  const availH = ph - headerH - pad * 2
  const scale = Math.min(availW / meta.w, availH / meta.h)
  const dw = meta.w * scale
  const dh = meta.h * scale
  const ox = pad + (availW - dw) / 2
  const oy = headerH + pad + (availH - dh) / 2
  const total = TOC_FEATURES.length * 2

  PAGENO++
  const pg = PAGENO
  return h(Page, { style: ps },
    h(View, { style: { ...s.shotHeader, width: pw } },
      h(Text, { style: s.shotHeaderTitle }, `Shrimp365  ·  ${title}`),
      h(Text, { style: s.shotHeaderRight }, `${index * 2 + 2} / ${total}  ·  p.${pg}`),
    ),
    h(View, { style: {
      position: 'absolute', top: oy - 2, left: ox - 2,
      width: dw + 4, height: dh + 4,
      borderRadius: 4, backgroundColor: C.border,
    }}),
    h(Image, {
      src: SHOT(shotFile),
      style: { position: 'absolute', top: oy, left: ox, width: dw, height: dh, borderRadius: 3 },
    }),
  )
}

let META = {}

async function computeMeta() {
  const files = FEATURES.flatMap(f => [f.shotFile, ...(f.extraShots || [])])
  for (const f of files) {
    const m = await sharp(SHOT(f)).metadata()
    META[f] = { w: m.width, h: m.height }
  }
}

const FEATURES = [
  // Homepage split into 3 shot pages, single explain page
  {
    shotFile: '01-home-p1',
    title: '홈페이지',
    sub: '서비스 소개 및 핵심 특징',
    body: 'Shrimp365 홈페이지는 히어로 섹션부터 FAQ까지 8개 섹션으로 구성됩니다. 각 섹션을 순서대로 살펴보면 서비스의 전체 가치와 기능을 파악할 수 있습니다.',
    steps: [
      '① 히어로: 핵심 메시지와 생존율 개선·비용 절감 등 주요 성과 지표',
      '② 통계 배너: 누적 사용자, 관리 수조 수, 질병 조기 감지율',
      '③ 기능(Features): 실시간 모니터링·AI 진단·데이터 분석 카드',
      '④ 사용 방법(How it works): 3단계 온보딩 흐름',
      '⑤ 데모 미리보기: 실제 대시보드 UI 스크린샷',
      '⑥ 요금제(Pricing): 무료~엔터프라이즈 4개 플랜 비교',
      '⑦ FAQ: 자주 묻는 질문 6개',
      '⑧ CTA: 무료 시작하기 및 데모 버튼',
    ],
    tip: '페이지 우측 상단 "무료 데모" 버튼으로 로그인 없이 전체 기능을 체험할 수 있습니다.',
    extraShots: ['01-home-p2', '01-home-p3'],
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
]

// ─── PDF BUILD ───────────────────────────────────────────────────────────────

async function buildPdf() {
  let pages = [CoverPage(), TocPage()]

  FEATURES.forEach((f, i) => {
    pages.push(ExplainPage({ ...f, index: i }))
    pages.push(ShotPage({ title: f.title, shotFile: f.shotFile, forceLandscape: f.shotFile === '04-pricing', index: i }))
    // Extra shot pages (homepage p2, p3)
    if (f.extraShots) {
      f.extraShots.forEach(shotFile => {
        pages.push(ShotPage({ title: f.title, shotFile, forceLandscape: false, index: i }))
      })
    }
  })

  return h(Document, { title: 'Shrimp365 User Guide', author: 'Shrimp365', creator: 'Shrimp365' }, ...pages)
}

// ─── DOCX BUILD ──────────────────────────────────────────────────────────────

function para(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Malgun Gothic', size: opts.size || 22, bold: opts.bold || false, color: opts.color || '000000' })],
    heading: opts.heading || undefined,
    spacing: { after: opts.after !== undefined ? opts.after : 120 },
    alignment: opts.align || AlignmentType.LEFT,
  })
}

function hRule() {
  return new Paragraph({
    border: { bottom: { color: 'C8D9E8', space: 1, style: BorderStyle.SINGLE, size: 6 } },
    spacing: { after: 160 },
    children: [],
  })
}

async function buildDocx() {
  const sections = []

  // Cover
  sections.push(
    para('Shrimp365 사용자 가이드', { bold: true, size: 48, after: 200, color: '0284C7' }),
    para('흰다리새우 스마트 양식 관리 플랫폼', { size: 28, after: 400, color: '475569' }),
    para('© 2025 Shrimp365  ·  v1.0', { size: 18, after: 0, color: '94A3B8' }),
    hRule(),
  )

  // TOC
  sections.push(
    para('목차', { bold: true, size: 32, after: 200, color: '0F172A' }),
  )
  FEATURES.forEach((f, i) => {
    sections.push(para(`${String(i + 1).padStart(2, '0')}.  ${f.title}  —  ${f.sub}`, { size: 20, color: '334155', after: 80 }))
  })
  sections.push(hRule())

  // Feature sections
  for (const [i, f] of FEATURES.entries()) {
    sections.push(
      para(`${String(i + 1).padStart(2, '0')}.  ${f.title}`, { bold: true, size: 32, after: 100, color: '0F172A' }),
      para(f.sub, { size: 22, after: 160, color: '0284C7' }),
    )
    if (f.body) sections.push(para(f.body, { size: 21, after: 200, color: '475569' }))
    if (f.steps && f.steps.length) {
      sections.push(para('주요 기능', { bold: true, size: 22, after: 100, color: '0F172A' }))
      f.steps.forEach((st, si) => {
        sections.push(para(`${si + 1}.  ${st}`, { size: 20, after: 80, color: '334155' }))
      })
    }
    if (f.tip) {
      sections.push(
        para('', { after: 60 }),
        para(`💡 TIP  ${f.tip}`, { size: 19, after: 200, color: '15803D' }),
      )
    }
    // Embed first screenshot
    const shotPath = SHOT(f.shotFile)
    try {
      const imgBuf = fs.readFileSync(shotPath)
      const meta = META[f.shotFile]
      const maxW = 8500  // ~15cm in EMU-ish units (twips*20)
      const scale = Math.min(1, maxW / meta.w)
      sections.push(
        new Paragraph({
          children: [new ImageRun({
            data: imgBuf,
            transformation: { width: Math.round(meta.w * scale * 0.12), height: Math.round(meta.h * scale * 0.12) },
            type: 'jpg',
          })],
          spacing: { after: 80 },
        })
      )
      // Extra shots
      if (f.extraShots) {
        for (const esf of f.extraShots) {
          const esBuf = fs.readFileSync(SHOT(esf))
          const esMeta = META[esf]
          sections.push(
            new Paragraph({
              children: [new ImageRun({
                data: esBuf,
                transformation: { width: Math.round(esMeta.w * scale * 0.12), height: Math.round(esMeta.h * scale * 0.12) },
                type: 'jpg',
              })],
              spacing: { after: 80 },
            })
          )
        }
      }
    } catch(e) { /* skip if image missing */ }
    sections.push(hRule())
  }

  const doc = new DocxDocument({
    sections: [{ properties: {}, children: sections }],
    styles: {
      default: {
        document: {
          run: { font: 'Malgun Gothic', size: 22 },
        },
      },
    },
  })
  const buf = await Packer.toBuffer(doc)
  fs.writeFileSync(OUT_DOCX, buf)
  console.log('DOCX done:', OUT_DOCX)
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Computing metadata...')
  await computeMeta()

  console.log('Building PDF...')
  const doc = await buildPdf()
  await renderToFile(doc, OUT_PDF)
  console.log('PDF done:', OUT_PDF)

  console.log('Building DOCX...')
  await buildDocx()
}

main().catch(e => { console.error(e); process.exit(1) })
