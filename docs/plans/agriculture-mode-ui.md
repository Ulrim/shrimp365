# 농업 모드 UI 설계서 (수아) — 쪽파 스마트 수경재배 대시보드

- 작성: 수아 (디자이너)
- 작성일: 2026-08-18
- 상위 문서: `docs/plans/agriculture-mode.md` (민준) — 6장 1단계 산출물
- 대상 독자: 서연 (이 문서만 보고 구현 가능해야 한다)

## 0. 공통 원칙

- **새우 모드 화면은 픽셀 하나 바꾸지 않는다.** 모든 분기는 "농업 모드일 때만 추가/치환"이다.
  farm_type 미지정·혼합 계정 = 새우 모드 (설계서 3장 파생 규칙).
- 톤: 기존 그대로. 브랜드 파랑 `#1E40AF`(active 상태·로고), ocean-500/600(버튼),
  emerald(정상), amber(주의), red(위험). 새 색을 만들지 않는다.
- 카드: `bg-card border-border` + 기존 `Card` 컴포넌트. 수치는 `tabular-nums`
  (device-current-values.tsx 결). 배지는 bottom-nav의 amber 배지 결
  (`bg-amber-100 text-amber-700 border-amber-200`).
- 터치 타깃 44px, `aria-pressed`/`role="group"` 등 기존 온보딩 페이지의 접근성 패턴 유지.
- verdict·상태는 **색+텍스트 병기** (색만으로 의미 전달 금지).
- 아이콘은 lucide-react만: 수경재배 = `Sprout`, 레시피 = `FlaskConical`(기존 import 재활용),
  나머지 메뉴 아이콘은 변경하지 않는다 (diff 최소화).

### 라벨 분기의 두 축 — 서연 필독

라벨이 바뀌는 경로가 **두 가지**라는 점이 이 설계의 핵심이다:

| 축 | 기준 | 적용 대상 |
|---|---|---|
| **전역 UI 모드** (i18n merge) | 사용자의 farm 전체가 agriculture | 메뉴, 페이지 제목, 대시보드, 로고 부제 등 화면 전반 |
| **farm 단위** (farm.farm_type) | 지금 편집 중인 farm의 유형 | `/farms`의 베드 폼, 레시피 섹션, 온보딩(선택 직후) |

혼합 계정(새우+농업 farm)은 전역 모드가 새우라서 i18n merge가 안 된다. 그래도
agriculture farm의 베드 폼을 열면 레시피 섹션과 "베드" 라벨이 나와야 한다.
→ **폼 내부 전용 라벨(3-2의 `agri` 섹션)은 본 사전(ko.ts)에 두고 `farm.farm_type`으로
분기**한다. i18n 오버라이드(3-3의 agri-ko)에 의존하지 않는다.

---

## 1. 온보딩 유형 선택 (`app/onboarding/page.tsx`)

### 1-1. Step 1 — 유형 선택 카드 2택

Step 1 카드(`CardContent`) **맨 위**, "양식장 이름" 필드 앞에 배치.

```
┌─ Step 1: 농장 정보 ──────────────────────────────┐
│  무엇을 운영하시나요? *                            │
│  ┌──────────────────┐  ┌──────────────────┐      │
│  │ 〰 Waves          │  │ 🌱 Sprout        │      │
│  │ 새우 양식          │  │ 수경재배          │      │
│  │ 축제식·실내 양식장  │  │ NFT 베드·양액     │      │
│  │ 수질 관리          │  │ 재순환 관리        │      │
│  └──────────────────┘  └──────────────────┘      │
│  (이하 기존 필드: 이름/주소/대표자/면적 — 무변)      │
└──────────────────────────────────────────────────┘
```

- 마크업 스케치 (기존 tank_type 버튼 결을 카드로 키운 것):

```tsx
<div className="space-y-1.5">
  <Label className="text-foreground text-sm font-medium">
    {t.onboarding.farmTypeLabel} <span className="text-destructive" aria-hidden="true">*</span>
  </Label>
  <div className="grid grid-cols-2 gap-3" role="group" aria-label={t.onboarding.farmTypeLabel}>
    {/* 카드 1개당 */}
    <button
      type="button"
      onClick={() => setFarmType("shrimp")}
      aria-pressed={farmType === "shrimp"}
      className={`min-h-[44px] rounded-xl border p-4 text-left transition-all
        ${farmType === "shrimp"
          ? "border-ocean-500 bg-ocean-500/5 ring-1 ring-ocean-500/40"
          : "border-border bg-muted/50 hover:border-ocean-300"}`}
    >
      <Waves className={`w-6 h-6 mb-2 ${farmType === "shrimp" ? "text-ocean-600" : "text-muted-foreground"}`} aria-hidden="true" />
      <p className="text-sm font-semibold text-foreground">{t.onboarding.farmTypeShrimp}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{t.onboarding.farmTypeShrimpDesc}</p>
    </button>
    {/* 두 번째 카드: Sprout / farmTypeAgri / farmTypeAgriDesc — 동일 패턴 */}
  </div>
</div>
```

- 기본 선택: `"shrimp"` (절대 원칙 — 기본값은 언제나 새우 양식).
- 모바일에서도 `grid-cols-2` 유지 (텍스트 2줄이라 320px에서도 안전).

### 1-2. agriculture 선택 시 Step 1·2 변화

라벨 치환은 페이지 로컬 merge로 처리한다 (온보딩 시점엔 farm이 없어 전역 모드가
새우이므로): `const tt = farmType === "agriculture" ? deepMerge2(t, agriKo) : t`
— i18n-context에 만들  2단 merge 헬퍼를 export해서 재사용.

**Step 1** (필드 구성 무변, 라벨만 tt로 치환):
- 제목 "농장 정보", 양식장 이름 → "농장 이름" (placeholder "예: 제1온실").
- 좌측 브랜드 패널의 title/subtitle도 tt 적용 (agri-ko onboarding 참조).

**Step 2 "베드 등록"** — 필드 구성 변경:

| 기존 필드 | 농업 모드 처리 |
|---|---|
| 수조 이름 | 유지 — 라벨 "베드 이름", placeholder "예: A동 1베드" |
| 수조 유형 (노지/실내/반실내) | 유지 — 라벨 "베드 유형", 기본값 **"실내"** (NFT 베드는 대부분 온실·실내) |
| 용량 (㎥) | 유지 — 라벨 "양액조 용량 (㎥, 선택)", placeholder "예: 1", 헬퍼 텍스트 "1 ㎥ = 1,000 L" |
| 입식 밀도 (마리/㎥) | **숨김** (저장 시 0) |
| 입식일 | **숨김** (저장 시 null, cycle_day 0) |
| — | **추가**: 양액 레시피 블록 (아래) |

**양액 레시피 블록** (베드 카드 안, 용량 아래):

```
─── ⚗ 양액 레시피 (선택) ───────────────────
목표값을 벗어나면 알림을 보내드립니다.
┌─ 목표 EC (mS/cm) ─┐  ┌─ 목표 pH ─────────┐
│ 예: 1.8           │  │ 예: 6.0            │
└───────────────────┘  └───────────────────┘
허용 오차는 기본 ±0.1 mS/cm · pH ±0.5 로 설정됩니다.
농장·기기 관리에서 언제든 바꿀 수 있습니다.
```

- 온보딩에서는 **목표 EC·목표 pH 2필드만** 받는다 (오차 입력은 `/farms` 폼에만 —
  온보딩 과부하 방지, 점진적 공개). 둘 다 선택 입력, 비우면 레시피 미설정(NULL).
- 입력 단위 **mS/cm** — number, `step=0.1` `min=0.1` `max=10`.
  저장 시 `target_ec = 입력값 × 1000` (µS/cm), `ec_tolerance`는 DB DEFAULT 100.
- 목표 pH: `step=0.1` `min=3` `max=9`. `ph_tolerance` DEFAULT 0.5.
- 검증(입력했을 때만): 범위 밖이면 기존 에러 박스에 `t.agri.ecRangeError` /
  `t.agri.phRangeError` 표시.
- 소제목 아이콘: `FlaskConical` 16px + `text-ocean-600`, 소제목 `text-xs font-semibold`,
  블록 위 `border-t border-border pt-3` 구분.

**저장 로직**: `createFarm`에 `farm_type` 전달. agriculture일 때
`createTank({ ..., stocking_density: 0, shrimp_count: 0, cycle_day: 0, stocking_date: null, target_ec, target_ph })`.

**Step 3 완료 화면**: 문안만 tt 치환 (`step3Subtitle` — "…에 베드 N개 등록"),
버튼 "대시보드 시작하기" 그대로.

---

## 2. 농업 모드 메뉴 (`sidebar.tsx` 39~59행, `bottom-nav.tsx` 31~52행)

### 2-1. 구현 방식

배열 자체를 복제하지 말 것. **숨길 href 집합으로 필터**한다 — 라벨은 i18n merge가
자동으로 치환하므로 코드는 필터 한 줄이 전부다:

```ts
const AGRI_HIDDEN = new Set(["/production", "/inventory", "/ai-advisor", "/reports"])
const monitorNav = isAgriMode ? MONITOR_NAV.filter(i => !AGRI_HIDDEN.has(i.href)) : MONITOR_NAV
```

bottom-nav의 `MORE`도 같은 집합으로 필터. `PRIMARY` 4개(홈/측정 기록/영농 일지/모니터링)는
href 무변, 라벨만 merge로 치환 — 하단 탭 5개 이하 원칙 그대로 유지된다.

### 2-2. 최종 메뉴 (농업 모드)

**sidebar** — 순서는 기존 배열 순서 그대로 (4개 제거만):

| 구역 | 항목 | 라벨 (치환 후) | 아이콘 |
|---|---|---|---|
| — | `/home` | 홈 | Home |
| 기록 | `/record/water-quality` | 측정 기록 | Droplets |
| 기록 | `/record/journal` | 영농 일지 | ClipboardList |
| 모니터링 | `/dashboard` | 모니터링 | LayoutDashboard |
| 모니터링 | `/water-quality` | 양액 관리 | Droplets |
| 모니터링 | `/journal` | 영농 일지 | BookOpen |
| 모니터링 | `/farms` | 농장·기기 관리 | Building2 |
| 모니터링 | board/cardnews/관제센터/admin | 기존 조건·라벨 그대로 | — |

숨김: 생산 관리, 재고 관리, AI 어드바이저, 리포트. URL 직접 접근은 막지 않는다(설계서 원칙).

**bottom-nav PRIMARY**: 홈 / 측정 기록 / 영농 일지 / 모니터링 / 더보기 — 구조 무변.

### 2-3. 로고 부제

- sidebar 113행의 하드코딩 `SMART AQUACULTURE`를 i18n 키 `t.nav.brandTagline`으로 추출
  (4개 언어 모두 `"SMART AQUACULTURE"` — 부제는 언어 무관 영문 고정).
- agri-ko 오버라이드: **`"SMART HYDROPONICS"`**.
- 스타일 무변: `text-[#1E40AF] text-[10px] font-mono tracking-[0.15em]`.

---

## 3. i18n — 신규 키와 `lib/i18n/agri-ko.ts` 초안

### 3-1. 규칙

- **신규 키**는 `lib/i18n/{ko,en,vi,id}.ts` 4파일 + `lib/i18n/types.ts` 전부 추가
  (하나라도 빠지면 타입 에러). en 문안은 아래 병기, vi/id는 en 문안 복사로 시작
  (농업 오버라이드 사전 자체가 후속 과제 — 설계서 4-2).
- **agri-ko.ts**는 `Partial<Dict>` 2단 구조. 농업 모드일 때만 2단 얕은 merge.
  아래 목록에 없는 키는 오버라이드하지 않는다 (기존 값 통과).

### 3-2. 본 사전(ko.ts) 신규 키 — 새우 모드에도 존재 (무해)

**`nav`에 추가**:

| 키 | ko | en |
|---|---|---|
| `brandTagline` | `SMART AQUACULTURE` | `SMART AQUACULTURE` |

**`onboarding`에 추가**:

| 키 | ko | en |
|---|---|---|
| `farmTypeLabel` | 무엇을 운영하시나요? | What do you run? |
| `farmTypeShrimp` | 새우 양식 | Shrimp farming |
| `farmTypeShrimpDesc` | 축제식·실내 양식장 수질 관리 | Pond & indoor farm water quality |
| `farmTypeAgri` | 수경재배 | Hydroponics |
| `farmTypeAgriDesc` | NFT 베드·양액 재순환 관리 | NFT beds & nutrient recirculation |

**`waterQualityX`에 추가** (유량·차압은 새우 장비가 보내도 표시돼야 하므로 본 사전):

| 키 | ko | en |
|---|---|---|
| `flowRate` | 유량 | Flow rate |
| `diffPressure` | 차압 | Diff. pressure |
| `flowCaption` | 순환 유량 (L/min) — 급락 시 펌프·배관 점검 | Circulation flow (L/min) |
| `diffPressureCaption` | 차압 (kPa) — 상승 시 UV 살균기·필터 막힘 의심 | Differential pressure (kPa) |
| `tabMore` | 더보기 | More |
| `tabLess` | 접기 | Less |
| `targetLabel` | 목표 | Target |

**신규 최상위 섹션 `agri`** (farm.farm_type 기준으로 쓰는 폼·카드 라벨 —
전역 모드와 무관하게 항상 본 사전에서 읽는다. types.ts에 섹션 추가):

```ts
agri: {
  // ── 베드 폼 (onboarding Step 2 + /farms 다이얼로그 공용) ──
  bedName: "베드 이름",                        // Bed name
  bedNamePlaceholder: "예: A동 1베드",          // e.g. House A – Bed 1
  bedType: "베드 유형",                        // Bed type
  bedVolume: "양액조 용량",                    // Nutrient tank volume
  bedVolumeHint: "1 ㎥ = 1,000 L",
  addBed: "베드 추가",                         // Add bed
  removeBed: "베드 삭제",                      // Remove bed
  // ── 레시피 ──
  recipeTitle: "양액 레시피",                   // Nutrient recipe
  recipeOptional: "(선택)",                    // (optional)
  recipeHint: "목표값을 벗어나면 알림을 보내드립니다.",  // We alert you when readings leave the target range.
  targetEc: "목표 EC",                         // Target EC
  targetEcUnit: "mS/cm",
  targetEcPlaceholder: "예: 1.8",
  ecTolerance: "EC 허용 오차",                  // EC tolerance
  ecTolerancePlaceholder: "예: 0.1",
  targetPh: "목표 pH",                         // Target pH
  targetPhPlaceholder: "예: 6.0",
  phTolerance: "pH 허용 오차",                  // pH tolerance
  toleranceDefaultNote: "허용 오차는 기본 ±0.1 mS/cm · pH ±0.5 로 설정됩니다.",
  recipeEditNote: "농장·기기 관리에서 언제든 바꿀 수 있습니다.",  // You can change this anytime in Farm & Devices.
  recipeNotSet: "레시피 미설정",                // No recipe set
  ecRangeError: "목표 EC는 0.1~10 mS/cm 범위로 입력해주세요.",
  ecToleranceRangeError: "EC 허용 오차는 0.01~2 mS/cm 범위로 입력해주세요.",
  phRangeError: "목표 pH는 3~9 범위로 입력해주세요.",
  phToleranceRangeError: "pH 허용 오차는 0.1~2 범위로 입력해주세요.",
  // ── 양액 상태 카드 ──
  nutrientTitle: "양액 상태",                   // Nutrient status
  currentStrength: "현재 농도",                 // Current strength
  verdictOk: "적정",                           // On target
  verdictLow: "농도 낮음",                      // Below target
  verdictHigh: "농도 높음",                     // Above target
  doseA: "A액",                                // Stock A
  doseB: "B액",                                // Stock B
  doseSuffix: "보충",                          // to add
  exchangePrefix: "양액",                      // Nutrient solution
  exchangeSuffix: "교환 권장",                  // exchange recommended
  noActionNeeded: "보충 불필요",                // No action needed
  uncalibratedBadge: "실측 교정 전 — 참고값",    // Not field-calibrated — reference only
  targetShort: "목표",                         // Target
},
```

### 3-3. `lib/i18n/agri-ko.ts` 오버라이드 전체 목록

실제 ko.ts 키 경로 그대로. **이 목록이 전부다** — 여기 없는 키는 넣지 않는다.

```ts
import type { Dict } from "./types"

// 수경재배(농업) 모드 한국어 오버라이드.
// 전역 UI 모드가 agriculture 인 사용자에게만 ko 위에 2단 merge 된다.
// 원칙: 수조→베드, 양식장→농장, 수질→양액/측정, 양식 일지→영농 일지.
export const agriKo: Partial<Dict> = {
  nav: {
    dashboard: "모니터링",
    waterQuality: "양액 관리",
    journal: "영농 일지",
    farms: "농장·기기 관리",
    brandTagline: "SMART HYDROPONICS",
  },
  record: {
    chooseTitle: "무엇을 기록할까요?",
    waterQuality: "측정 기록",
    journal: "영농 일지",
  },
  wizard: {
    selectTank: "베드를 선택하세요",
  },
  hub: {
    greeting: "안녕하세요, {{name}}님!",
    recordButton: "오늘 기록하기",
    monitorButton: "현황 보기",
  },
  homeHub: {
    greetingSubtitle: "오늘도 건강한 작물을 위해 시작해볼까요?",
    tanksToday: "오늘 베드 현황",
    noTanks: "등록된 베드가 없습니다.",
    noTanksAria: "베드 정보 없음",
    registerFarmAria: "농장 등록 시작하기",
    recordCardSubtitle: "측정값·영농 일지 입력",
    monitorCardSubtitle: "양액·알림·통계 확인",
    recordCardAria: "측정값·영농 일지 입력 페이지로 이동",
    monitorCardAria: "양액·알림·통계 모니터링으로 이동",
  },
  dashboard: {
    title: "모니터링",
    subtitle: "재배 시설 현황을 한눈에",
    activeFarms: "운영 농장",
    activeTanks: "가동 베드",
    addWaterQuality: "측정값 입력",
    goToFarms: "농장 등록하기",
    noFarmsTitle: "등록된 베드가 없습니다",
    noFarmsMsg: "측정 데이터가 없습니다. 양액 관리 페이지에서 데이터를 입력하세요.",
  },
  farms: {
    title: "농장·베드 관리",
    subtitle: "농장과 베드를 등록하고 관리하세요",
    addFarm: "농장 추가",
    editFarm: "농장 수정",
    deleteFarm: "농장 삭제",
    farmName: "농장 이름",
    farmNamePlaceholder: "예: 제1온실",
    addTank: "베드 추가",
    editTank: "베드 수정",
    deleteTank: "베드 삭제",
    tankName: "베드 이름",
    tankNamePlaceholder: "예: A동 1베드",
    tankVolume: "양액조 용량",
    tankCount: "개 베드",
    noFarms: "등록된 농장이 없습니다",
    noFarmsMsg: "농장을 추가하여 양액 관리를 시작하세요.",
    noTanks: "등록된 베드가 없습니다",
    noTanksMsg: "베드를 추가하여 양액 모니터링을 시작하세요.",
    deleteFarmConfirm: "이 농장과 모든 베드 데이터가 삭제됩니다. 계속하시겠습니까?",
    deleteTankConfirm: "이 베드와 모든 측정 기록이 삭제됩니다. 계속하시겠습니까?",
    farmLimitTitle: "농장 한도 초과",
    farmLimitMsg: "현재 플랜의 농장 최대 개수에 도달했습니다.",
    tankLimitTitle: "베드 한도 초과",
    tankLimitMsg: "현재 플랜의 베드 최대 개수에 도달했습니다.",
    selectFarm: "농장을 선택하세요",
    farmCreated: "농장이 추가되었습니다.",
    farmUpdated: "농장이 수정되었습니다.",
    farmDeleted: "농장이 삭제되었습니다.",
    tankCreated: "베드가 추가되었습니다.",
    tankUpdated: "베드가 수정되었습니다.",
    tankDeleted: "베드가 삭제되었습니다.",
  },
  waterQuality: {
    title: "양액 관리",
    subtitle: "베드별 양액 데이터를 기록하고 분석하세요",
    addRecord: "측정값 입력",
    editRecord: "측정값 수정",
    tank: "베드",
    selectTank: "베드를 선택하세요",
    temperature: "양액 온도",
    noTanks: "베드가 없습니다",
    noTanksMsg: "농장과 베드를 먼저 등록해야 측정 데이터를 입력하고 모니터링할 수 있습니다.",
    noData: "측정 데이터가 없습니다",
    noDataMsg: "이 베드의 측정 데이터가 아직 없습니다. 측정값을 입력해주세요.",
  },
  waterQualityX: {
    cycleDays: "재배일수",
    wholeTank: "베드 전체",
    tankSelectAria: "베드 선택",
    paramStatusTitle: "항목별 현재 양액 상태",
    csvFilePrefix: "양액데이터",
    noDataHint: "측정 데이터를 입력하거나 센서를 연결해 주세요.",
    noAlertsMsg: "미처리 알림이 없습니다 — 양액이 목표 범위에 있습니다.",
  },
  journal: {
    title: "영농 일지",
    subtitle: "양액 교환·방제·설비 점검 등 일상 관리 기록",
    tank: "베드",
    selectTank: "베드를 선택하세요",
    catFeeding: "양액 보충",
    catWaterChange: "양액 교환",
    catMedicine: "방제",
    catHarvest: "수확",
    catMaintenance: "설비 점검",
    noEntries: "일지 기록이 없습니다",
    noEntriesMsg: "양액 교환·방제·설비 점검 등 농장 작업을 기록하세요.",
  },
  farmsX: {
    tankNameRequired: "베드 이름을 입력해주세요.",
    farmTanksHeading: "{{name}} 베드",
    tankStatusAria: "베드 상태",
    statusAutoNote: "측정 데이터 저장 시 자동 갱신됩니다",
  },
  onboarding: {
    title: "재배 시설 초기 설정",
    subtitle: "농장과 베드 정보를 등록하면 모든 기능을 즉시 사용할 수 있습니다.",
    step1Title: "농장 정보",
    step1Subtitle: "기본 농장 정보를 입력해주세요",
    step2Title: "베드 등록",
    step2Subtitle: "농장의 베드 정보를 입력해주세요 (최소 1개)",
    step3Subtitle: "등록이 완료되었습니다! 등록한 베드 수:",
    farmName: "농장 이름",
    farmNamePlaceholder: "예: 제1온실",
    tankName: "베드 이름",
    tankNamePlaceholder: "예: A동 1베드",
    addMoreTank: "베드 추가",
    removeTank: "베드 삭제",
  },
}
```

주의 두 가지:
1. `Partial<Dict>` 이므로 섹션 안 일부 키만 있어도 되는지 타입 확인 —
   섹션 값 타입이 통짜 객체라면 `{ [K in keyof Dict]?: Partial<Dict[K]> }`
   (DeepPartial 2단) 타입 별칭을 types.ts에 추가한다.
2. `step3Subtitle`은 현재 페이지가 뒤에 수조 수를 붙이는 구조 — 기존 ko 원문
   형식을 그대로 따를 것 (원문: "등록이 완료되었습니다!" + 별도 조립. 위 문안은
   ko.ts 원문 구조 확인 후 형식을 맞춰 조정).

---

## 4. 양액 상태 카드 (`components/sensors/nutrient-status-card.tsx` 신규)

### 4-1. 배치와 노출 조건

- `app/(dashboard)/dashboard/page.tsx` — `<DeviceCurrentValues />`(387행) **바로 위**.
  "지금 뭘 해야 하나"가 원시 수치보다 먼저 온다.
- 렌더 조건: 농업 UI 모드 **그리고** 활성 기기의 `last_payload`에 `nut_percent`가
  숫자로 존재. 조건 미충족이면 `null` (새우 모드 diff 없음).
- 기기 여러 대면 기기당 1행 (DeviceCurrentValues와 같은 그리드 결).

### 4-2. 레이아웃

```
┌─ ⚗ 양액 상태 · A동 1베드 센서        [실측 교정 전 — 참고값] ─┐
│                                                              │
│   87 %          ● 농도 낮음        목표 1.80 mS/cm            │
│   현재 농도                         (허용 ±0.10)              │
│  ─────────────────────────────────────────────────────────   │
│   처방 : A액 320 mL · B액 320 mL 보충                         │
│   업데이트 : 3분 전                                           │
└──────────────────────────────────────────────────────────────┘
```

마크업 스케치:

```tsx
<Card className="bg-card border-border">
  <CardContent className="p-4">
    <div className="flex items-center justify-between gap-2 mb-3">
      <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
        <FlaskConical className="w-3.5 h-3.5 text-ocean-600" aria-hidden="true" />
        {t.agri.nutrientTitle} · {dev.name}
      </p>
      {payload.nut_calibrated === false && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 shrink-0">
          {t.agri.uncalibratedBadge}
        </span>
      )}
    </div>
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
      <div>
        <p className="text-3xl font-bold text-foreground tabular-nums">{nut_percent}<span className="text-base font-semibold text-muted-foreground ml-0.5">%</span></p>
        <p className="text-xs text-muted-foreground">{t.agri.currentStrength}</p>
      </div>
      <VerdictBadge verdict={nut_verdict} />
      <div className="text-sm text-muted-foreground tabular-nums">
        {t.agri.targetShort} <span className="text-foreground font-semibold">{(nut_target_ec / 1000).toFixed(2)}</span> mS/cm
      </div>
    </div>
    <div className="mt-3 pt-3 border-t border-border text-sm tabular-nums">
      {/* 처방 행 — verdict 별 아래 표 */}
    </div>
  </CardContent>
</Card>
```

### 4-3. verdict 별 색·처방 문안 (설계서 확정: ok=녹색, low/high=주황)

| verdict | 배지 | 처방 행 |
|---|---|---|
| `ok` | `bg-emerald-500/10 text-emerald-600 border-emerald-500/25` · 텍스트 "적정" | "보충 불필요" (`text-muted-foreground`) |
| `low` | `bg-amber-500/10 text-amber-600 border-amber-500/25` · "농도 낮음" | "A액 **{nut_dose_a_ml} mL** · B액 **{nut_dose_b_ml} mL** 보충" — 수치 `text-foreground font-semibold` |
| `high` | 같은 amber · "농도 높음" | "양액 **{nut_exchange_l} L** 교환 권장" |

- 배지 형태: `text-xs font-semibold px-2 py-0.5 rounded-full border` + 앞에 6px 점
  (`●`, 같은 색) — 대시보드 정상/주의 배지 결.
- `nut_target_ec`는 µS/cm로 수신 → 표시 시 `/1000` 후 `toFixed(2)` mS/cm.
- 허용 오차 병기: 해당 베드 tank의 `ec_tolerance`를 알 수 있으면
  "(허용 ±0.10)"을 목표 옆에 작은 글씨(`text-xs text-muted-foreground`)로. 모르면 생략.
- 업데이트 시각: `dev.last_seen_at` → device-current-values의 `seenLabel` 패턴 재사용
  (`t.time.*`). payload가 오래됐어도(예: 1시간↑) 카드 자체는 그대로, 시각 표기가 알려준다.

---

## 5. `/water-quality` 농업판 (`app/(dashboard)/water-quality/page.tsx`)

### 5-1. 탭 구성 (1056~1070행)

농업 모드일 때 탭을 **교체**한다 (새우 모드는 기존 배열 그대로):

| 순서 | value | 라벨 | 비고 |
|---|---|---|---|
| 1 (기본) | `conductivity` | **EC** | 데이터가 없어도 항상 노출 (기존 `hasConductivity` 조건 무시) |
| 2 | `ph` | pH | |
| 3 | `temperature` | 양액 온도 | 라벨은 waterQuality.temperature 오버라이드가 처리 |
| 4 | `do_level` | DO | |
| 5 | `flow_rate` | 유량 | 신규 |
| 6 | `diff_pressure` | 차압 | 신규 |
| 7 | 토글 | 더보기 ▾ / 접기 ▴ | 아래 |

- 기본 탭: `useState(chartTab)` 초기값을 농업 모드면 `"conductivity"`, 아니면
  `"overview"` — `useState(() => isAgriMode ? "conductivity" : "overview")`.
- **새우 지표 접기**: 탭 리스트 끝에 텍스트 버튼 "더보기 ▾" (`t.waterQualityX.tabMore`,
  TabsTrigger가 아닌 일반 button, `text-xs text-muted-foreground hover:text-foreground
  px-2`). 누르면 `showAllTabs` state로 overview·질소 복합·염도·암모니아·아질산염·
  질산염·알칼리도·탁도 탭이 뒤에 이어서 노출되고 버튼이 "접기 ▴"로 바뀐다.
  접을 때 현재 탭이 접히는 탭이면 `conductivity`로 복귀시킨다.
- 스타일: 기존 TabsTrigger 클래스 문자열 그대로
  (`data-[state=active]:bg-ocean-600 data-[state=active]:text-white`).

### 5-2. EC 차트 — 목표선 + 허용밴드 (314~336행 ConductivityChart)

레시피(`tank.target_ec != null`)가 있는 베드 + 농업 모드일 때만 그린다.
없으면 기존 그대로 (선 없음 — "전역 기준선 없음" 원칙 유지).

```tsx
// target, tol 은 µS/cm (예: 1800, 100). Y축이 µS/cm 이므로 환산 없이 그대로.
<ReferenceArea y1={target - tol} y2={target + tol}
  fill="#34d399" fillOpacity={0.08} stroke="none" ifOverflow="extendDomain" />
<ReferenceLine y={target} stroke="#34d399" strokeDasharray="6 3" strokeOpacity={0.9}
  label={{ value: `${t.waterQualityX.targetLabel} ${(target / 1000).toFixed(2)}`,
           fill: "#34d399", fontSize: refFs, position: "insideTopRight" }} />
<ReferenceLine y={target + tol} stroke="#34d399" strokeDasharray="4 4" strokeOpacity={0.5} />
<ReferenceLine y={target - tol} stroke="#34d399" strokeDasharray="4 4" strokeOpacity={0.5} />
```

- 색 원칙: **정상 범위 = emerald `#34d399`** (기존 std.min/max 선과 동일 색·동일
  점선 패턴 → 사용자가 이미 아는 문법). 목표선만 dash `6 3`으로 굵기감 차등.
  amber `#fbbf24` 는 여기서 쓰지 않는다 — 2×tol 경계선까지 그리면 5줄이 되어 과밀.
  이탈 시각화는 알림(4-4 설계서)과 상태 배지가 담당한다.
- 밴드: `ReferenceArea` emerald 8% — 배경 침범이 적고 라이트/다크 모두 안전.
- 라벨은 **mS/cm 환산값**("목표 1.80"), y좌표는 µS/cm 그대로. `Recharts`의
  `ReferenceArea`는 이 파일에서 첫 사용이므로 import 추가 필요.
- 툴팁 formatter를 농업 모드에서 `[
  `${v} µS/cm (${(v / 1000).toFixed(2)} mS/cm)`, "EC"]` 로 병기.
- 기존 캡션(`conductivityCaption` — 환산 안내)은 유지.

### 5-3. pH 차트 목표선

pH 탭은 std 기반 `GenericChart`(280~284행의 ReferenceLine 4종)를 쓴다.
농업 모드 + `tank.target_ph != null` 이면:
- **std 기준선 4종(새우 해수 기준)을 숨기고** 레시피 선으로 대체 — 5-2와 동일 패턴
  (밴드 `target_ph ± ph_tolerance`, 목표선 라벨 "목표 6.0").
- 레시피 없으면: 농업 모드라도 std 선을 **그냥 숨긴다** (새우 기준선을 농가에
  보여주는 오탐 방지). 새우 모드는 무변.
- 구현: GenericChart에 `recipe?: { target: number; tol: number } | null`과
  `hideStd?: boolean` prop 추가 정도로 국소 처리.

### 5-4. 유량·차압 차트 (신규 탭 2종)

- ConductivityChart와 동일한 단일 라인 패턴 (기준선 없음, `connectNulls`).
- 색: 유량 `#6366f1`(indigo-500), 차압 `#f43f5e`(rose-500) — 기존 파라미터 색
  (sky/teal/violet/amber/orange/pink/lime/cyan)과 겹치지 않는 값.
- 단위: 유량 `L/min`, 차압 `kPa` (툴팁 formatter).
- 캡션: `t.waterQualityX.flowCaption` / `diffPressureCaption` — 수치 해석 힌트 포함
  ("급락 시 펌프·배관 점검" / "상승 시 UV 살균기·필터 막힘 의심").
- 빈 상태는 기존 결 그대로 (`Waves` 아이콘 + noChartData).

### 5-5. 기타 라벨

- 베드 선택 셀렉트·"수조 전체"·CSV 파일명·상단 요약 카드 라벨은 전부 3-3의
  agri-ko 오버라이드가 처리 — 코드 수정 없음.
- 상단 요약의 사육일수/입식수/밀도 값은 농업 베드에서 0 — 1단계에서는 그대로 두고
  (cycleDays만 "재배일수"로 오버라이드), 숨김 처리는 후속.
- `device-current-values.tsx`의 `payloadLabels`에 추가 (새우 모드 무해 — 장비가
  안 보내면 안 보임):

```ts
flow_rate:     { label: t.waterQualityX.flowRate, unit: "L/min" },
diff_pressure: { label: t.waterQualityX.diffPressure, unit: "kPa" },
```

---

## 6. `/farms` 베드 폼 레시피 입력 (`app/(dashboard)/farms/page.tsx`)

### 6-1. 농장 폼 (AddFarmDialog 115행~ / EditFarmDialog 476행~)

- "농장 이름" 라벨 아래(첫 필드 위)에 1-1과 같은 **유형 2택 카드**를 축소형으로 추가
  — 온보딩 카드와 동일 마크업, 설명 줄 포함, `aria-pressed`. 라벨 `t.onboarding.farmTypeLabel` 재사용.
- Add: 기본 shrimp. Edit: 현재 값 표시, 변경 가능 (기존 계정 전환 경로 — 설계서 3장).
- Edit에서 유형을 바꾸면 안내 문구 한 줄 (`text-xs text-muted-foreground`):
  "유형을 바꾸면 메뉴와 용어가 해당 유형에 맞게 바뀝니다." → 신규 키
  `agri.farmTypeChangeNote` (본 사전 `agri` 섹션에 추가, en: "Changing the type
  switches menus and terms to match.").

### 6-2. 베드 폼 (AddTankDialog 277행~ / EditTankDialog — 같은 구성)

`farm.farm_type === "agriculture"` 일 때 (전역 모드 아님 — 0장 참조):

| 기존 필드 | 처리 |
|---|---|
| 수조 이름 | 라벨 `t.agri.bedName`, placeholder `t.agri.bedNamePlaceholder` |
| 유형 3버튼 (노지/실내/반실내) | 유지, 라벨 `t.agri.bedType`, Add 기본값 "실내" |
| 용량 (㎥) * | 라벨 `t.agri.bedVolume` + "(㎥, 선택)" — **required 해제**, `min=0.1 step=0.1`, placeholder "예: 1", 헬퍼 `t.agri.bedVolumeHint` ("1 ㎥ = 1,000 L") `text-xs text-muted-foreground` |
| 입식 밀도 * | **숨김** (저장 0) |
| 입식일 / 예정 출하일 | **숨김** (저장 null) |
| — | **레시피 섹션 추가** (아래) |

**레시피 섹션** — 다이얼로그 하단, DialogFooter 위:

```
──────────────────────────────────────────────
⚗ 양액 레시피 (선택)
목표값을 벗어나면 알림을 보내드립니다.

┌ 목표 EC (mS/cm) ──┐  ┌ EC 허용 오차 (± mS/cm) ┐
│ 예: 1.8           │  │ 0.1                     │
└───────────────────┘  └─────────────────────────┘
┌ 목표 pH ──────────┐  ┌ pH 허용 오차 (±) ───────┐
│ 예: 6.0           │  │ 0.5                     │
└───────────────────┘  └─────────────────────────┘
```

- 구분: `border-t border-border pt-4 mt-1`, 소제목 `FlaskConical` 16px ocean-600 +
  `text-sm font-semibold text-foreground` + `(선택)` `text-xs text-muted-foreground`,
  힌트 `text-xs text-muted-foreground`.
- 2열 그리드 `grid grid-cols-2 gap-3` (다이얼로그 max-w-md 안에서 안전).
- 필드 사양 (Input 공통 클래스는 기존 폼 그대로:
  `bg-muted border-border ... focus-visible:ring-ocean-500/50`):

| 필드 | id | type/step | 범위 | 기본값 | 저장 |
|---|---|---|---|---|---|
| 목표 EC | `recipe-ec` | number / 0.1 | 0.1~10 | 빈칸 (Edit: `target_ec/1000`) | `×1000` µS/cm, 빈칸→NULL |
| EC 허용 오차 | `recipe-ec-tol` | number / 0.05 | 0.01~2 | **0.1 미리 채움** (Edit: `ec_tolerance/1000`) | `×1000` µS/cm |
| 목표 pH | `recipe-ph` | number / 0.1 | 3~9 | 빈칸 | 그대로, 빈칸→NULL |
| pH 허용 오차 | `recipe-ph-tol` | number / 0.1 | 0.1~2 | **0.5 미리 채움** | 그대로 |

- 활성화 규칙: 목표 EC가 비면 EC 오차 입력 `disabled` (+ `opacity-50`).
  pH도 동일. 목표를 지우면 오차는 무시되고 NULL 저장(오차 컬럼은 DEFAULT 유지).
- 검증 (submit 시, 값이 있을 때만) — 기존 에러 박스(`text-red-500 bg-red-500/10 …`)에 표시:
  - EC 범위 밖 → `t.agri.ecRangeError` "목표 EC는 0.1~10 mS/cm 범위로 입력해주세요."
  - EC 오차 범위 밖 → `t.agri.ecToleranceRangeError`
  - pH 범위 밖 → `t.agri.phRangeError` "목표 pH는 3~9 범위로 입력해주세요."
  - pH 오차 범위 밖 → `t.agri.phToleranceRangeError`
- 베드 카드 목록(farmTanksHeading 아래 타일)에 레시피 요약 한 줄 추가(농업 farm만):
  `⚗ EC 1.80 ±0.10 · pH 6.0 ±0.5` (`text-xs text-muted-foreground tabular-nums`),
  미설정이면 `t.agri.recipeNotSet` "레시피 미설정".
- 새우 farm의 폼은 **분기 코드가 아예 타지 않게** 한다 (조건부 렌더 추가만,
  기존 JSX는 건드리지 않는 방향으로).

---

## 7. 서연 구현 체크리스트 (UI 관점 요약)

1. i18n: 신규 키(3-2)를 **ko/en/vi/id 4파일 + types.ts** 전부. `agri` 신규 섹션.
   DeepPartial 2단 타입으로 agri-ko 정의. merge는 농업 모드에서만.
2. 라벨 분기 축 혼동 금지: 폼 내부(`agri` 섹션)는 `farm.farm_type`,
   화면 전반은 전역 모드(i18n merge). 온보딩은 로컬 state로 merge.
3. 메뉴는 배열 복제 말고 `AGRI_HIDDEN` 필터. 로고 부제는 `t.nav.brandTagline`으로
   추출부터 (새우 모드 문자열 결과 동일 확인).
4. EC 입력·표시는 mS/cm, 저장·차트 y좌표는 µS/cm — 환산 지점은
   폼 저장(×1000)·목표선 라벨(÷1000)·양액 카드(÷1000) 세 곳뿐.
5. `chartTab` 초기값 분기, 접기 토글 시 현재 탭 유실 처리(conductivity 복귀).
6. Recharts `ReferenceArea` import 추가. 새우 모드에서 GenericChart 렌더 결과가
   완전 동일한지(스냅샷 수준) 확인.
7. 이 저장소는 Next.js 16.2.4 — 전부 기존 클라이언트 컴포넌트 수정이라 신규
   서버/클라이언트 경계는 없지만, 라우트 구조를 만지게 되면
   `node_modules/next/dist/docs/` 먼저.
