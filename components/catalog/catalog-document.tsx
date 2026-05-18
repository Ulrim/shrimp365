import {
  Document, Page, View, Text, StyleSheet, Svg, Rect, Circle,
} from "@react-pdf/renderer"
import React from "react"

// ─── 색상 팔레트 ──────────────────────────────────────────────────────────────
const C = {
  ocean:    "#0ea5e9",
  teal:     "#14b8a6",
  dark:     "#0f172a",
  slate:    "#1e293b",
  slate2:   "#334155",
  slate3:   "#475569",
  muted:    "#94a3b8",
  white:    "#ffffff",
  emerald:  "#10b981",
  amber:    "#f59e0b",
  purple:   "#a855f7",
  rose:     "#f43f5e",
  light:    "#f1f5f9",
  light2:   "#e2e8f0",
}

const s = StyleSheet.create({
  page: { backgroundColor: C.dark, fontFamily: "Helvetica", paddingBottom: 30 },
  pageLight: { backgroundColor: C.light, fontFamily: "Helvetica", paddingBottom: 30 },

  // ── Cover ──
  coverBg:      { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  coverContent: { flex: 1, alignItems: "center", justifyContent: "center", padding: 50 },
  coverTag:     { fontSize: 9, color: C.teal, letterSpacing: 3, marginBottom: 20, textTransform: "uppercase" },
  coverTitle:   { fontSize: 42, color: C.white, fontFamily: "Helvetica-Bold", textAlign: "center", lineHeight: 1.2, marginBottom: 16 },
  coverSub:     { fontSize: 13, color: C.muted, textAlign: "center", lineHeight: 1.6, maxWidth: 360, marginBottom: 40 },
  coverBadge:   { backgroundColor: C.teal, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, marginBottom: 8 },
  coverBadgeT:  { fontSize: 10, color: C.white, fontFamily: "Helvetica-Bold" },
  coverUrl:     { fontSize: 10, color: C.ocean, marginTop: 60 },
  coverFooter:  { position: "absolute", bottom: 30, left: 50, right: 50, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  coverFooterT: { fontSize: 8, color: C.slate3 },

  // ── Section header ──
  sectionHeader:  { backgroundColor: C.slate, paddingHorizontal: 40, paddingVertical: 22, borderBottomWidth: 2, borderBottomColor: C.ocean },
  sectionNum:     { fontSize: 9, color: C.ocean, letterSpacing: 2, marginBottom: 4, fontFamily: "Helvetica-Bold" },
  sectionTitle:   { fontSize: 22, color: C.white, fontFamily: "Helvetica-Bold" },
  sectionSub:     { fontSize: 10, color: C.muted, marginTop: 4 },

  // ── Body ──
  body:           { padding: 40 },
  bodyLight:      { padding: 40 },

  // ── Feature cards (dark bg) ──
  featureGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 16 },
  featureCard:    { width: "47%", backgroundColor: C.slate, borderRadius: 10, padding: 16, borderLeftWidth: 3 },
  featureIcon:    { fontSize: 20, marginBottom: 8 },
  featureName:    { fontSize: 11, color: C.white, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  featureDesc:    { fontSize: 9, color: C.muted, lineHeight: 1.5 },

  // ── Step rows (light bg) ──
  stepRow:        { flexDirection: "row", alignItems: "flex-start", marginBottom: 20, backgroundColor: C.white, borderRadius: 10, padding: 14, gap: 14 },
  stepNum:        { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  stepNumT:       { fontSize: 13, color: C.white, fontFamily: "Helvetica-Bold" },
  stepContent:    { flex: 1 },
  stepTitle:      { fontSize: 12, fontFamily: "Helvetica-Bold", color: C.dark, marginBottom: 4 },
  stepDesc:       { fontSize: 9, color: C.slate3, lineHeight: 1.6 },
  stepTip:        { marginTop: 6, backgroundColor: "#eff6ff", borderRadius: 6, padding: 7, borderLeftWidth: 2, borderLeftColor: C.ocean },
  stepTipT:       { fontSize: 8, color: C.ocean, lineHeight: 1.5 },

  // ── Pricing table ──
  pricingRow:     { flexDirection: "row", gap: 12, marginTop: 16 },
  pricingCard:    { flex: 1, borderRadius: 12, padding: 16, alignItems: "center" },
  pricingPlan:    { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  pricingPrice:   { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  pricingPer:     { fontSize: 8, marginBottom: 12 },
  pricingDivider: { height: 1, alignSelf: "stretch", marginBottom: 12 },
  pricingItem:    { fontSize: 8, marginBottom: 5, alignSelf: "flex-start" },
  pricingPromo:   { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.emerald, marginTop: 10, textAlign: "center" },

  // ── Contact ──
  contactRow:     { flexDirection: "row", gap: 16, marginTop: 20 },
  contactBox:     { flex: 1, backgroundColor: C.white, borderRadius: 12, padding: 20 },
  contactLabel:   { fontSize: 8, color: C.slate3, marginBottom: 3, fontFamily: "Helvetica-Bold", letterSpacing: 1, textTransform: "uppercase" },
  contactVal:     { fontSize: 11, color: C.dark, fontFamily: "Helvetica-Bold", marginBottom: 12 },
  qrBox:          { width: 120, backgroundColor: C.white, borderRadius: 12, padding: 14, alignItems: "center", justifyContent: "center" },
  qrPlaceholder:  { width: 80, height: 80, backgroundColor: C.light2, borderRadius: 6, marginBottom: 8, alignItems: "center", justifyContent: "center" },
  qrLabel:        { fontSize: 8, color: C.slate3, textAlign: "center" },

  // ── Footer ──
  footer:         { position: "absolute", bottom: 14, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  footerT:        { fontSize: 8, color: C.slate2 },
  footerTL:       { fontSize: 8, color: C.slate3 },
})

// ─── 헬퍼 컴포넌트 ───────────────────────────────────────────────────────────
function StepCircle({ n, color }: { n: number; color: string }) {
  return (
    <View style={[s.stepNum, { backgroundColor: color }]}>
      <Text style={s.stepNumT}>{n}</Text>
    </View>
  )
}

// ─── Page footer ─────────────────────────────────────────────────────────────
function PageFooter({ page, total }: { page: number; total: number }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerT}>🦐 Shrimp365 — 스마트 새우 양식 플랫폼</Text>
      <Text style={s.footerTL}>{page} / {total}   |   www.shrimp365.kr</Text>
    </View>
  )
}

// ─── Document ─────────────────────────────────────────────────────────────────
export function CatalogDocument() {
  return (
    <Document title="Shrimp365 카탈로그" author="CULIVER INC." language="ko">

      {/* ══ P1 · 표지 ══════════════════════════════════════════════════════════ */}
      <Page size="A4" style={s.page}>
        {/* 배경 그라디언트 모방 */}
        <Svg style={s.coverBg} viewBox="0 0 595 842">
          <Rect width="595" height="842" fill={C.dark} />
          <Rect x="0" y="0" width="595" height="420" fill="#0c1a2e" opacity="0.8" />
          <Circle cx="500" cy="120" r="200" fill={C.ocean} opacity="0.06" />
          <Circle cx="80"  cy="700" r="180" fill={C.teal}  opacity="0.06" />
          {/* 하단 장식선 */}
          <Rect x="0" y="798" width="595" height="2" fill={C.ocean} opacity="0.4" />
        </Svg>

        <View style={s.coverContent}>
          {/* 로고 */}
          <View style={{ alignItems: "center", marginBottom: 32 }}>
            <View style={{ width: 72, height: 72, backgroundColor: C.ocean, borderRadius: 18,
                           alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
              <Text style={{ fontSize: 36 }}>🦐</Text>
            </View>
            <Text style={{ fontSize: 11, color: C.teal, letterSpacing: 4, fontFamily: "Helvetica-Bold" }}>SHRIMP365</Text>
          </View>

          <Text style={s.coverTag}>PRODUCT CATALOG  2025</Text>

          <Text style={s.coverTitle}>
            흰다리새우 양식을{"\n"}스마트하게
          </Text>

          <Text style={s.coverSub}>
            수질 모니터링부터 AI 어드바이저, 질병 진단, 재고 관리까지{"\n"}
            양식 현장에 필요한 모든 것을 하나의 플랫폼으로.
          </Text>

          <View style={s.coverBadge}>
            <Text style={s.coverBadgeT}>🎉 지금 가입 시 Pro 3개월 무료</Text>
          </View>
          <Text style={{ fontSize: 9, color: C.muted }}>신용카드 불필요 · 언제든 취소 가능</Text>

          <Text style={s.coverUrl}>www.shrimp365.kr</Text>
        </View>

        {/* 표지 하단 */}
        <View style={s.coverFooter}>
          <Text style={s.coverFooterT}>© 2025 CULIVER INC.</Text>
          <Text style={s.coverFooterT}>contact@culiver.ai</Text>
        </View>
      </Page>

      {/* ══ P2 · 서비스 소개 & 주요 기능 ══════════════════════════════════════ */}
      <Page size="A4" style={s.page}>
        <View style={s.sectionHeader}>
          <Text style={s.sectionNum}>01  SERVICE OVERVIEW</Text>
          <Text style={s.sectionTitle}>Shrimp365란?</Text>
          <Text style={s.sectionSub}>양식 현장에서 바로 쓰는 스마트 수산 관리 플랫폼</Text>
        </View>

        <View style={s.body}>
          {/* 한 줄 소개 */}
          <View style={{ backgroundColor: C.slate, borderRadius: 10, padding: 16, marginBottom: 20,
                         borderLeftWidth: 4, borderLeftColor: C.teal }}>
            <Text style={{ fontSize: 11, color: C.white, lineHeight: 1.7 }}>
              Shrimp365는 흰다리새우(Litopenaeus vannamei) 양식 농가를 위한 클라우드 기반 관리 솔루션입니다.{"\n"}
              스마트폰과 PC에서 동시에 사용할 수 있으며, 수질 이상 발생 시 즉시 알림을 받고{"\n"}
              AI의 도움으로 빠르게 대처할 수 있습니다.
            </Text>
          </View>

          {/* 기능 카드 6개 */}
          <Text style={{ fontSize: 10, color: C.muted, marginBottom: 10, fontFamily: "Helvetica-Bold", letterSpacing: 1 }}>
            CORE FEATURES
          </Text>
          <View style={s.featureGrid}>
            {[
              { icon: "💧", name: "실시간 수질 모니터링", desc: "수온·pH·DO·암모니아 등 9개 지표를 실시간으로 추적하고, 기준 초과 시 즉시 알림.", color: C.ocean },
              { icon: "🤖", name: "AI 어드바이저",        desc: "수질 이상·폐사·질병 상황을 대화형으로 입력하면 원인 분석과 대처 방법을 즉시 안내.", color: C.purple },
              { icon: "🧪", name: "질병 진단 연계",       desc: "AHPND·EHP 등 주요 새우 질병 검사 결과를 기록하고 위험 수조를 한눈에 파악.", color: C.rose },
              { icon: "📔", name: "양식 일지",            desc: "급이량·폐사량·환수·소독 내역을 매일 기록. 반복 입력값 자동 저장으로 시간 절약.", color: C.teal },
              { icon: "📦", name: "재고 관리",            desc: "사료·미생물제·소독약 재고를 추적하고, 재주문 기준 이하 시 자동 경고.", color: C.amber },
              { icon: "📊", name: "리포트 & 분석",        desc: "기간별 수질 통계, 급이 현황, 생산 실적을 PDF/엑셀로 내보내기.", color: C.emerald },
            ].map((f) => (
              <View key={f.name} style={[s.featureCard, { borderLeftColor: f.color }]}>
                <Text style={s.featureIcon}>{f.icon}</Text>
                <Text style={s.featureName}>{f.name}</Text>
                <Text style={s.featureDesc}>{f.desc}</Text>
              </View>
            ))}
          </View>

          {/* 수치 하이라이트 */}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
            {[
              { num: "9가지",  label: "수질 지표 모니터링" },
              { num: "24/7",   label: "실시간 알림" },
              { num: "3분",    label: "평균 설정 시간" },
              { num: "100%",   label: "모바일 호환" },
            ].map((stat) => (
              <View key={stat.label} style={{ flex: 1, backgroundColor: C.slate, borderRadius: 8, padding: 12, alignItems: "center" }}>
                <Text style={{ fontSize: 16, color: C.ocean, fontFamily: "Helvetica-Bold" }}>{stat.num}</Text>
                <Text style={{ fontSize: 8, color: C.muted, marginTop: 3, textAlign: "center" }}>{stat.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <PageFooter page={2} total={4} />
      </Page>

      {/* ══ P3 · 단계별 사용법 ═════════════════════════════════════════════════ */}
      <Page size="A4" style={s.pageLight}>
        <View style={[s.sectionHeader, { backgroundColor: C.white, borderBottomColor: C.ocean }]}>
          <Text style={s.sectionNum}>02  HOW TO USE</Text>
          <Text style={[s.sectionTitle, { color: C.dark }]}>5분 만에 시작하기</Text>
          <Text style={[s.sectionSub, { color: C.slate3 }]}>아래 순서대로 따라하면 오늘부터 바로 사용할 수 있습니다</Text>
        </View>

        <View style={s.bodyLight}>
          {[
            {
              n: 1, color: C.ocean,
              title: "회원가입 & 로그인",
              desc: "www.shrimp365.kr 접속 후 이메일로 가입. 인증 메일 클릭 한 번으로 완료. 현재 가입하면 Pro 3개월 무료!",
              tip: "로그인 화면의 '데모 체험' 버튼을 누르면 가입 없이 모든 기능을 미리 볼 수 있습니다.",
            },
            {
              n: 2, color: C.teal,
              title: "양식장 & 수조 등록",
              desc: "대시보드 → 양식장 관리 → '+ 양식장 추가'. 양식장 이름·지역 입력 후 수조를 추가하세요. 수조는 이름·면적·목표 수량을 입력합니다.",
              tip: "수조를 여러 개 등록하면 각 수조별로 수질·일지·재고를 독립적으로 관리할 수 있습니다.",
            },
            {
              n: 3, color: C.emerald,
              title: "수질 기록 시작",
              desc: "수질 모니터링 메뉴 → 수조 선택 → '수질 기록 추가'. 수온·pH·DO 등을 입력하면 기준 초과 시 알림이 발송됩니다.",
              tip: "적정 범위: 수온 28~32℃ / pH 7.5~8.5 / DO 5mg/L 이상",
            },
            {
              n: 4, color: C.purple,
              title: "AI 어드바이저 활용",
              desc: "이상 징후가 생기면 AI 어드바이저에게 자유롭게 질문하세요. \"pH가 낮아졌어요\" 같은 자연어로 입력하면 원인과 대처법을 안내합니다.",
              tip: "수질 데이터가 쌓일수록 AI의 답변 정확도가 높아집니다.",
            },
            {
              n: 5, color: C.amber,
              title: "일지·재고 관리",
              desc: "매일 급이량·폐사 수를 일지에 기록하고, 사료·소독약 재고를 등록해 두면 부족할 때 자동으로 알림이 옵니다.",
              tip: "일지의 반복 입력 항목(사료 종류, 급이 횟수)은 마지막 값이 자동으로 채워져 매일 바뀌는 수치만 수정하면 됩니다.",
            },
          ].map((step) => (
            <View key={step.n} style={s.stepRow}>
              <StepCircle n={step.n} color={step.color} />
              <View style={s.stepContent}>
                <Text style={s.stepTitle}>{step.title}</Text>
                <Text style={s.stepDesc}>{step.desc}</Text>
                <View style={s.stepTip}>
                  <Text style={s.stepTipT}>💡 {step.tip}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        <PageFooter page={3} total={4} />
      </Page>

      {/* ══ P4 · 요금제 & 연락처 ══════════════════════════════════════════════ */}
      <Page size="A4" style={s.pageLight}>
        <View style={[s.sectionHeader, { backgroundColor: C.white, borderBottomColor: C.ocean }]}>
          <Text style={s.sectionNum}>03  PRICING & CONTACT</Text>
          <Text style={[s.sectionTitle, { color: C.dark }]}>요금제 & 연락처</Text>
          <Text style={[s.sectionSub, { color: C.slate3 }]}>지금 가입하면 Pro 3개월 무료 — 결제 없이 바로 시작</Text>
        </View>

        <View style={s.bodyLight}>
          {/* 요금제 */}
          <View style={s.pricingRow}>
            {/* Free */}
            <View style={[s.pricingCard, { backgroundColor: C.light2 }]}>
              <Text style={[s.pricingPlan, { color: C.slate3 }]}>Free</Text>
              <Text style={[s.pricingPrice, { color: C.dark }]}>₩0</Text>
              <Text style={[s.pricingPer, { color: C.muted }]}>/월</Text>
              <View style={[s.pricingDivider, { backgroundColor: C.light }]} />
              {["양식장 1개", "수조 5개", "AI 하루 5회", "기본 기록"].map(f => (
                <Text key={f} style={[s.pricingItem, { color: C.slate3 }]}>✓  {f}</Text>
              ))}
            </View>
            {/* Basic */}
            <View style={[s.pricingCard, { backgroundColor: "#eff6ff" }]}>
              <Text style={[s.pricingPlan, { color: C.ocean }]}>Basic</Text>
              <Text style={[s.pricingPrice, { color: C.dark }]}>₩19,900</Text>
              <Text style={[s.pricingPer, { color: C.muted }]}>/월</Text>
              <View style={[s.pricingDivider, { backgroundColor: C.light2 }]} />
              {["양식장 2개", "수조 15개", "AI 하루 15회", "센서 연동 1대", "30일 리포트"].map(f => (
                <Text key={f} style={[s.pricingItem, { color: C.slate2 }]}>✓  {f}</Text>
              ))}
              <Text style={s.pricingPromo}>🎉 3개월 무료 체험 가능</Text>
            </View>
            {/* Pro */}
            <View style={[s.pricingCard, { backgroundColor: C.ocean }]}>
              <View style={{ backgroundColor: C.teal, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 6 }}>
                <Text style={{ fontSize: 8, color: C.white, fontFamily: "Helvetica-Bold" }}>⚡ 인기</Text>
              </View>
              <Text style={[s.pricingPlan, { color: C.white }]}>Pro</Text>
              <Text style={[s.pricingPrice, { color: C.white }]}>₩39,900</Text>
              <Text style={[s.pricingPer, { color: "#bae6fd" }]}>/월</Text>
              <View style={[s.pricingDivider, { backgroundColor: "#0284c7" }]} />
              {["양식장 5개", "수조 50개", "AI 하루 30회", "센서 연동 5대", "CSV 내보내기", "7/30/90일 리포트"].map(f => (
                <Text key={f} style={[s.pricingItem, { color: C.white }]}>✓  {f}</Text>
              ))}
              <Text style={[s.pricingPromo, { color: C.white }]}>🎉 3개월 무료 체험 가능</Text>
            </View>
          </View>

          {/* 연락처 & QR */}
          <Text style={{ fontSize: 10, color: C.slate3, fontFamily: "Helvetica-Bold", letterSpacing: 1,
                         marginTop: 24, marginBottom: 12 }}>
            CONTACT & ACCESS
          </Text>
          <View style={s.contactRow}>
            <View style={s.contactBox}>
              <Text style={s.contactLabel}>웹사이트</Text>
              <Text style={s.contactVal}>www.shrimp365.kr</Text>
              <Text style={s.contactLabel}>이메일</Text>
              <Text style={s.contactVal}>contact@culiver.ai</Text>
              <Text style={s.contactLabel}>운영사</Text>
              <Text style={[s.contactVal, { marginBottom: 0 }]}>CULIVER INC.</Text>
            </View>

            {/* QR 자리 */}
            <View style={s.qrBox}>
              <View style={s.qrPlaceholder}>
                {/* QR 격자 모방 */}
                <Svg width="60" height="60" viewBox="0 0 60 60">
                  <Rect width="60" height="60" fill={C.light2} />
                  <Rect x="4"  y="4"  width="22" height="22" rx="3" fill={C.dark} />
                  <Rect x="34" y="4"  width="22" height="22" rx="3" fill={C.dark} />
                  <Rect x="4"  y="34" width="22" height="22" rx="3" fill={C.dark} />
                  <Rect x="8"  y="8"  width="14" height="14" fill={C.white} />
                  <Rect x="38" y="8"  width="14" height="14" fill={C.white} />
                  <Rect x="8"  y="38" width="14" height="14" fill={C.white} />
                  <Rect x="10" y="10" width="10" height="10" fill={C.dark} />
                  <Rect x="40" y="10" width="10" height="10" fill={C.dark} />
                  <Rect x="10" y="40" width="10" height="10" fill={C.dark} />
                  <Rect x="34" y="34" width="5"  height="5"  fill={C.dark} />
                  <Rect x="41" y="34" width="5"  height="5"  fill={C.dark} />
                  <Rect x="34" y="41" width="5"  height="5"  fill={C.dark} />
                  <Rect x="41" y="41" width="5"  height="5"  fill={C.dark} />
                  <Rect x="48" y="34" width="8"  height="5"  fill={C.dark} />
                  <Rect x="34" y="48" width="8"  height="8"  fill={C.dark} />
                </Svg>
              </View>
              <Text style={s.qrLabel}>QR 스캔으로{"\n"}바로 접속</Text>
            </View>
          </View>

          {/* 하단 CTA */}
          <View style={{ backgroundColor: C.ocean, borderRadius: 12, padding: 20, marginTop: 20,
                         flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View>
              <Text style={{ fontSize: 14, color: C.white, fontFamily: "Helvetica-Bold", marginBottom: 4 }}>
                지금 무료로 시작하세요
              </Text>
              <Text style={{ fontSize: 9, color: "#bae6fd" }}>
                3개월 Pro 무료 · 카드 등록 불필요 · 언제든 취소
              </Text>
            </View>
            <View style={{ backgroundColor: C.white, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
              <Text style={{ fontSize: 10, color: C.ocean, fontFamily: "Helvetica-Bold" }}>
                shrimp365.kr
              </Text>
            </View>
          </View>
        </View>

        <PageFooter page={4} total={4} />
      </Page>

    </Document>
  )
}
