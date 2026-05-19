import {
  Document, Page, View, Text, StyleSheet, Svg, Rect, Circle,
} from "@react-pdf/renderer"
import React from "react"

const C = {
  ocean:   "#0ea5e9",
  teal:    "#14b8a6",
  dark:    "#0f172a",
  slate:   "#334155",
  slate2:  "#475569",
  muted:   "#94a3b8",
  white:   "#ffffff",
  emerald: "#10b981",
  amber:   "#f59e0b",
  purple:  "#a855f7",
  rose:    "#f43f5e",
  blue:    "#3b82f6",
  bg:      "#f8fafc",
  bg2:     "#f1f5f9",
  border:  "#e2e8f0",
}

const s = StyleSheet.create({
  page: { backgroundColor: C.white, fontFamily: "Helvetica", paddingBottom: 36 },

  // Cover
  coverBg:     { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  coverWrap:   { flex: 1, alignItems: "center", justifyContent: "center", padding: 50 },
  coverTag:    { fontSize: 9, color: C.teal, letterSpacing: 3, marginBottom: 16 },
  coverTitle:  { fontSize: 38, color: C.white, fontFamily: "Helvetica-Bold", textAlign: "center", lineHeight: 1.25, marginBottom: 14 },
  coverSub:    { fontSize: 12, color: "#bae6fd", textAlign: "center", lineHeight: 1.7, maxWidth: 340, marginBottom: 36 },
  coverBadge:  { backgroundColor: C.white, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 7 },
  coverBadgeT: { fontSize: 11, color: C.ocean, fontFamily: "Helvetica-Bold" },
  coverFoot:   { position: "absolute", bottom: 28, left: 50, right: 50, flexDirection: "row", justifyContent: "space-between" },
  coverFootT:  { fontSize: 8, color: "#7dd3fc" },

  // Section header
  secHdr:  { paddingHorizontal: 40, paddingVertical: 18, borderBottomWidth: 2, borderBottomColor: C.ocean, backgroundColor: C.bg },
  secNum:  { fontSize: 8, color: C.ocean, letterSpacing: 2, marginBottom: 3, fontFamily: "Helvetica-Bold" },
  secTit:  { fontSize: 20, color: C.dark, fontFamily: "Helvetica-Bold" },
  secSub:  { fontSize: 10, color: C.slate2, marginTop: 3 },

  body: { padding: 40 },

  // Step rows
  stepRow:    { flexDirection: "row", gap: 14, marginBottom: 16, backgroundColor: C.bg, borderRadius: 10, padding: 14, borderLeftWidth: 3 },
  stepNum:    { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  stepNumT:   { fontSize: 12, color: C.white, fontFamily: "Helvetica-Bold" },
  stepTitle:  { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.dark, marginBottom: 3 },
  stepDesc:   { fontSize: 9, color: C.slate2, lineHeight: 1.6 },
  stepTip:    { marginTop: 6, backgroundColor: "#eff6ff", borderRadius: 6, padding: 7, borderLeftWidth: 2, borderLeftColor: C.ocean },
  stepTipT:   { fontSize: 8, color: C.ocean, lineHeight: 1.5 },

  // Sub-items (bullet)
  bulletRow:  { flexDirection: "row", gap: 6, marginTop: 5 },
  bullet:     { fontSize: 9, color: C.ocean, marginTop: 1 },
  bulletT:    { fontSize: 9, color: C.slate2, lineHeight: 1.5, flex: 1 },

  // Feature cards 2-col
  featGrid:   { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  featCard:   { width: "47%", backgroundColor: C.bg, borderRadius: 10, padding: 14, borderLeftWidth: 3 },
  featIcon:   { fontSize: 18, marginBottom: 6 },
  featName:   { fontSize: 10, fontFamily: "Helvetica-Bold", color: C.dark, marginBottom: 3 },
  featDesc:   { fontSize: 8, color: C.slate2, lineHeight: 1.5 },

  // Info box
  infoBox:    { backgroundColor: "#f0fdf4", borderRadius: 10, padding: 14, borderLeftWidth: 3, borderLeftColor: C.emerald, marginBottom: 14 },
  infoT:      { fontSize: 9, color: "#166534", lineHeight: 1.6 },

  // WQ table
  wqRow:      { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 6 },
  wqCell:     { fontSize: 9, color: C.slate2 },
  wqHead:     { fontSize: 9, color: C.dark, fontFamily: "Helvetica-Bold" },

  // Daily workflow cards
  dayCard:    { flex: 1, backgroundColor: C.bg, borderRadius: 10, padding: 14, alignItems: "center" },
  dayStep:    { fontSize: 8, color: C.ocean, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  dayIcon:    { fontSize: 22, marginBottom: 4 },
  dayTitle:   { fontSize: 10, fontFamily: "Helvetica-Bold", color: C.dark, marginBottom: 3 },
  dayDesc:    { fontSize: 8, color: C.slate2, textAlign: "center", lineHeight: 1.5 },

  // FAQ
  faqRow:     { backgroundColor: C.bg, borderRadius: 8, padding: 12, marginBottom: 8 },
  faqQ:       { fontSize: 9, fontFamily: "Helvetica-Bold", color: C.dark, marginBottom: 4 },
  faqA:       { fontSize: 8, color: C.slate2, lineHeight: 1.6 },

  // Footer
  footer:     { position: "absolute", bottom: 14, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between" },
  footerL:    { fontSize: 8, color: C.slate2 },
  footerR:    { fontSize: 8, color: C.muted },
})

function StepCircle({ n, color }: { n: number; color: string }) {
  return (
    <View style={[s.stepNum, { backgroundColor: color }]}>
      <Text style={s.stepNumT}>{n}</Text>
    </View>
  )
}

function PageFooter({ page }: { page: number }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerL}>🦐 Shrimp365 — 사용 설명서</Text>
      <Text style={s.footerR}>p.{page}   |   © 2026 CULIVER INC.</Text>
    </View>
  )
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={s.bulletRow}>
      <Text style={s.bullet}>•</Text>
      <Text style={s.bulletT}>{text}</Text>
    </View>
  )
}

export function GuideDocument() {
  return (
    <Document title="Shrimp365 사용 설명서" author="CULIVER INC." language="ko">

      {/* ══ P1 · 표지 ══════════════════════════════════════════════════════════ */}
      <Page size="A4" style={s.page}>
        <Svg style={s.coverBg} viewBox="0 0 595 842">
          <Rect width="595" height="842" fill="#0c1a2e" />
          <Rect x="0" y="0" width="595" height="842" fill="#0f2438" opacity="0.6" />
          <Circle cx="520" cy="140" r="220" fill={C.ocean} opacity="0.07" />
          <Circle cx="70"  cy="680" r="200" fill={C.teal}  opacity="0.07" />
          <Rect x="0" y="800" width="595" height="3" fill={C.ocean} opacity="0.5" />
          {/* top stripe */}
          <Rect x="0" y="0" width="595" height="4" fill={C.ocean} opacity="0.4" />
        </Svg>

        <View style={s.coverWrap}>
          {/* Logo block */}
          <View style={{ alignItems: "center", marginBottom: 28 }}>
            <View style={{ width: 68, height: 68, backgroundColor: C.ocean, borderRadius: 16,
                           alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
              <Text style={{ fontSize: 34 }}>🦐</Text>
            </View>
            <Text style={{ fontSize: 10, color: C.teal, letterSpacing: 5, fontFamily: "Helvetica-Bold" }}>
              SHRIMP365
            </Text>
          </View>

          <Text style={s.coverTag}>USER MANUAL  2026</Text>

          <Text style={s.coverTitle}>
            스마트 새우 양식{"\n"}사용 설명서
          </Text>

          <Text style={s.coverSub}>
            수질 기록부터 AI 어드바이저, 재고 관리까지{"\n"}
            Shrimp365의 모든 기능을 단계별로 안내합니다.
          </Text>

          <View style={s.coverBadge}>
            <Text style={s.coverBadgeT}>📖 처음 시작하는 분을 위한 안내서</Text>
          </View>
        </View>

        <View style={s.coverFoot}>
          <Text style={s.coverFootT}>© 2026 CULIVER INC.</Text>
          <Text style={s.coverFootT}>contact@culiver.ai   |   www.shrimp365.kr</Text>
        </View>
      </Page>

      {/* ══ P2 · 목차 & 서비스 개요 ════════════════════════════════════════════ */}
      <Page size="A4" style={s.page}>
        <View style={s.secHdr}>
          <Text style={s.secNum}>CONTENTS</Text>
          <Text style={s.secTit}>목차 & 서비스 개요</Text>
          <Text style={s.secSub}>Shrimp365가 제공하는 핵심 기능</Text>
        </View>
        <View style={s.body}>
          {/* TOC */}
          <View style={{ backgroundColor: C.bg, borderRadius: 10, padding: 16, marginBottom: 20 }}>
            {[
              { n: "01", title: "시작하기 — 가입 & 양식장 등록",   page: "3" },
              { n: "02", title: "매일 루틴 — 홈 화면 활용법",      page: "3" },
              { n: "03", title: "수질 기록 — 단계별 입력",          page: "4" },
              { n: "04", title: "양식 일지 — 단계별 기록",          page: "4" },
              { n: "05", title: "현황 보기 — 대시보드 & 모니터링",   page: "5" },
              { n: "06", title: "AI 어드바이저 활용",               page: "5" },
              { n: "07", title: "알림 & 경고 관리",                 page: "6" },
              { n: "08", title: "재고 관리",                        page: "6" },
              { n: "09", title: "리포트 & 분석",                    page: "7" },
              { n: "10", title: "자주 묻는 질문 (FAQ)",              page: "7" },
            ].map((row) => (
              <View key={row.n} style={{ flexDirection: "row", justifyContent: "space-between",
                                         borderBottomWidth: 1, borderBottomColor: C.border,
                                         paddingVertical: 5 }}>
                <Text style={{ fontSize: 9, color: C.slate2 }}>
                  <Text style={{ color: C.ocean, fontFamily: "Helvetica-Bold" }}>{row.n}</Text>
                  {"  "}{row.title}
                </Text>
                <Text style={{ fontSize: 9, color: C.muted }}>p.{row.page}</Text>
              </View>
            ))}
          </View>

          {/* Feature overview 2-col */}
          <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: C.muted, letterSpacing: 1, marginBottom: 8 }}>
            CORE FEATURES
          </Text>
          <View style={s.featGrid}>
            {[
              { icon: "💧", name: "수질 모니터링",    desc: "수온·pH·DO 등 9개 지표 기록 및 이력 차트. 기준 초과 즉시 알림.", color: C.ocean },
              { icon: "📔", name: "양식 일지",        desc: "급이·폐사·환수·소독 단계별 입력. 이전 값 자동 채움.", color: C.teal },
              { icon: "🤖", name: "AI 어드바이저",    desc: "한국어 대화형 질의응답. 내 수조 데이터 기반 맞춤 조언.", color: C.purple },
              { icon: "🔔", name: "알림 & 경고",      desc: "수질 이상·재고 부족 즉시 알림. 해결 처리 및 히스토리.", color: C.amber },
              { icon: "📦", name: "재고 관리",        desc: "사료·약품 재고 추적. 재주문 기준 미달 시 경고.", color: C.emerald },
              { icon: "📊", name: "리포트 & 분석",    desc: "기간별 통계 차트. PDF 내보내기.", color: C.rose },
            ].map((f) => (
              <View key={f.name} style={[s.featCard, { borderLeftColor: f.color }]}>
                <Text style={s.featIcon}>{f.icon}</Text>
                <Text style={s.featName}>{f.name}</Text>
                <Text style={s.featDesc}>{f.desc}</Text>
              </View>
            ))}
          </View>
        </View>
        <PageFooter page={2} />
      </Page>

      {/* ══ P3 · 시작하기 & 매일 루틴 ════════════════════════════════════════ */}
      <Page size="A4" style={s.page}>
        <View style={s.secHdr}>
          <Text style={s.secNum}>01 – 02</Text>
          <Text style={s.secTit}>시작하기 & 매일 루틴</Text>
          <Text style={s.secSub}>가입부터 홈 화면 활용법까지</Text>
        </View>
        <View style={s.body}>
          {/* 01 시작하기 */}
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: C.dark, marginBottom: 8 }}>
            01  가입 & 양식장 등록
          </Text>
          {[
            { n: 1, color: C.ocean, title: "회원가입", desc: "www.shrimp365.kr → '무료로 시작하기' → 이메일·비밀번호 입력 → 인증 메일 클릭. 처음 사용하신다면 로그인 화면의 '테스트 계정'으로 먼저 체험해 보세요.", tip: "가입 없이도 테스트 계정 버튼으로 모든 기능을 미리 볼 수 있습니다." },
            { n: 2, color: C.teal, title: "양식장 등록", desc: "로그인 후 → 메뉴 → '양식장·수조 관리' → '+ 양식장 추가'. 양식장 이름과 지역(시·군)을 입력하고 저장합니다.", tip: "양식장 이름은 나중에 언제든 수정할 수 있습니다." },
            { n: 3, color: C.emerald, title: "수조 추가", desc: "생성된 양식장 카드 아래 '+ 수조 추가'. 수조 이름·면적(㎡)·목표 수량을 입력합니다. 수조 단위로 수질·일지·재고가 관리됩니다.", tip: "수조가 여러 개라면 모두 등록하세요. 대시보드에서 한눈에 비교할 수 있습니다." },
          ].map((step) => (
            <View key={step.n} style={[s.stepRow, { borderLeftColor: step.color }]}>
              <StepCircle n={step.n} color={step.color} />
              <View style={{ flex: 1 }}>
                <Text style={s.stepTitle}>{step.title}</Text>
                <Text style={s.stepDesc}>{step.desc}</Text>
                <View style={s.stepTip}><Text style={s.stepTipT}>💡 {step.tip}</Text></View>
              </View>
            </View>
          ))}

          {/* 02 매일 루틴 */}
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: C.dark, marginTop: 16, marginBottom: 10 }}>
            02  매일 루틴 — 홈 화면 활용법
          </Text>
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
            {[
              { step: "① 아침", icon: "📝", title: "오늘 기록하기", desc: "홈 → 수질 기록\n+ 양식 일지 (약 5분)" },
              { step: "② 수시", icon: "🔔", title: "알림 확인",     desc: "우측 상단 종 아이콘\n이상 수치 즉시 파악" },
              { step: "③ 분석", icon: "📊", title: "현황 보기",     desc: "대시보드·수질 모니터링\n이상 징후 조기 발견" },
            ].map((d) => (
              <View key={d.step} style={s.dayCard}>
                <Text style={s.dayStep}>{d.step}</Text>
                <Text style={s.dayIcon}>{d.icon}</Text>
                <Text style={s.dayTitle}>{d.title}</Text>
                <Text style={s.dayDesc}>{d.desc}</Text>
              </View>
            ))}
          </View>
          <View style={s.infoBox}>
            <Text style={s.infoT}>
              홈 화면에서는 '오늘 기록하기'와 '현황 보기' 두 가지 버튼이 보입니다.{"\n"}
              매일 아침 기록을 먼저 완료한 뒤 현황을 확인하는 루틴을 권장합니다.
            </Text>
          </View>
        </View>
        <PageFooter page={3} />
      </Page>

      {/* ══ P4 · 수질 기록 & 양식 일지 ════════════════════════════════════════ */}
      <Page size="A4" style={s.page}>
        <View style={s.secHdr}>
          <Text style={s.secNum}>03 – 04</Text>
          <Text style={s.secTit}>수질 기록 & 양식 일지</Text>
          <Text style={s.secSub}>단계별 마법사 입력 — 화면마다 항목 하나씩</Text>
        </View>
        <View style={s.body}>
          {/* 03 수질 기록 */}
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: C.dark, marginBottom: 8 }}>
            03  수질 기록 순서
          </Text>
          <View style={[s.stepRow, { borderLeftColor: C.ocean }]}>
            <StepCircle n={3} color={C.ocean} />
            <View style={{ flex: 1 }}>
              <Text style={s.stepTitle}>홈 → 오늘 기록하기 → 수질 기록</Text>
              <Text style={s.stepDesc}>
                수조 선택 → 날짜 확인 → 수온 → pH → 용존산소(DO) → 염도 →{"\n"}
                암모니아 → 아질산 → 질산 → 알칼리도 → 탁도 → 저장 (→ 대시보드)
              </Text>
              <View style={s.stepTip}>
                <Text style={s.stepTipT}>💡 측정하지 않은 항목은 '건너뛰기' 버튼을 누르면 됩니다. 수온·pH·DO·염도는 매일 기록을 권장합니다.</Text>
              </View>
            </View>
          </View>

          {/* WQ 기준표 */}
          <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: C.muted, letterSpacing: 1, marginBottom: 6 }}>
            흰다리새우 수질 적정 기준
          </Text>
          <View style={{ backgroundColor: C.bg, borderRadius: 8, overflow: "hidden", marginBottom: 14 }}>
            <View style={[s.wqRow, { backgroundColor: C.bg2, paddingHorizontal: 10 }]}>
              {["항목", "적정 범위", "주의", "위험"].map((h) => (
                <Text key={h} style={[s.wqHead, { flex: h === "항목" ? 1.4 : 1 }]}>{h}</Text>
              ))}
            </View>
            {[
              ["수온", "28 – 32 ℃",     "< 26 또는 > 33", "> 35 ℃"],
              ["pH",   "7.5 – 8.5",     "< 7.2 또는 > 8.7", "< 7.0 또는 > 9.0"],
              ["DO",   "≥ 5 mg/L",      "4 – 5",          "< 4 mg/L"],
              ["염도", "10 – 35 ppt",   "< 8 또는 > 38",  "< 5 또는 > 42 ppt"],
              ["암모니아", "< 0.1 mg/L", "0.1 – 0.5",     "> 0.5 mg/L"],
            ].map(([item, ok, warn, danger]) => (
              <View key={item} style={[s.wqRow, { paddingHorizontal: 10 }]}>
                <Text style={[s.wqCell, { flex: 1.4, fontFamily: "Helvetica-Bold" }]}>{item}</Text>
                <Text style={[s.wqCell, { flex: 1, color: C.emerald }]}>{ok}</Text>
                <Text style={[s.wqCell, { flex: 1, color: C.amber }]}>{warn}</Text>
                <Text style={[s.wqCell, { flex: 1, color: C.rose }]}>{danger}</Text>
              </View>
            ))}
          </View>

          {/* 04 양식 일지 */}
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: C.dark, marginBottom: 8 }}>
            04  양식 일지 순서
          </Text>
          <View style={[s.stepRow, { borderLeftColor: C.teal }]}>
            <StepCircle n={4} color={C.teal} />
            <View style={{ flex: 1 }}>
              <Text style={s.stepTitle}>홈 → 오늘 기록하기 → 양식 일지</Text>
              <Text style={s.stepDesc}>
                수조 → 날짜 → 사료 종류 → 급이량(kg) → 급이 횟수 → 폐사 수 →{"\n"}
                환수율(%) → 소독 여부 → 미생물제 사용 → 설비 점검 → 메모 → 저장
              </Text>
              <View style={s.stepTip}>
                <Text style={s.stepTipT}>💡 이전 기록값(사료 종류·급이 횟수 등)이 자동으로 채워집니다. 매일 바뀌는 숫자만 수정하면 약 2분이면 완료됩니다.</Text>
              </View>
            </View>
          </View>

          {/* Tips */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            {[
              { color: C.blue,    text: "이전 기록 수정: 양식 일지 페이지의 연필(✏️) 아이콘 클릭" },
              { color: C.emerald, text: "재고 자동 차감: 일지에서 미생물제·소독제 사용 시 재고 수량 자동 감소" },
            ].map((tip, i) => (
              <View key={i} style={{ flex: 1, backgroundColor: C.bg, borderRadius: 8, padding: 10, borderLeftWidth: 3, borderLeftColor: tip.color }}>
                <Text style={{ fontSize: 8, color: C.slate2, lineHeight: 1.5 }}>{tip.text}</Text>
              </View>
            ))}
          </View>
        </View>
        <PageFooter page={4} />
      </Page>

      {/* ══ P5 · 대시보드 & AI 어드바이저 ════════════════════════════════════ */}
      <Page size="A4" style={s.page}>
        <View style={s.secHdr}>
          <Text style={s.secNum}>05 – 06</Text>
          <Text style={s.secTit}>현황 보기 & AI 어드바이저</Text>
          <Text style={s.secSub}>대시보드, 수질 모니터링, AI 활용법</Text>
        </View>
        <View style={s.body}>
          {/* 05 대시보드 */}
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: C.dark, marginBottom: 8 }}>
            05  현황 보기 — 대시보드 & 수질 모니터링
          </Text>
          <View style={[s.stepRow, { borderLeftColor: C.teal }]}>
            <StepCircle n={5} color={C.teal} />
            <View style={{ flex: 1 }}>
              <Text style={s.stepTitle}>홈 → 현황 보기  또는  메뉴 → 대시보드</Text>
              <Text style={s.stepDesc}>
                모든 수조의 현재 상태 카드, 최근 수질 이력, 재고 현황을 한 화면에서 확인합니다.{"\n"}
                빨간 카드 = 즉시 확인 필요 / 초록 카드 = 정상
              </Text>
              <View style={s.stepTip}>
                <Text style={s.stepTipT}>💡 수질 모니터링 메뉴에서는 수조별 차트와 이력을 날짜 범위로 조회할 수 있습니다. 이상값은 빨간 점으로 표시됩니다.</Text>
              </View>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
            {[
              { icon: "🔴", label: "위험", desc: "즉시 조치 필요\n수질 기준 크게 초과" },
              { icon: "🟡", label: "주의", desc: "이상 징후 감지\n지속 모니터링 필요" },
              { icon: "🟢", label: "정상", desc: "모든 수치 적정\n정상 운영 중" },
              { icon: "⚪", label: "비가동", desc: "현재 운영 중지\n알림 대상 제외" },
            ].map((s2) => (
              <View key={s2.label} style={{ flex: 1, backgroundColor: C.bg, borderRadius: 8, padding: 10, alignItems: "center" }}>
                <Text style={{ fontSize: 16, marginBottom: 4 }}>{s2.icon}</Text>
                <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: C.dark, marginBottom: 2 }}>{s2.label}</Text>
                <Text style={{ fontSize: 7.5, color: C.slate2, textAlign: "center", lineHeight: 1.4 }}>{s2.desc}</Text>
              </View>
            ))}
          </View>

          {/* 06 AI */}
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: C.dark, marginBottom: 8 }}>
            06  AI 어드바이저 활용
          </Text>
          <View style={[s.stepRow, { borderLeftColor: C.purple }]}>
            <StepCircle n={6} color={C.purple} />
            <View style={{ flex: 1 }}>
              <Text style={s.stepTitle}>메뉴 → AI 어드바이저</Text>
              <Text style={s.stepDesc}>
                현재 상황을 한국어로 자유롭게 입력하면 AI가 수조 데이터를 참고해 맞춤 답변을 드립니다.{"\n"}
                추가 질문으로 대화를 이어 나갈 수 있습니다.
              </Text>
              <View style={s.stepTip}>
                <Text style={s.stepTipT}>💡 심각한 질병 의심 상황에는 AI 조언과 함께 반드시 전문가에게도 문의하세요.</Text>
              </View>
            </View>
          </View>

          {/* 질문 예시 */}
          <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: C.muted, letterSpacing: 1, marginBottom: 6 }}>
            AI 질문 예시
          </Text>
          <View style={{ backgroundColor: C.bg, borderRadius: 8, padding: 12 }}>
            {[
              '"pH가 갑자기 7.0으로 내려갔는데 어떻게 해야 하나요?"',
              '"오늘 폐사가 갑자기 많이 나왔어요. 원인이 뭘까요?"',
              '"수온이 34℃까지 올라갔어요. 긴급 조치 방법 알려주세요."',
              '"AHPND 의심 증상인데 어떻게 대처해야 하나요?"',
            ].map((q, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 6, marginBottom: i < 3 ? 5 : 0 }}>
                <Text style={{ fontSize: 8, color: C.purple }}>💬</Text>
                <Text style={{ fontSize: 8, color: C.slate2, flex: 1, fontFamily: "Helvetica-Oblique" }}>{q}</Text>
              </View>
            ))}
          </View>
        </View>
        <PageFooter page={5} />
      </Page>

      {/* ══ P6 · 알림 & 재고 관리 ═════════════════════════════════════════════ */}
      <Page size="A4" style={s.page}>
        <View style={s.secHdr}>
          <Text style={s.secNum}>07 – 08</Text>
          <Text style={s.secTit}>알림 & 재고 관리</Text>
          <Text style={s.secSub}>경고 처리 방법 및 사료·약품 재고 추적</Text>
        </View>
        <View style={s.body}>
          {/* 07 알림 */}
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: C.dark, marginBottom: 8 }}>
            07  알림 & 경고 확인
          </Text>
          <View style={[s.stepRow, { borderLeftColor: C.amber }]}>
            <StepCircle n={7} color={C.amber} />
            <View style={{ flex: 1 }}>
              <Text style={s.stepTitle}>우측 상단 종(🔔) 아이콘 클릭</Text>
              <Text style={s.stepDesc}>
                수질 기준 초과·재고 부족 등이 발생하면 빨간 숫자 배지가 나타납니다.{"\n"}
                클릭하면 알림 목록이 표시됩니다 (수조명·항목·시각 포함).
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
            {[
              { label: "알림 항목 클릭", desc: "해당 수조 수질 페이지로 바로 이동합니다." },
              { label: "✅ 해결됨 처리", desc: "조치 완료 후 체크마크를 누르면 목록에서 사라집니다." },
              { label: "모두 해결",       desc: "'모두 해결' 버튼으로 전체 알림을 한 번에 처리합니다." },
            ].map((item) => (
              <View key={item.label} style={{ flex: 1, backgroundColor: "#fffbeb", borderRadius: 8, padding: 10, borderLeftWidth: 2, borderLeftColor: C.amber }}>
                <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold", color: C.dark, marginBottom: 3 }}>{item.label}</Text>
                <Text style={{ fontSize: 8, color: C.slate2, lineHeight: 1.4 }}>{item.desc}</Text>
              </View>
            ))}
          </View>

          {/* 08 재고 */}
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: C.dark, marginBottom: 8 }}>
            08  재고 관리
          </Text>
          <View style={[s.stepRow, { borderLeftColor: C.emerald }]}>
            <StepCircle n={8} color={C.emerald} />
            <View style={{ flex: 1 }}>
              <Text style={s.stepTitle}>메뉴 → 재고 관리</Text>
              <Text style={s.stepDesc}>
                사료·미생물제·소독약 등의 재고를 등록하고 최소 보유 수량(재주문 기준)을 설정합니다.{"\n"}
                재고가 기준 이하로 떨어지면 대시보드와 알림 패널에 경고가 표시됩니다.
              </Text>
              <View style={s.stepTip}>
                <Text style={s.stepTipT}>💡 일지에서 미생물제·소독제를 사용하면 연결된 재고가 자동으로 차감됩니다.</Text>
              </View>
            </View>
          </View>

          <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: C.muted, letterSpacing: 1, marginBottom: 6 }}>
            재고 관리 단계
          </Text>
          <View style={{ backgroundColor: C.bg, borderRadius: 8, padding: 12 }}>
            <Bullet text="품목 추가: '+ 품목 추가' → 품목명·단위·현재 수량·재주문 기준량 입력" />
            <Bullet text="입고 기록: 품목 행 우측 '+ 추가' → 수량·입고일 입력" />
            <Bullet text="자동 차감: 양식 일지 작성 시 해당 약품 재고 자동 감소" />
            <Bullet text="부족 알림: 현재 수량 ≤ 재주문 기준량이면 경고 표시" />
          </View>
        </View>
        <PageFooter page={6} />
      </Page>

      {/* ══ P7 · 리포트 & FAQ ══════════════════════════════════════════════════ */}
      <Page size="A4" style={s.page}>
        <View style={s.secHdr}>
          <Text style={s.secNum}>09 – 10</Text>
          <Text style={s.secTit}>리포트 & 자주 묻는 질문</Text>
          <Text style={s.secSub}>분석 보고서 생성 및 FAQ</Text>
        </View>
        <View style={s.body}>
          {/* 09 리포트 */}
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: C.dark, marginBottom: 8 }}>
            09  리포트 & 분석
          </Text>
          <View style={[s.stepRow, { borderLeftColor: C.rose }]}>
            <StepCircle n={9} color={C.rose} />
            <View style={{ flex: 1 }}>
              <Text style={s.stepTitle}>메뉴 → 리포트</Text>
              <Text style={s.stepDesc}>
                기간(7일·30일·90일)과 수조를 선택하면 수질 추이·급이량·폐사율 그래프가 생성됩니다.{"\n"}
                PDF 다운로드 버튼으로 보고서를 저장할 수 있습니다.
              </Text>
              <View style={s.stepTip}>
                <Text style={s.stepTipT}>💡 월별 리포트를 정기적으로 저장해 두면 연간 수익성 분석과 다음 사육 계획 수립에 활용할 수 있습니다.</Text>
              </View>
            </View>
          </View>

          {/* FAQ */}
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold", color: C.dark, marginTop: 16, marginBottom: 8 }}>
            10  자주 묻는 질문 (FAQ)
          </Text>
          {[
            { q: "스마트폰에서도 사용할 수 있나요?", a: "네. 별도 앱 설치 없이 스마트폰 브라우저(Chrome·Safari)에서 바로 사용 가능합니다. 브라우저에서 '홈 화면에 추가'하면 앱처럼 아이콘으로 실행할 수 있습니다." },
            { q: "수질 기록은 모든 항목을 입력해야 하나요?", a: "수온·pH·DO·염도는 매일 기록을 권장하는 핵심 항목입니다. 나머지 항목(암모니아 등)은 측정하지 않은 날에는 '건너뛰기'를 누르면 됩니다." },
            { q: "이전에 입력한 값을 수정할 수 있나요?", a: "수질 모니터링 페이지의 이력 탭과 양식 일지 페이지에서 연필(✏️) 아이콘을 클릭하면 수정·삭제할 수 있습니다." },
            { q: "수조가 여러 개인데 한 번에 확인할 수 있나요?", a: "대시보드에서 모든 수조의 상태 카드를 한눈에 볼 수 있습니다. 각 카드를 클릭하면 상세 수질 이력으로 이동합니다." },
            { q: "무료 플랜 범위는 어떻게 되나요?", a: "무료 플랜은 양식장 1개·수조 최대 3개까지 등록할 수 있으며, 수질 기록·일지·AI 어드바이저 기본 기능을 모두 사용할 수 있습니다." },
            { q: "데이터를 내보낼 수 있나요?", a: "리포트 메뉴에서 기간을 선택해 PDF로 내보낼 수 있습니다. 서버에 저장된 데이터는 삭제하지 않는 한 영구 보관됩니다." },
          ].map((faq, i) => (
            <View key={i} style={s.faqRow}>
              <Text style={s.faqQ}>Q. {faq.q}</Text>
              <Text style={s.faqA}>A. {faq.a}</Text>
            </View>
          ))}

          {/* Contact */}
          <View style={{ backgroundColor: C.ocean, borderRadius: 12, padding: 16, marginTop: 16,
                         flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View>
              <Text style={{ fontSize: 11, color: C.white, fontFamily: "Helvetica-Bold", marginBottom: 3 }}>
                추가 문의가 있으신가요?
              </Text>
              <Text style={{ fontSize: 9, color: "#bae6fd" }}>contact@culiver.ai   |   www.shrimp365.kr</Text>
            </View>
            <Text style={{ fontSize: 28 }}>🦐</Text>
          </View>
        </View>
        <PageFooter page={7} />
      </Page>

    </Document>
  )
}
