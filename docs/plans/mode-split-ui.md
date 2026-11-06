# 모드 분리 UI 시안 (수아) — 스마트팜 전용 화면 8종 + 전환 스위치

- 작성: 수아 (디자이너)
- 작성일: 2026-10-15
- 상위 문서: `docs/plans/mode-split.md` (민준, 2026-10-15) — 5장·3장의 "수아 시안이 상세 확정" 부분
- 선행 시안: `docs/plans/agriculture-mode-ui.md` (2026-08-18) — **"공유 뷰에 분기 추가" 전제라 이번 문서로 대체된다.** 그 문서의 레시피 폼 사양(§6-2)·양액 상태 카드(§4)만 그대로 유효하다. 여기서 다시 적지 않은 수치는 그쪽을 따른다.
- 대상 독자: 서연-1(1단계 기반), 서연-2(2A), 서연-3(2B), 서연-4(2C). **이 문서만 보고 서로 상의 없이 구현할 수 있어야 한다.** 각 장 끝에 담당을 적어 두었다.

## 0. 이 문서를 읽는 법

| 장 | 내용 | 주 독자 |
|---|---|---|
| 1 | 공통 원칙 — 색·타이포·상태·아이콘·모션·접근성 | 전원 |
| 2 | 전환 스위치 `ModeSwitch` 3곳 | 서연-1 |
| 3 | 공통 조각 4종의 API와 사용 규칙 | 서연-1(제작) / 2A·2B·2C(사용) |
| 4 | 모든 농업 페이지가 공유하는 골격 — 로딩·에러·빈 상태 | 2A·2B·2C |
| 5 | 화면 8종 — ASCII 스케치, 구역별 컴포넌트, 빈/로딩/에러, 320px | 5-1~5-5 → 2A, 5-6~5-7 → 2B, 5-8 → 2C |
| 6 | 사전 키 초안 ko·en (섹션별) | 2A·2B·2C(+1단계 common/nav 제안) |
| 7 | 다크 모드 대비 메모 | 서연-1, 태양 |
| 8 | 담당별 체크리스트 | 전원 |

용어: 이 문서에서 **"베드"는 데이터 모델의 `Tank`**, **"농장"은 `Farm`**, **"측정"은 `WaterQualityReading`**, **"영농 일지"는 `JournalEntry`**다. 코드 식별자는 그대로 두고 화면 라벨만 농업 사전을 쓴다(설계서 5장).

---

## 1. 공통 원칙

### 1-1. 색 — 토큰 셋만 쓴다

| 역할 | 클래스 | 값(농업 모드) | 쓰는 곳 |
|---|---|---|---|
| 강조 | `bg-brand` `text-brand` `border-brand` `bg-brand/10` `border-brand/25` | `#15803D` (hover `bg-brand-hover` `#16A34A`) | CTA 버튼, 활성 세그먼트·탭·칩, 섹션 아이콘, 링크 |
| 정상 | `emerald-*` | 기존 | 상태 배지·타일·목표 밴드(`#34d399`) |
| 주의 | `amber-*` | 기존 | 상태 배지·타일·배너 |
| 위험 | `red-*` | 기존 | 상태 배지·타일·배너·삭제 |
| 중립(미측정·기준 없음) | `bg-muted border-border text-muted-foreground` | 기존 | `BedStatusBadge`, 값 없는 타일 |
| 차트 계열 | `AGRI_PARAMS[].color` | sky/violet/amber/teal/indigo/rose (설계서 5-1) | 추세선·스파크라인·비교 차트 **선 색만** |

**농업 뷰 안에서 `ocean-*` 클래스를 쓰지 않는다.** 기존 농업 분기(`text-ocean-600` 플라스크 아이콘, `bg-ocean-600` 활성 탭 등)는 전부 `brand`로 바꿔 적는다. 기존 `ocean-*`가 보이면 복붙 흔적이다(설계서 9장 "공유 뷰 복사 금지").

**새 색 금지.** 위 표 밖의 색 이름(`green-*`, `lime-*`, `purple-*`, hex 리터럴)이 농업 뷰에 등장하면 리뷰에서 돌려보낸다. 예외는 `AGRI_PARAMS[].color`(차트 선)와 레시피 밴드 `#34d399`(emerald-400, 기존 관례) 둘뿐.

### 1-2. 타이포·수치

- 본문 `text-sm`, 보조 `text-xs`, 캡션 `text-[11px]` 이하 금지(배지 안 `text-[10px]`은 기존 결이라 허용).
- **숫자는 전부 `tabular-nums`.** 큰 수치(타일·카드 헤드라인)는 `font-bold tabular-nums`, 홈 요약 숫자는 기존처럼 `font-mono tabular-nums`.
- 단위는 숫자 뒤 `text-muted-foreground font-medium`로 한 톤 낮춘다. EC `mS/cm`, pH 단위 없음, 온도 `°C`, DO `ppm`, 유량 `L/min`, 차압 `kPa`. **µS/cm 는 농업 화면에 등장하지 않는다**(DB 단위일 뿐).
- 소수 자리는 `AGRI_PARAMS[].digits`가 정한다(EC·pH 2자리, 나머지 1자리). 손으로 `toFixed` 하지 말고 `agriFormat()`.

### 1-3. 상태 표현 — 5단계, 색+텍스트 병기

`AgriStatusLevel` = 정상 / 주의 / 위험 / 미측정 / 기준없음 (`lib/agri-standards.ts`). 표현 규칙:

| 레벨 | 점 | 텍스트 | pulse |
|---|---|---|---|
| 정상 | `bg-emerald-500` | `text-emerald-600 dark:text-emerald-400` | 없음 |
| 주의 | `bg-amber-500` | `text-amber-600 dark:text-amber-400` | 있음 |
| 위험 | `bg-red-500` | `text-red-600 dark:text-red-400` | 있음 |
| 미측정 | 속 빈 원 | `text-muted-foreground` | 없음 |
| 기준없음 | 속 빈 원 | `text-muted-foreground` | 없음 |

- **색만으로 뜻을 전하지 않는다.** 점 옆에 항상 상태 텍스트. 타일에서는 3번째 줄.
- `tank.status`(DB의 active/warning/danger/inactive)는 `BedStatusBadge`가 `AgriStatusLevel`로 번역해 쓴다(3-1).
- 판정 숫자는 어디에도 손으로 적지 않는다. `getAgriStatus()` 한 곳.

### 1-4. 아이콘 — lucide-react만

| 뜻 | 아이콘 | 뜻 | 아이콘 |
|---|---|---|---|
| 수경재배·베드·정식 | `Sprout` | 레시피·양액 | `FlaskConical` |
| EC | `Zap` | pH | `Droplets` |
| 양액 온도 | `ThermometerSun` | DO | `Wind` |
| 유량 | `Waves` | 차압 | `Gauge` |
| 농장 | `Building2` | 기기 | `Cpu` |
| 측정 기록 | `ClipboardList` | 영농 일지 | `BookOpen` |
| 모니터링 | `LayoutDashboard` | 알림 | `AlertTriangle` / `Bell` |
| 수확 예정 | `Calendar` | 재배일수 | `TrendingUp` |
| 전체화면 | `Maximize2` / 닫기 `X` | CSV | `Download` |

`Waves`는 유량과 양식장 모드 스위치에 함께 쓰인다 — 같은 화면에 둘이 동시에 뜨는 곳은 헤더(스위치)와 양액 관리 탭(유량)인데 거리가 멀어 혼동 없음. 아이콘 단독 버튼은 반드시 `aria-label`.

### 1-5. 터치·모션·접근성

- 누르는 것은 전부 `min-h-[44px]`(헤더 스위치만 예외 — 2-1 근거 참조). 아이콘 전용 버튼은 `w-11 h-11` 또는 `p-2 min-w-[44px] min-h-[44px]`.
- 전환은 `transition-colors duration-200`. 레이아웃 속성(width·height) 애니메이션 금지. `motion-reduce:transition-none` 을 pulse·슬라이드에 붙인다(`animate-pulse` → `motion-reduce:animate-none`).
- 상태 영역 `role="status"`, 에러 `role="alert"`, 토글 `aria-pressed`, 그룹 `role="group" aria-label`.
- 폼 검증은 blur 또는 제출 시(키 입력마다 아님). 에러는 **필드 바로 아래** `text-xs text-red-600 dark:text-red-400` + 원인·조치("EC는 0.1~10 mS/cm 범위로 입력해 주세요").

### 1-6. 농업 어휘 원칙 (사전·코드 주석 모두)

수조→베드, 양식장→농장, 수질→양액/측정, 입식→정식, 사육일수→재배일수, 양식 일지→영농 일지.
**등장 금지 어휘**: 염도·암모니아·아질산염·질산염·알칼리도·탁도·입식 밀도·새우 수·폐사·급이·사료·비브리오. `rg` 체크 대상(설계서 10장 5).

---

## 2. 전환 스위치 `components/layout/mode-switch.tsx` (서연-1)

### 2-1. 공통 구조

```
┌──────────────────────────────┐
│ ┌────────────┐┌────────────┐ │   container: inline-flex rounded-xl border border-border bg-muted p-1
│ │ 〰 양식장    ││ 🌱 스마트팜 │ │   segment : button, role 없음(aria-pressed 로 상태), 라벨 항상 노출
│ └────────────┘└────────────┘ │   active  : bg-brand text-white shadow-sm
└──────────────────────────────┘   inactive: text-muted-foreground hover:text-foreground hover:bg-accent
```

```tsx
<div role="group" aria-label={d.common.modeGroupAria} className={cn(base, sizeCls[size], className)}>
  {(["shrimp", "agriculture"] as UiMode[]).map(mode => {
    const active = current === mode
    const Icon = mode === "shrimp" ? Waves : Sprout
    return (
      <button key={mode} type="button" aria-pressed={active} disabled={pending}
        onClick={() => onPick(mode)}
        className={cn("inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg font-semibold",
          "transition-colors duration-200 motion-reduce:transition-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          segCls[size],
          active ? "bg-brand text-white shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-accent",
          pending && "opacity-70 pointer-events-none")}>
        <Icon className={iconCls[size]} aria-hidden="true" />
        <span>{mode === "shrimp" ? d.common.modeShrimp : d.common.modeAgri}</span>
      </button>
    )
  })}
</div>
```

| 크기 | 컨테이너 | 세그먼트 | 아이콘 | 글자 | 쓰는 곳 |
|---|---|---|---|---|---|
| `sm` | `h-9 p-0.5 rounded-lg` | `h-8 px-2.5 rounded-md` | `w-4 h-4` | `text-xs` | 헤더 |
| `lg` | `h-[52px] p-1 rounded-xl w-full` | `min-h-[44px] px-4 rounded-lg flex-1` | `w-[18px] h-[18px]` | `text-sm` | 더보기 시트, 설정 패널 |

- **활성 = URL** (`useUiMode().current`). `saved`가 아니다(설계서 2장).
- **눌렀을 때 규칙** (3곳 동일):
  1. `mode !== current` → `switchTo(mode)` (저장 + `router.push(counterpartHref)`). 저장 실패해도 이동.
  2. `mode === current && saved !== mode` → 저장만 하고 이동 안 함. 설정 패널에서는 아래 한 줄 `text-xs text-emerald-600` "기본 화면으로 저장했습니다"를 2초 띄움(다른 두 곳은 조용히 저장).
  3. `mode === current && saved === mode` → 아무 일 없음.
- `pending` 동안 두 칸 `disabled` + `opacity-70`. 스피너는 넣지 않는다(이동이 300ms 안에 끝난다 — 화면 전환 자체가 피드백).
- 활성 칸은 hover 변화 없음(이미 눌린 상태라는 뜻). `bg-brand-hover`는 **CTA 버튼용**이고 스위치에는 쓰지 않는다 — 7장 대비 수치 참조.
- 헤더 `sm` 세그먼트가 32px인 이유: 헤더는 `sm`(640px) 이상에서만 보이고 이웃한 검색·알림 버튼이 `w-9 h-9`(36px)다. 같은 줄에서 홀로 44px이면 들쭉날쭉하다. 모바일(터치 주력)에서는 헤더 스위치가 숨고 더보기 시트의 44px 버전이 대신한다 — 44px 규칙은 그쪽에서 지킨다.

### 2-2. 위치별 배치

**(a) 헤더** `components/layout/header.tsx` — 우측 클러스터의 **맨 왼쪽**, 검색 버튼 앞.

```
[ 로고 ] 페이지 제목           ┌〰 양식장│🌱 스마트팜┐  [🔍 ⌘K]  [🔔]
         2026년 10월 15일 (수)  └──────────────────┘
```

- `<ModeSwitch size="sm" className="hidden sm:inline-flex mr-1" />`.
- 제목 영역이 `min-w-0 flex-1 truncate`라 스위치가 들어와도 줄바꿈 없음. 640~768px에서 제목이 더 잘리는 것은 허용.

**(b) 더보기 시트** `components/layout/bottom-nav.tsx` — 프로필 행 **바로 아래**, 메뉴 목록 위.

```
┌────────────────────────────────────────┐
│                 ━━━                    │
│  (U)  김농부                 [FREE]     │  프로필 행 (기존)
│       kjs@…                            │
│  ┌──────────────────────────────────┐  │
│  │  〰 양식장      │  🌱 스마트팜 ●   │  │  ← ModeSwitch size="lg", px-5 안쪽
│  └──────────────────────────────────┘  │
│  ──────────────────────────────────    │
│  ▣ 양액 관리                        ›  │  MORE 목록 (기존)
│  …                                     │
└────────────────────────────────────────┘
```

- 감싸는 div: `px-5 pb-3`. 아래에 `border-t border-border` 하나 더 두어 메뉴와 분리.
- 누르면 `setMoreOpen(false)` 후 `switchTo`. 시트가 닫히며 새 화면이 뜬다.

**(c) 설정 패널** `components/layout/settings-panel.tsx` — 계정 탭 **맨 위**, "표시 이름" 폼 앞.

```
┌─ 계정 ─────────────────────────────────┐
│  ⇄ 기본 화면                            │  <ArrowLeftRight/> w-4 h-4 text-muted-foreground + text-sm font-medium (기존 섹션 헤더 결)
│  ┌──────────────────────────────────┐  │
│  │  〰 양식장      │  🌱 스마트팜 ●   │  │  ModeSwitch size="lg"
│  └──────────────────────────────────┘  │
│  로그인하면 이 화면으로 시작합니다.       │  text-xs text-muted-foreground
│  ✓ 기본 화면으로 저장했습니다.           │  (2-1 규칙 2 일 때만, 2초)
│  ────────────────────────────────────  │
│  👤 표시 이름 …                         │  기존
└────────────────────────────────────────┘
```

- 섹션 아이콘은 `ArrowLeftRight`(lucide). 라벨 `d.common.defaultScreenLabel`, 설명 `d.common.defaultScreenDesc`, 저장 확인 `d.common.defaultScreenSaved`.
- 설정 패널은 `data-mode` 하위에 렌더되므로 `bg-brand`가 현재 화면 색을 따른다 — 의도된 동작.

### 2-3. 접근성 체크

- `role="group" aria-label="화면 모드 전환"`; 각 칸 `aria-pressed`; 라벨 텍스트 상시 노출(아이콘 전용 금지).
- 키보드: Tab 으로 각 칸 진입, Space/Enter 로 전환. 포커스 링 `ring-brand`.
- 스크린리더 읽기: "양식장, 토글 버튼, 눌림" / "스마트팜, 토글 버튼, 안 눌림".

---

## 3. 공통 조각 사용법 (서연-1 제작, 2A·2B·2C 사용)

### 3-1. `components/agri/bed-status-badge.tsx`

```tsx
<BedStatusBadge level={AgriStatusLevel} size?="sm" | "md" />
<BedStatusBadge fromTank={tank} />   // tank.status → level 변환 포함
```

| `tank.status` | level |
|---|---|
| `active` | 정상 |
| `warning` | 주의 |
| `danger` | 위험 |
| `inactive` | 미측정 |

- 마크업: `inline-flex items-center gap-1.5 rounded-full border font-semibold ${AGRI_STATUS_STYLES[level].bg} ${…text}` + 점 `w-1.5 h-1.5 rounded-full ${dot}` (주의·위험만 `animate-pulse motion-reduce:animate-none`) + 텍스트.
- `sm`: `text-[11px] px-2 py-0.5`. `md`: `text-xs px-2.5 py-1`.
- 텍스트는 `d.common.statusNormal / statusWarning / statusDanger / statusNotMeasured / statusNoStandard`.
- `aria-label={`${d.common.bedStatusAria}: ${text}`}`.
- 쓰는 곳: 홈 요약(안 씀 — 숫자 타일), 대시보드 베드 카드 우상단, 양액 관리 상태 스트립·최신값 카드, 농장 베드 카드 우상단.

### 3-2. `components/agri/agri-page-header.tsx`

```tsx
<AgriPageHeader icon={LayoutDashboard} title={d.dashboard.title} subtitle={d.dashboard.subtitle}
  actions={<><Button …/><AddFarmDialog …/></>} />
```

```
┌──────────────────────────────────────────────────────────────┐
│ ▣ 모니터링                                   [액션1] [액션2]  │  h1 text-xl font-bold, 아이콘 w-5 h-5 text-brand
│   재배 시설 현황을 한눈에                                      │  text-sm text-muted-foreground mt-0.5
└──────────────────────────────────────────────────────────────┘
```

- 루트 `flex items-start justify-between gap-3 flex-wrap`. 320px에서는 액션이 아래 줄로 내려오며 `w-full` 로 펴진다(`actions` 래퍼 `flex items-center gap-2 w-full sm:w-auto`, 버튼은 `flex-1 sm:flex-none`).
- 홈과 기록 허브는 **이 헤더를 쓰지 않는다**(가운데 정렬 인사·제목이 화면 자체). 나머지 6개 페이지는 전부 이 헤더로 시작한다.

### 3-3. `components/agri/agri-empty-state.tsx`

```tsx
<AgriEmptyState icon={Sprout} title="…" description="…"
  cta={{ label: d.common.registerFarmCta, href: "/daumlabs/farms" }}   // 또는 onClick
  tone?="default" | "error" />
```

```
┌─────────────────────────────┐
│        ┌──────┐             │  w-16 h-16 rounded-2xl bg-brand/10, 아이콘 w-8 h-8 text-brand
│        │  🌱  │             │  (tone=error: bg-amber-500/10 + text-amber-600 + 아이콘 AlertTriangle)
│        └──────┘             │
│    등록된 베드가 없습니다       │  text-lg font-bold
│  농장과 베드를 먼저 등록해 …    │  text-sm text-muted-foreground max-w-xs text-center
│      [ 농장 등록하기 ]        │  Button bg-brand hover:bg-brand-hover text-white min-h-[44px] px-6 rounded-xl
└─────────────────────────────┘
```

- 루트 `flex flex-col items-center justify-center gap-4 py-12 px-4 text-center`, `role="status"`(error 는 `role="alert"`).
- 카드 안에 넣을 때는 `compact` prop 으로 `py-8`·아이콘 `w-12 h-12`.

### 3-4. `lib/agri-params.ts`

```ts
export const AGRI_PARAMS = [
  { key: "conductivity", dictKey: "ec",   unit: "mS/cm", digits: 2, scale: 1/1000, color: "#0ea5e9", icon: Zap },
  { key: "ph",           dictKey: "ph",   unit: "",      digits: 2, scale: 1,      color: "#8b5cf6", icon: Droplets },
  { key: "temperature",  dictKey: "temp", unit: "°C",    digits: 1, scale: 1,      color: "#f59e0b", icon: ThermometerSun },
  { key: "do_level",     dictKey: "do",   unit: "ppm",   digits: 1, scale: 1,      color: "#14b8a6", icon: Wind },
  { key: "flow_rate",    dictKey: "flow", unit: "L/min", digits: 1, scale: 1,      color: "#6366f1", icon: Waves },
  { key: "diff_pressure",dictKey: "dp",   unit: "kPa",   digits: 1, scale: 1,      color: "#f43f5e", icon: Gauge },
] as const
export function agriFormat(key, value): string          // agriIsMissing → "—", 아니면 (value*scale).toFixed(digits)
export function agriScaled(key, value): number | null   // 차트용: null 또는 value*scale
export function agriParamLabel(d: AgriDict, key): string // d.common.param[dictKey]
```

- 1단계 명세(설계서 5-1)에 `icon` 필드를 **추가**해 달라 — 세 화면이 같은 아이콘을 들고 다니지 않게. 아이콘은 1-4 표와 같다.
- 쓰는 곳과 방법:

| 화면 | 사용 |
|---|---|
| 대시보드 베드 카드 타일 | `AGRI_PARAMS.filter(k ∈ {conductivity, ph, temperature})` 순회 → `agriFormat` + `getAgriStatus` |
| 양액 관리 상태 스트립·최신값 카드·탭 | `AGRI_PARAMS` **전체 순서 그대로** (= 탭 순서 EC→pH→온도→DO→유량→차압) |
| 양액 관리 차트 | `stroke={p.color}`, y 값 `agriScaled`, 툴팁 `agriFormat` |
| 측정 입력 폼 | 단위·소수 자리·placeholder step(`10^-digits`) |
| CSV | 헤더 `${label} (${unit})`, 셀 `agriFormat` |

---

## 4. 농업 페이지 공통 골격 (2A·2B·2C)

모든 농업 뷰는 다음 순서를 지킨다. 데이터 필터는 뷰 안 **한 줄**: `farms.filter(f => f.farm_type === "agriculture")`, 베드·알림·일지는 `farm_type === "agriculture"`.

### 4-1. 로딩

```
        ◌            w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin
                     컨테이너 flex items-center justify-center min-h-[60vh] role="status" aria-label={t.common.loading}
```

목록·카드가 들어올 자리를 아는 화면(대시보드·양액 관리·농장)은 스피너 대신 **스켈레톤**: `animate-pulse bg-muted rounded-xl` 블록을 실제 카드 높이로(통계 4칸 `h-24`, 베드 카드 `h-40`, 차트 `h-[260px]`). CLS 방지. 홈·허브·폼은 스피너로 충분.

### 4-2. 로드 에러

```
      ⚠                        AlertTriangle w-10 h-10 text-amber-500
  불러오지 못했습니다              text-lg font-semibold
  네트워크 상태를 확인하고 …       text-sm text-muted-foreground
     [ 다시 시도 ]               bg-brand hover:bg-brand-hover text-white min-h-[44px] px-6 rounded-xl
```

`role="alert"`. 다시 시도는 `retry` 카운터를 올려 effect 를 다시 돈다(홈 뷰 패턴). 문구는 `d.common.loadErrorTitle / loadErrorMsg / retry`.

### 4-3. 빈 상태 두 단계

| 상황 | 표현 | CTA |
|---|---|---|
| 농업 농장 0개 | `AgriEmptyState icon=Building2` "등록된 농장이 없습니다" | `/daumlabs/farms` "농장 등록하기" (농장 페이지 자신은 `AddFarmDialog` 열기) |
| 농장은 있고 베드 0개 | `AgriEmptyState icon=Sprout` "등록된 베드가 없습니다" | `/daumlabs/farms` "베드 추가하기" |
| 베드는 있고 데이터 0건 | 해당 구역 안에 `compact` 빈 상태 | 측정 기록 / 일지 쓰기 링크 |

새우 농장만 있는 계정이 `/daumlabs/*` 를 직접 열면 **1행과 같은 빈 상태**다. "양식장 화면 열기" 같은 교차 링크는 넣지 않는다 — 그 일은 이제 헤더 스위치가 한다(설계서 2장).

### 4-4. 페이지 컨테이너

`space-y-6 animate-fade-in` (기존 대시보드 결). 320px 에서 가로 스크롤 0 — 모든 그리드는 `grid-cols-2` 아래로 내려가고 테이블은 쓰지 않는다(카드 목록으로).

---

## 5. 화면 8종

### 5-1. `/daumlabs/home` — `agri-home-view.tsx` (2A)

```
                    안녕하세요, 농부님!                        h1 text-2xl sm:text-3xl font-bold text-center
              오늘도 건강한 작물을 위해 시작해볼까요?             text-sm sm:text-base text-muted-foreground

┌─ 오늘 베드 현황 ─────────────────────────────────┐       bg-card border rounded-2xl p-4 shadow-sm, role="region"
│  ┌─────────┐  ┌─────────┐  ┌─────────┐          │       grid grid-cols-3 gap-2
│  │   ⚠     │  │   ⚡     │  │   ✓     │          │
│  │   1     │  │   2     │  │   5     │          │       text-xl font-bold font-mono tabular-nums
│  │  위험    │  │  주의    │  │  정상    │          │       text-[11px] text-muted-foreground
│  └─────────┘  └─────────┘  └─────────┘          │
│  ─────────────────────────────────────────────  │
│  ⚠ 미처리 알림 3건 — 모니터링에서 확인             │       Link → /daumlabs/dashboard, text-amber-600
└─────────────────────────────────────────────────┘

┌───────────────────────┐  ┌───────────────────────┐    grid grid-cols-1 sm:grid-cols-2 gap-4
│        ┌────┐         │  │        ┌────┐         │
│        │ 📋 │         │  │        │ 📊 │         │    w-14 h-14 rounded-xl, 왼쪽 bg-brand / 오른쪽 bg-amber-600
│        └────┘         │  │        └────┘         │
│     오늘 기록하기        │  │       현황 보기         │    text-lg sm:text-xl font-bold
│   측정값·영농 일지 입력   │  │   양액·알림·통계 확인    │    text-xs sm:text-sm text-muted-foreground
└───────────────────────┘  └───────────────────────┘
                 [ AdSlot ]
```

- 루트: `flex flex-col items-center min-h-[60vh] py-8 px-4` > `w-full max-w-lg space-y-6`. 기존 홈과 같은 뼈대.
- 위험 타일: `dangerCount > 0 ? "bg-red-500/10 border border-red-500/20 text-red-500" : "bg-muted/50 text-muted-foreground"`. 주의도 amber 로 같게. 정상은 항상 `text-emerald-600`.
- 타일 아이콘: 위험 `AlertTriangle`, 주의 `Activity`, 정상 `CheckCircle2`(기존).
- 큰 카드 2개: 왼쪽 hover `hover:border-brand hover:bg-brand/[0.04]`, 오른쪽 hover `hover:border-amber-600 hover:bg-amber-600/[0.05]`. 링크 `/daumlabs/record`, `/daumlabs/dashboard`.
- **착지 규칙**: 이 뷰는 `/daumlabs/home`에서만 렌더되므로 `ui_mode` 교정 로직이 없다. 농업 농장이 0개면 → 4-3 1행 빈 상태(온보딩으로 보내지 않는다 — 혼합 계정은 농장이 있을 수 있다. 단, **전체 농장이 0개**면 기존처럼 `/onboarding`).
- 데이터: `getFarms` → `getAllTanks` + `getAlerts(true)`, 필터 `farm_type === "agriculture"`. 1분 자동 갱신(`useAutoRefresh`).
- 로딩: 4-1 스피너. 에러: 4-2.
- 빈 상태: 베드 0 → 현황 카드 자리에 `bg-card rounded-2xl p-6 text-center` "등록된 베드가 없습니다." + 버튼 "농장 등록하기"(`/daumlabs/farms`). 큰 카드 2개는 그대로 보인다.
- 320px: 3칸 그리드 유지(숫자·한 단어라 안전), 큰 카드 1열 `py-8`.

### 5-2. `/daumlabs/record` — `agri-record-hub-view.tsx` (2A)

```
 ←  무엇을 기록할까요?                                   ArrowLeft(→ /daumlabs/home) + h1 text-2xl font-bold

┌────────────────────────┐  ┌────────────────────────┐   grid grid-cols-1 sm:grid-cols-2 gap-4
│         ┌────┐         │  │         ┌────┐         │
│         │ 📋 │         │  │         │ 📖 │         │   w-14 h-14 rounded-2xl text-white
│         └────┘         │  │         └────┘         │   왼쪽 bg-brand, 오른쪽 bg-emerald-500(기존)
│        측정 기록         │  │        영농 일지         │   text-xl font-bold
│   EC·pH·양액 온도 등     │  │  양액 보충·교환·설비 점검 │   text-sm
└────────────────────────┘  └────────────────────────┘
```

- 왼쪽 카드: `border-2 border-brand/25 bg-brand/5 hover:bg-brand/10 hover:border-brand/50`, 제목 `text-brand`, 부제 `text-brand/80`. 오른쪽: 기존 emerald 결 그대로(`border-emerald-200 bg-emerald-50 …` — 라이트/다크 둘 다 기존 값 유지).
- 아이콘: 측정 `ClipboardList`, 일지 `BookOpen`. 링크 `/daumlabs/record/water-quality`, `/daumlabs/record/journal`.
- `aria-label={`${d.record.measureTitle} - ${d.record.measureSub}`}` 패턴 유지.
- 데이터 로딩 없음 → 로딩·에러·빈 상태 없음.
- 320px: 1열, 카드 `py-10`.

### 5-3. `/daumlabs/record/water-quality` — `agri-measure-record-view.tsx` (2A)

`components/wizard/step-wizard.tsx` 를 그대로 쓴다(`StepWizard` props: title·steps·tanks·values·onChange·onComplete·saving·saved·error·notice). 농업 뷰는 **steps 배열과 저장 함수만** 가진다.

```
                 측정 기록                                   StepWizard title
          1단계 / 4단계 · 베드 선택                           (위저드 내장 진행 표시)
┌────────────────────────────────────────────┐
│ ⓘ 센서가 자동으로 기록하고 있습니다. 이 화면은 │   notice (첫 스텝) — Info 아이콘, bg-brand/5 border-brand/20
│   휴대용 측정기로 잰 값을 함께 남겨 …         │
│                                            │
│  베드 선택 *                                │
│  [ A동 1베드                          ▾ ]  │   Select (베드 = tanks 필터 결과)
└────────────────────────────────────────────┘
                              [ 다음 › ]

── 2단계: 양액 농도 ──────────────────────────────
│  날짜 *            [ 2026-10-15 ]           │
│  EC (mS/cm)        [ 예: 1.85        ]      │   hint: "이 베드 목표 1.80 ±0.10 mS/cm" | "이 베드에 목표 EC가 없습니다 — …"
│  pH                [ 예: 6.0         ]      │   hint: "이 베드 목표 6.0 ±0.5" | "엽채류 권장 5.5~6.5"
── 3단계: 양액 환경 ──────────────────────────────
│  양액 온도 (°C)     [ 예: 21.5        ]      │   hint: 근권 권장 18~22 °C (칠러 가동 시)
│  DO (ppm)          [ 예: 7.0         ]      │   hint: 5 ppm 이상 권장
── 4단계: 순환 라인 (확인) ───────────────────────
│  유량 (L/min)       [ 예: 12          ]      │   hint: 평소 유량과 크게 다르면 펌프·배관 점검
│  차압 (kPa)        [ 예: 15          ]      │   hint: 평소보다 오르면 UV 살균기·필터 막힘 의심
│                              [ 저장 ✓ ]     │
```

- 스텝 제목(`WizardStep.title`)을 농업판은 4스텝 전부 넣는다: 베드 선택 / 양액 농도 / 양액 환경 / 순환 라인. 기존 농업 분기는 마지막만 "확인"이었는데, 항목 묶음에 이름이 있는 쪽이 현장에서 읽기 쉽다.
- 전 측정 필드 `optional: true`, `type: "number"`, `inputMode="decimal"`(StepWizard 가 number 필드에 이미 붙이는지 확인 — 없으면 2A 가 StepWizard 를 고치지 **말고** 그대로 둔다. StepWizard 는 공용 파일이다).
- **빈 칸 = null 규칙** (저장 함수):

| 필드 | 변환 | 비고 |
|---|---|---|
| `conductivity` | `agriEcToMicroSiemens(raw)` | 빈 칸·"0" 모두 null. 저장은 µS/cm(×1000) |
| `ph` `temperature` `do_level` | `agriNumOrNull(raw) ?? 0` | 컬럼이 0 채움 관례(agri-standards 주석). 0 은 화면에서 미측정으로 읽힌다 |
| `flow_rate` `diff_pressure` | `agriNumOrNull(raw)` | **"0" 은 0 으로 산다**(펌프 정지) |
| 새우 전용 6컬럼 | 항상 `0` | 폼에 필드 자체가 없다 |

- 검증(제출 시, 값이 있을 때만): EC 0.1~10 mS/cm 밖 → `d.record.ecRangeError`; pH 0~14 밖 → `d.record.phRangeError`; 그 밖은 범위 검사 없음(기준이 없는 항목에 기준을 만들지 않는다). 에러는 StepWizard 의 `error` 슬롯.
- 저장 성공: StepWizard `saved` 화면(기존). 그 아래 두 링크: "추세 보기"(`/daumlabs/water-quality?tank=<id>`), "한 건 더 기록".
- 로딩: 스피너. 에러: `d.record.bedLoadFailed` + 다시 시도(4-2 축소형).
- 빈 상태(베드 0): `AgriEmptyState icon=Building2 title=d.record.noBedsTitle description=d.record.noBedsMeasureMsg cta=농장 등록하기→/daumlabs/farms`.
- 320px: StepWizard 가 `max-w-md px-4` 단일 열이라 그대로.

### 5-4. `/daumlabs/record/journal` — `agri-journal-record-view.tsx` (2A)

StepWizard 4스텝. 기존 농업 분기의 스텝 구성을 **그대로 승계**(이미 수아 시안 §3 로 검토된 구성):

| 스텝 | 제목 | 필드 |
|---|---|---|
| 1 | 베드·날짜 | `tank_id`(tank) · `date` |
| 2 | 양액 관리 | `feed_type`(select, `AGRI_NUTRIENT_TYPES`) · `feeding_amount` "양액 보충량" L · `feeding_times` "보충 횟수" 회/일 · `water_exchange_rate` "양액 교환율" % |
| 3 | 재배 작업 | `disinfection` "방제 실시"(switch) · `disinfection_type` "약제명"(dependsOn) · `microbial_input` "자재 투입"(switch) · `microbial_type`(select `AGRI_INPUT_TYPES`) · `microbial_amount` "투입량" kg |
| 4 | 설비 점검 | `check_circulation` "순환 펌프" · `check_filtration` "필터·UV 살균기" · `check_aeration` "근권 냉방 칠러" · `check_feeding_check` "생육 상태" · `notes` |

- `mortality_count` 는 폼에 없고 저장 시 `0`. 다른 뜻으로 재활용하지 않는다.
- `AGRI_NUTRIENT_TYPES`·`AGRI_INPUT_TYPES` 상수가 지금 `components/record/journal-record-view.tsx` 안에 있다면 2A 가 `components/agri/agri-journal-constants.ts` 로 **복제**해 둔다(3단계에서 새우 쪽 원본이 지워진다). 2B 의 일지 목록도 이 파일을 import.
- 폼 기본값 저장(`saveJournalDefaults(values, true)`)은 기존 유틸 재사용.
- 빈 상태: `d.record.noBedsJournalMsg`. 나머지 로딩·에러·320px 는 5-3 과 동일.

### 5-5. `/daumlabs/dashboard` — `agri-dashboard-view.tsx` (2A)

```
▣ 모니터링                                          [측정값 입력] [양액 관리 →]     AgriPageHeader
  재배 시설 현황을 한눈에

┌─ ⚠ 미처리 알림 3건 ─ A동 1베드, B동 2베드 … ─────────────────── [알림 보기] ┐  alerts>0 일 때만. bg-red-500/10 border-red-500/30
└──────────────────────────────────────────────────────────────────────────┘

┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    grid grid-cols-2 sm:grid-cols-4 gap-3
│🏢 운영 농장│ │🌱 가동 베드│ │⚠ 미처리 알림│ │⚗ EC 이탈 │    StatCard: bg-card border rounded-xl p-4
│   2      │ │   8      │ │   3      │ │   1      │    text-2xl font-bold tabular-nums
│ 베드 8개  │ │정상6·주의1·위험1│ │ 오늘      │ │레시피 기준 이탈│   text-xs text-muted-foreground
└─────────┘ └─────────┘ └─────────┘ └─────────┘    아이콘 w-5 h-5 text-brand / text-brand / text-amber-500 / text-brand

베드 현황                                              모두 보기 →      text-sm font-semibold + Link(/daumlabs/farms)
┌──────────────────────┐ ┌──────────────────────┐ ┌───────────────┐  grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3
│ ● A동 1베드   [정상]   │ │ ● A동 2베드   [주의]   │ │ …              │  카드 = Link → /daumlabs/water-quality?tank=
│ ⚗ EC 1.80 ±0.10 · pH 6.0 ±0.5                   │                │  text-xs text-muted-foreground tabular-nums
│ ┌─────┐┌─────┐┌─────┐ │ │ ┌─────┐┌─────┐┌─────┐ │ │               │  grid grid-cols-3 gap-2
│ │⚡ EC ││💧 pH ││🌡 온도│ │ │…                    │ │               │  타일: rounded-lg border p-2 ${status.bg}
│ │1.82 ││6.1  ││21.3 │ │ │                      │ │               │  text-sm font-bold tabular-nums ${status.text}
│ │mS/cm││     ││°C   │ │ │                      │ │               │
│ │정상  ││정상  ││정상  │ │ │                      │ │               │  text-[10px] 상태 텍스트(색+텍스트)
│ └─────┘└─────┘└─────┘ │ │                      │ │               │
│ 🌱 재배 42일차 · 12분 전 측정                        │               │  text-[11px] text-muted-foreground
└──────────────────────┘ └──────────────────────┘ └───────────────┘

┌─ ⚗ 양액 상태 · A동 1베드 센서 ────┐ ┌─ 🧭 차압 추세 · 최근 24시간 ──────┐  grid grid-cols-1 lg:grid-cols-3 gap-4
│  87 %   ● 농도 낮음  목표 1.80    │ │  14.2 kPa      ▲ 24시간 전 대비 2.1 │  왼쪽 lg:col-span-2 = NutrientStatusCard
│  처방: A액 320 mL · B액 320 mL    │ │  ╭─╮__╭──╯                       │  오른쪽 = 차압 스파크라인 카드(기존 분기 승계)
└─────────────────────────────────┘ │  올라가는 추세 — UV·필터 점검       │
                                    └──────────────────────────────────┘

┌─ 센서별 현재값 · 2대 ──────────────────────────────────────────────────┐  DeviceCurrentValues (그대로)
│ A동 1베드 센서 · 3분 전     EC 1850 µS/cm  pH 6.12  양액 온도 21.3 °C …  │
└──────────────────────────────────────────────────────────────────────┘

┌─ 🔔 최근 알림 ────────────────────────────────────────────────────────┐
│ ⚠ A동 2베드 — EC 2.05 mS/cm (목표 1.80 ±0.10)       10:42   [처리]    │  최대 5건, 이상 → "알림 전체 보기" (/daumlabs/water-quality#alerts)
│ …                                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

구역별 사양:

| 구역 | 컴포넌트 | 데이터 | 비고 |
|---|---|---|---|
| 헤더 | `AgriPageHeader icon=LayoutDashboard` | — | 액션: `Button variant=outline` "측정값 입력"(`/daumlabs/record/water-quality`), `Button bg-brand` "양액 관리" |
| 알림 배너 | 기존 red 배너 마크업 | `alerts`(미처리·농업) | 베드 이름 최대 3개 + "+n" |
| 통계 4칸 | 로컬 `StatCard` | farms·tanks·alerts | 4번째 = `alerts.filter(a => a.parameter === "EC").length` |
| 베드 현황 | 로컬 `BedCard` + `BedStatusBadge fromTank` | `tanks` + `Promise.all(tanks.map(tk => getLatestWaterQuality(tk.id)))` | 베드가 **12개 초과**면 최신값 조회를 생략하고 타일 대신 레시피 요약·재배일수만(조회 폭주 방지). 타일 3개 = EC·pH·온도, 유량이 0 이면 카드 하단에 `text-red-600 text-[11px]` "유량 0 — 순환 펌프 확인" 한 줄 추가 |
| 양액 상태 | `NutrientStatusCard devices tank` | 선택 베드의 `getSensorDevices` | **선택 베드 = 베드 현황에서 마지막으로 누른 카드 / 기본 첫 베드.** 카드가 `null` 을 돌려주면 구역이 접힌다(헤딩도 안 그린다) |
| 차압 추세 | 로컬 카드(기존 dashboard 분기 로직 그대로: 6표본 미만 "추세 보류", ≥2 kPa & ≥20% 상승 → amber) | 선택 베드 `getWaterQuality(tankId, 24)` | 아이콘 `Gauge text-rose-500`은 `AGRI_PARAMS.diff_pressure.color` 로 — 즉 스파크라인 색과 같다 |
| 센서별 현재값 | `DeviceCurrentValues devices` | 위와 같은 devices | 수정 없이 import. µS/cm 가 여기엔 뜬다(기기 raw) — 허용. 3단계에서 레이블 정리 여지 |
| 최근 알림 | 로컬 목록 | `alerts` 5건 | 메시지는 `alertDisplayLabel(a.parameter, "agriculture")` + `a.message`. "처리" 버튼은 `resolveAlert` (db) — 기존 양액 관리 알림 목록과 같은 함수 |

- 베드 카드의 두 역할을 분리한다: **카드 본체는 `button`**(누르면 선택 베드가 바뀌고 아래 양액 상태·차압·센서 구역이 그 베드로 갱신), **카드 우하단 작은 링크 "상세 →"**(`/daumlabs/water-quality?tank=<id>`, `text-xs text-brand-fg min-h-[44px] inline-flex items-center`). 카드 전체를 `Link` 로 만들면 선택을 표현할 길이 없다.
- 선택 베드 하이라이트 `ring-1 ring-brand/40 border-brand/40` + `aria-pressed`. 선택이 바뀐 것이 눈에 보이도록 양액 상태 구역 헤딩에 베드 이름을 박는다(`d.dashboard.nutrientHeading`).
- 로딩: 스켈레톤(통계 4개 `h-24`, 베드 카드 3개 `h-44`, 아래 카드 `h-40`).
- 에러: 4-2.
- 빈 상태: 농장 0 → 헤더만 남기고 `AgriEmptyState`(4-3 1행). 베드 0 → 4-3 2행. 측정 0 → 베드 카드 타일이 전부 `—`/미측정(카드는 그린다), 양액 상태·차압 구역은 `compact` 빈 상태 "측정 데이터가 없습니다 — 측정값 입력".
- 320px: 통계 2×2, 베드 카드 1열(타일 3칸은 `grid-cols-3` 유지 — 숫자 5자 이내), 양액 상태/차압 1열, 알림 행은 시간을 아래 줄로(`flex-wrap`).

### 5-6. `/daumlabs/water-quality` — `agri-nutrient-view.tsx` + `components/agri/charts/*` (2B)

**페이지 제목은 "양액 관리"**(URL 은 유지). 구조는 위에서 아래로: 헤더 → 선택 줄 → 상태 스트립 → 최신값 카드 6개 → 추세 차트(탭) → 센서 비교(센서 2대↑) → 알림.

```
⚗ 양액 관리                                                        [CSV ↓]   AgriPageHeader icon=FlaskConical
  베드별 양액 데이터를 기록하고 분석하세요

[ A동 1베드 ▾ ]  ( 베드 전체 | 센서 A | 센서 B )   ( 24시간 | 3일 | 7일 )    ↻ 1분 · 12초 전
 Select            센서 칩(기기 2대↑일 때만)        기간 세그먼트              자동 갱신 표시

┌─ 항목별 현재 양액 상태 ────────────────────────────────────────────────┐
│ (● EC · 1.82 mS/cm · 정상) (● pH · 6.12 · 정상) (● 양액 온도 · 21.3 °C · 정상)│  flex-wrap gap-2, 칩 = rounded-full border px-3 py-1.5 text-xs
│ (○ DO · — · 미측정) (○ 유량 · 12.0 L/min · 기준 없음) (○ 차압 · 14.2 kPa · 기준 없음)│
└──────────────────────────────────────────────────────────────────────┘

┌───────┐┌───────┐┌───────┐┌───────┐┌───────┐┌───────┐    grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3
│⚡   ●정상││💧  ●정상││🌡  ●정상││🌬 ○미측정││〰 ○기준없음││🧭 ○기준없음│   카드 bg = status.bg
│EC      ││pH     ││양액 온도││DO     ││유량    ││차압    │   text-xs text-muted-foreground
│1.82    ││6.12   ││21.3   ││—      ││12.0   ││14.2   │   text-2xl font-bold tabular-nums ${status.text}
│mS/cm   ││       ││°C     ││ppm    ││L/min  ││kPa    │
│목표 1.80 ±0.10││목표 6.0 ±0.5││16~26 °C││4.0 ppm 이상││        ││        │   text-[11px] — 기준 없으면 빈 줄 유지(높이 고정)
└───────┘└───────┘└───────┘└───────┘└───────┘└───────┘

┌─ 7일 추세 ──────────────────────────────────────── ↻ 1분 · 12초 전  [⛶] ┐
│ [ EC ][ pH ][ 양액 온도 ][ DO ][ 유량 ][ 차압 ]                           │  TabsList, 활성 data-[state=active]:bg-brand text-white
│                                                                       │
│  2.0 ┤                       ╭─╮                                       │  ReferenceArea 1.70~1.90 emerald 8%
│      ┤  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  목표 1.80                  │  ReferenceLine 6 3 emerald
│  1.8 ┤━━━━━━╯╰━━━━━━━━━━━━━━━━━╯ ╰━━━━━━━━━━━━━                       │  Line stroke=AGRI_PARAMS.conductivity.color
│      ┤  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─                              │  ReferenceLine 4 4 emerald 50%
│  1.6 ┤                                                                 │
│      └──────┬──────┬──────┬──────┬──────┬──────                        │
│  EC (mS/cm) — 목표 1.80 ±0.10 · 레시피: A동 1베드                        │  캡션 text-xs text-muted-foreground
└───────────────────────────────────────────────────────────────────────┘

┌─ 센서별 비교 ──────── ( EC | pH | 양액 온도 | DO )  [⛶] ─┐   센서 2대↑일 때만. 유량·차압은 비교 대상 아님(배관 위치마다 달라 비교가 뜻이 없다)
│  두 선(센서 A·B) + 범례 + 툴팁                            │
└──────────────────────────────────────────────────────────┘

┌─ 🔔 알림 · 미처리 2건 ────────────────────────────────────┐   id="alerts"
│ ⚠ EC 2.05 mS/cm — 목표 1.80 ±0.10   10:42         [처리]   │
│ ✓ 미처리 알림이 없습니다 — 양액이 목표 범위에 있습니다.        │   (0건)
└──────────────────────────────────────────────────────────┘
```

**선택 줄**

- 베드 `Select`(`components/ui/select`), `aria-label=d.nutrient.bedSelectAria`. `?tank=` 쿼리로 초기 선택, 선택 바뀌면 `router.replace` 로 쿼리 갱신(대시보드·알림 패널 딥링크 보존).
- 센서 칩: 활성 기기가 2대 이상일 때만. "베드 전체"(= `deviceId null`, 합산) + 기기별. 활성 `bg-brand text-white border-brand`, 비활성 `bg-card text-muted-foreground border-border hover:bg-accent`. 높이 `min-h-[36px]`(칩 줄은 가로 스크롤 `overflow-x-auto` 허용 — 유일한 가로 스크롤 예외, 기기 이름이 길 수 있다).
- 기간: 24h / 72h / 7d 세그먼트, 같은 칩 스타일. 기본 7일.
- 자동 갱신: 기존 결(`RefreshCw w-3 h-3` + "1분" + "· 12초 전").

**상태 스트립** — `AGRI_PARAMS` 순회, 칩 하나당 `BedStatusBadge` 와 같은 색 규칙 + 값 병기. 값이 "—" 면 "미측정". 기존 농업 분기 마크업과 같다.

**최신값 카드 6개** — 기존 `AgriReadingCard` 결 승계. 기준 줄(`rangeText`) 규칙:

| 항목 | 기준 줄 |
|---|---|
| EC | 레시피 있으면 "목표 1.80 ±0.10 mS/cm", 없으면 **빈 줄** |
| pH | 레시피 있으면 "목표 6.0 ±0.5", 없으면 `AGRI_QUALITY_STANDARDS.ph` "5.5~6.5" |
| 온도·DO | `AGRI_QUALITY_STANDARDS` 범위 문자열(`agriRangeText` — min/max 가 null 이면 "{{v}} 이상"/"{{v}} 이하") |
| 유량 | 위험(0)일 때만 "유량 0 — 순환 펌프가 멈췄는지 확인하세요", 아니면 빈 줄 |
| 차압 | 항상 빈 줄 |

빈 줄도 `min-h-[16px]` 로 자리를 지켜 6장 높이가 같게.

**추세 차트** — `components/agri/charts/`:

```
charts/
  param-trend-chart.tsx   단일 항목 선 + 레시피 밴드(옵션) + 빈 상태      ← 6탭 전부 이 하나로
  sensor-compare-chart.tsx 센서별 다중 선                                  ← 비교 카드
  chart-theme.ts          축·그리드·툴팁 스타일 상수(hsl(var(--border)) 등), big 모드 폰트 크기
```

- 탭 순서 **EC(기본) → pH → 양액 온도 → DO → 유량 → 차압** = `AGRI_PARAMS` 순서. "더보기" 토글은 **없다**(새우 지표 탭이 이 화면에 존재하지 않는다).
- `TabsTrigger` 클래스: `text-xs min-h-[36px] data-[state=active]:bg-brand data-[state=active]:text-white`. `TabsList` `bg-muted border border-border flex-wrap gap-y-1 h-auto`.
- y 값은 `agriScaled` 로 **mS/cm 환산 후** 넣는다. 레시피 밴드도 환산: `target_ec/1000 ± ec_tolerance/1000`. 툴팁은 `agriFormat` 한 값 + 단위 하나만("1.82 mS/cm"). µS/cm 병기는 하지 않는다.
- 레시피선 표현(EC·pH 공통, 레시피가 있을 때만):
  - `ReferenceArea y1=target-tol y2=target+tol fill="#34d399" fillOpacity={0.08} ifOverflow="extendDomain"`
  - `ReferenceLine y=target stroke="#34d399" strokeDasharray="6 3" strokeOpacity={0.9} label="목표 1.80" (insideTopRight, fontSize 11)`
  - `ReferenceLine y=target±tol stroke="#34d399" strokeDasharray="4 4" strokeOpacity={0.5}` 2줄
  - 2×tol(주의 경계)은 **그리지 않는다** — 5줄이 되면 과밀. 주의는 배지가 말한다.
- pH 레시피가 없으면 `AGRI_QUALITY_STANDARDS.ph` 밴드(5.5~6.5)를 **같은 emerald 문법으로** 그린다(목표선 없이 상·하한 점선 2줄 + 밴드). 온도·DO 도 같다(상한이 null 이면 하한 선 하나). EC·유량·차압은 레시피/기준이 없으면 선 0개.
- 캡션(차트 아래 `text-xs text-muted-foreground`): 항목별 한 줄(`d.nutrient.caption.*`). EC 캡션에 레시피 요약 병기.
- 빈 상태(해당 기간 데이터 0): 차트 영역 `h-[260px]` 유지, 가운데 `AGRI_PARAMS[key].icon w-8 h-8 text-muted-foreground/30` + "이 기간에 측정이 없습니다" + 링크 "측정값 입력".
- 로딩: 차트 영역 `animate-pulse bg-muted rounded-xl h-[260px]`(빈 축 프레임을 그리지 않는다).

**전체화면·전광판** — 기존 패턴을 농업판으로 정의:

| 요소 | 사양 |
|---|---|
| 전체화면 버튼 | 카드 헤더 우측 `Maximize2 w-4 h-4`, `p-2 min-w-[44px] min-h-[44px] rounded-lg border border-border`, `aria-label=d.nutrient.fullscreen`. 전체화면 중엔 `X` + `aria-label=t.common.close` |
| 전체화면 컨테이너 | 카드 className 교체 → `fixed inset-0 z-50 bg-card rounded-none border-0 flex flex-col overflow-hidden`; `CardContent flex-1 min-h-0 overflow-auto`. `Escape` 닫기, `body.overflow=hidden`, 닫으면 전광판도 끔 |
| 전광판 토글 | 전체화면 중에만 헤더에 노출. `aria-pressed`, 활성 `bg-brand text-white border-brand`, 라벨 "전광판 모드"(아이콘 전용 금지) |
| 전광판 렌더(`big`) | 축 글자 16px, 선 굵기 3, 목표선 라벨 14px, 범례 14px. 상단에 **베드 이름 + 현재 탭 항목 + 최신값**을 `text-3xl font-bold tabular-nums` 로 한 줄 띄움(벽걸이에서 선 하나만 보여도 수치를 읽을 수 있어야 한다) |
| 자동 순환 | 15초마다 다음 탭. 순서 = `AGRI_PARAMS` 순서(6개). 비교 카드 전체화면이면 비교 항목 4개 순환. 데이터가 없는 항목은 **건너뛴다**(빈 차트가 15초 떠 있지 않게) |
| 순환 표시 | 탭 아래 `h-0.5 bg-brand/30` 진행 바가 15초 동안 채워짐(`transition-[width] duration-[15000ms] linear` — width 애니메이션 예외 허용: 장식이 아니라 "언제 넘어가는지"를 알리는 정보. `motion-reduce` 에서는 바 대신 "15초마다 전환" 텍스트) |
| 전광판 색 | 라이트/다크 그대로. 별도 "다크 강제" 없음 |

**CSV** — 헤더 버튼 `Download w-4 h-4` + "CSV". 열: 측정 시각, 베드, 센서, EC (mS/cm), pH, 양액 온도 (°C), DO (ppm), 유량 (L/min), 차압 (kPa). 셀은 `agriFormat` 결과(미측정은 빈 셀, "—" 가 아니다 — 스프레드시트에서 숫자 열이 깨진다). 파일명 `양액데이터_<베드>_<YYYYMMDD>.csv`(`d.nutrient.csvPrefix`).

**알림 목록** — 선택 베드의 미처리 알림. 행: 아이콘(danger `AlertTriangle text-red-500`, warning `Activity text-amber-500`) · `alertDisplayLabel(param, "agriculture")` + 값·단위 · 시각 · [처리] 버튼(`variant=outline size=sm min-h-[44px]`). 0건: `CheckCircle2 text-emerald-500` + `d.nutrient.noAlerts`.

**로딩·에러·빈 상태**

- 로딩: 선택 줄은 바로, 아래 구역은 스켈레톤(스트립 `h-12`, 카드 6개 `h-32`, 차트 `h-[300px]`).
- 에러: 4-2.
- 농장 0 / 베드 0: 헤더 + `AgriEmptyState`(4-3). 데이터 0: 상태 스트립·카드 숨기고 카드 자리에 `compact` 빈 상태 "측정 데이터가 없습니다 — 측정값을 입력하거나 센서를 연결해 주세요" + CTA 2개(측정값 입력 / 기기 연결 → `/daumlabs/farms`).

**320px** — 선택 줄 3요소 세로 쌓기(`flex-col gap-2`), 상태 칩 `flex-wrap`, 카드 2열, 탭 2줄 wrap, 차트 높이 220. 전체화면 버튼은 320px 에서도 노출(태블릿 세로 전광판 용).

### 5-7. `/daumlabs/journal` — `agri-journal-view.tsx` (2B)

```
📖 영농 일지                                         [CSV ↓] [+ 일지 쓰기]   AgriPageHeader icon=BookOpen
  양액 교환·방제·설비 점검 등 일상 관리 기록                                     "일지 쓰기" → /daumlabs/record/journal

[ 베드 전체 ▾ ]  [ 2026-10-01 ] ~ [ 2026-10-15 ]  🔍 [ 메모 검색          ]   필터 줄: flex flex-wrap gap-2
                                                                            Select / Input date ×2 / Input search (min-h-[44px])
┌───────────────────────────────────────────────────────────────────────┐
│ A동 1베드  [10월 15일]                               ✎  🗑              │  Badge(brand 톤: bg-brand/10 text-brand) + 작성자 · 시각
│ 👤 나 · 2026-10-15 18:20                                               │
│ ┌────────┐┌────────┐┌────────┐┌────────┐                               │  grid grid-cols-2 sm:grid-cols-4 gap-3
│ │⚗ 40 L  ││↻ 2회/일 ││⟳ 30 %  ││🧪 미생물제│                              │  타일 bg-muted rounded-lg p-3 text-center
│ │양액 보충││보충 횟수││양액 교환││자재 투입│                               │  아이콘 색: brand / amber-500 / teal-500 / violet-500(AGRI_PARAMS.ph.color 와 같은 violet) 
│ └────────┘└────────┘└────────┘└────────┘                               │
│ 양액: 하이포넥스 A/B                                                     │  text-xs bg-muted rounded-lg px-3 py-2
│ 🛡 방제: 님오일 ㆍ ✓ 순환 펌프 ✓ 필터·UV ✓ 칠러 ✓ 생육                     │  방제·점검 요약 한 줄(한 것만 표시, 없으면 줄 생략)
│ 📝 B열 끝 쪽 잎 끝 황화 — 칼슘 결핍 의심. 수확 12 kg.                        │  notes
└───────────────────────────────────────────────────────────────────────┘
```

- 일지 카드 4타일의 네 번째 색: 새우 쪽은 `purple-500` 이었다. 농업에서는 **새 색 금지** 원칙상 `purple` 대신 `AGRI_PARAMS.ph.color`(violet `#8b5cf6` = Tailwind `violet-500`)를 쓴다 — 이미 허용된 차트 색 중 하나. 타일 순서 색 리듬: brand → amber → teal → violet.
- 수정: `Dialog` 안에 StepWizard 가 아닌 **단일 폼**(스크롤) — 필드는 5-4 와 같다(`updateJournalEntry`). 삭제: `Dialog` 확인("이 일지를 삭제합니다. 되돌릴 수 없습니다.") + `variant=destructive`.
- 진단(비브리오) 탭·카드·"고위험 수조" 위젯은 **존재하지 않는다**. 측정값 동시 입력(`tabWater`)도 없다 — 측정은 측정 기록 화면에서.
- 목록: 최신순, 20건 + "더 보기" 버튼(무한 스크롤 아님). 베드·기간·메모 검색은 클라이언트 필터.
- CSV 열: 날짜, 베드, 양액 종류, 보충량 (L), 보충 횟수, 교환율 (%), 방제, 약제, 자재, 투입량 (kg), 순환 펌프, 필터·UV, 칠러, 생육 상태, 메모.
- 로딩: 카드 스켈레톤 3개 `h-56`. 에러: 4-2.
- 빈 상태: 농장/베드 0 → 4-3. 일지 0 → `AgriEmptyState icon=BookOpen title=d.journal.noEntries description=d.journal.noEntriesMsg cta="일지 쓰기"→/daumlabs/record/journal`. 필터 결과 0 → `compact` "조건에 맞는 일지가 없습니다" + "필터 초기화".
- 320px: 필터 4요소 세로, 타일 2×2, 헤더 액션 아래 줄 전폭.

### 5-8. `/daumlabs/farms` — `agri-farms-view.tsx` + `components/agri/farms/*` (2C)

```
🏢 농장·기기 관리                                                   [+ 농장 추가]   AgriPageHeader icon=Building2
  농장과 베드를 등록하고 기기를 연결하세요

┌─ 지도 ────────────────────────────────────────────────────────────────┐  FarmMap farms tanks (그대로 import)
│   📍 제1온실 (베드 4)        📍 제2온실 (베드 4)                          │  farms.length>0 && 좌표 있는 농장 1개↑일 때만
└───────────────────────────────────────────────────────────────────────┘

┌─ 농장 (2) ─────────┐  ┌─ 제1온실 베드 (4) ───────────────────── [+ 베드 추가] ┐
│ ┌───────────────┐  │  │ ┌──────────────────────┐ ┌──────────────────────┐   │  grid grid-cols-1 md:grid-cols-2 gap-4
│ │🏢 제1온실   ● │  │  │ │ ● A동 1베드     [정상]  │ │ ● A동 2베드     [주의]  │   │
│ │ 베드 4 · 정상 3 │  │  │ │ 🌱 재배 42일차          │ │ 🌱 재배 42일차          │   │  칩: status.bg/text, 정식일 없으면 칩 생략
│ │ 주의 1          │  │  │ │ ┌────────┐┌────────┐ │ │ …                    │   │  grid grid-cols-2 gap-2
│ └───────────────┘  │  │ │ │🧱 베드 유형││💧 양액조 │ │ │                      │   │
│ ┌───────────────┐  │  │ │ │실내     ││1.0 ㎥   │ │ │                      │   │
│ │🏢 제2온실      │  │  │ │ ├────────┤├────────┤ │ │                      │   │
│ │ 베드 4 · 정상 4 │  │  │ │ │🌱 정식일 ││📅 수확 예정│ │ │                      │   │
│ └───────────────┘  │  │ │ │09-03    ││11-20    │ │ │                      │   │  수확 예정일 지났으면 text-red-600
│                    │  │ │ └────────┘└────────┘ │ │                      │   │
│ ┌─ 농장 정보 ────┐  │  │ │ ⚗ EC 1.80 ±0.10 · pH 6.0 ±0.5                     │   │  text-xs text-muted-foreground tabular-nums, FlaskConical text-brand
│ │ 📍 경남 밀양…  │  │  │ │ 등록 2026-09-01              ✎ 🗑                 │   │
│ │ 👤 김농부      │  │  │ │ ── 기기 ───────────────────────────────────    │   │  BedDeviceList
│ │ 📐 1,200 ㎡    │  │  │ │ 🖥 A동 1베드 센서 · 3분 전 · v1.4.2   [●] 🗑       │   │  Switch(active) + 삭제
│ │  ✎   🗑       │  │  │ │ [ + 기기 연결 ]  [ ⬆ 업데이트 요청 ]               │   │  PairDeviceDialog(그대로) + 업데이트(승인제, 기존 db 함수)
│ └───────────────┘  │  │ └──────────────────────┘ └──────────────────────┘   │
└────────────────────┘  └───────────────────────────────────────────────────┘
```

**레이아웃** — `flex flex-col lg:flex-row gap-5 items-start`. 왼쪽 `w-full lg:w-72 lg:shrink-0`(농장 카드 목록 + 선택 농장 정보 카드), 오른쪽 `flex-1 min-w-0`(베드 그리드).

**농장 카드** (`components/agri/farms/farm-card.tsx`) — `button w-full text-left rounded-xl border p-4`. 선택 `bg-brand/10 border-brand/40 ring-1 ring-brand/20`, 비선택 `bg-muted border-border hover:bg-accent`. 아이콘 박스 `w-9 h-9 rounded-xl` 선택 시 `bg-brand/20 text-brand`. 두 번째 줄 "베드 4 · 정상 3 · 주의 1"(0인 상태는 생략, 위험은 `text-red-600`). 교차 링크("양식장 화면 열기")는 **없다**(2장 스위치가 대신한다).

**농장 폼** (`farm-dialogs.tsx` — Add/Edit/Delete):

| 필드 | Add | Edit |
|---|---|---|
| 농장 이름 * | placeholder "예: 제1온실" | 동일 |
| 주소 | `address-search` 재사용 | 동일 |
| 대표자 | text | 동일 |
| 면적 (㎡) | number | 동일 |
| 좌표 | `CoordinateField` 재사용 | 동일 |
| 유형 | **필드 없음** — 이 화면에서 만드는 농장은 항상 `farm_type: "agriculture"` | 2택 카드(Waves 양식장 / Sprout 스마트팜) + 한 줄 "유형을 양식장으로 바꾸면 이 농장은 양식장 화면으로 옮겨집니다." 바꿔 저장하면 목록에서 사라지고 토스트 "양식장 화면으로 옮겨졌습니다" |

**베드 폼** (`bed-dialogs.tsx` — Add/Edit/Delete). 레시피 필드는 `components/agri/farms/recipe-fields.tsx` 로 **새로 작성**(선행 시안 §6-2 사양 그대로: 2×2, EC 0.1~10 step 0.1, EC 오차 0.01~2 기본 0.1, pH 3~9, pH 오차 0.1~2 기본 0.5, 목표 비면 오차 disabled, 저장 ×1000). 아이콘 `FlaskConical text-brand`.

| 필드 | 사양 |
|---|---|
| 베드 이름 * | placeholder "예: A동 1베드" |
| 베드 유형 | 3버튼 세그먼트 실내 / 반실내 / 노지, 기본 **실내**, `aria-pressed`, `min-h-[44px]` |
| 양액조 용량 (㎥, 선택) | `min 0.1 step 0.1`, 헬퍼 "1 ㎥ = 1,000 L". 비면 0 저장 |
| 정식일 | `type=date`, 선택. 저장 컬럼 `stocking_date` |
| 수확 예정일 | `type=date`, 선택. `harvest_date` |
| 양액 레시피 (선택) | `RecipeFields` |
| — | `stocking_density: 0, shrimp_count: 0, cycle_day: 정식일 있으면 계산값·없으면 0` |

검증 에러는 필드 아래(1-5). 폼 공통 입력 클래스 `bg-muted border-border focus-visible:ring-brand/50`.

**베드 카드** (`bed-card.tsx`) — 스케치대로. 요소 순서: 이름+`BedStatusBadge` → 재배일수 칩(정식일 있을 때만) → 2×2 타일(유형 / 용량 / 정식일 / 수확 예정 — 날짜 둘은 값 있을 때만, 그래서 2~4칸) → 레시피 요약 줄(미설정이면 "레시피 미설정" `text-muted-foreground`) → 등록일 + 수정/삭제 → `BedDeviceList`.

**기기 섹션** (`bed-device-list.tsx`) — 기존 `DeviceSection` 은 `farms-view.tsx` 내부 함수라 import 할 수 없다. 농업판을 작성하되 **로직은 전부 `lib/db`**(`getSensorDevices`, `toggleSensorDevice`, `deleteSensorDevice`, `requestDeviceUpdate`)로 하고 UI 만 그린다:

```
── 기기 (1) ─────────────────────────────────
🖥 A동 1베드 센서          3분 전 · v1.4.2     [●] 🗑     Cpu w-4 h-4 text-brand / seenLabel / firmware 작게 / Switch / 삭제 버튼 44px
   EC 1850 µS/cm · pH 6.12 · …                           (last_payload 요약은 그리지 않는다 — DeviceCurrentValues 가 대시보드에서 한다)
[ + 기기 연결 ]   [ ⬆ 업데이트 요청 ]                     PairDeviceDialog(tank, onSuccess) 그대로 / 업데이트는 최신 버전이 아닐 때만 노출
```

- 기기 0대: 한 줄 `text-xs text-muted-foreground` "연결된 기기가 없습니다" + `PairDeviceDialog` 버튼.
- 삭제 확인 다이얼로그 문구는 `d.farms.deleteDeviceConfirm`.

**로딩·에러·빈 상태**

- 로딩: 왼쪽 농장 카드 스켈레톤 2개 `h-24`, 오른쪽 베드 카드 스켈레톤 2개 `h-64`.
- 에러: 4-2.
- 농장 0: 헤더 + `AgriEmptyState icon=Building2 title=d.farms.noFarms description=d.farms.noFarmsMsg cta={onClick: AddFarmDialog 열기}`. 베드 0: 오른쪽 영역에 `AgriEmptyState icon=Sprout … cta={AddBedDialog 열기}`.
- 플랜 한도: 기존 `farmLimit`/`tankLimit` 다이얼로그 문구를 농업 사전으로.

**320px** — 지도 `h-48`, 농장 목록이 위·베드 그리드가 아래(1열), 베드 카드 타일 2열 유지, 기기 행은 이름 줄 / 상태 줄 2줄로 wrap, 헤더 "농장 추가" 전폭.

---

## 6. 사전 키 초안 (ko · en) — `lib/i18n/agri/*.ts`

규칙(설계서 6장): 각 파일이 자기 타입 + 4개 언어를 export. vi/id 는 en 기준으로 개발자가 번역. 자리표시자 `{{name}}`. 공용 UI 문구(저장·취소·닫기·날짜·"n분 전")는 `useT().t.common / t.time` 그대로 — 여기 다시 만들지 않는다. **기존 `agri-ko.ts`·`ko.ts#agri` 의 한국어는 아래에 그대로 옮겨 재활용했다.**

### 6-0. `common.ts` · `nav.ts` (1단계 서연-1 소유 — 2~3장이 필요로 하는 키를 **제안**한다)

| 키 | ko | en |
|---|---|---|
| `common.modeShrimp` | 양식장 | Aquaculture |
| `common.modeAgri` | 스마트팜 | Smart farm |
| `common.modeGroupAria` | 화면 모드 전환 | Switch screen mode |
| `common.defaultScreenLabel` | 기본 화면 | Default screen |
| `common.defaultScreenDesc` | 로그인하면 이 화면으로 시작합니다. | You will land on this screen after signing in. |
| `common.defaultScreenSaved` | 기본 화면으로 저장했습니다. | Saved as your default screen. |
| `common.bed` | 베드 | Bed |
| `common.farm` | 농장 | Farm |
| `common.bedStatusAria` | 베드 상태 | Bed status |
| `common.statusNormal` | 정상 | Normal |
| `common.statusWarning` | 주의 | Warning |
| `common.statusDanger` | 위험 | Danger |
| `common.statusNotMeasured` | 미측정 | Not measured |
| `common.statusNoStandard` | 기준 없음 | No reference |
| `common.param.ec` | EC | EC |
| `common.param.ph` | pH | pH |
| `common.param.temp` | 양액 온도 | Solution temp. |
| `common.param.do` | DO | DO |
| `common.param.flow` | 유량 | Flow rate |
| `common.param.dp` | 차압 | Diff. pressure |
| `common.target` | 목표 | Target |
| `common.recipeNotSet` | 레시피 미설정 | No recipe set |
| `common.cropDayN` | 재배 {{n}}일차 | Day {{n}} |
| `common.registerFarmCta` | 농장 등록하기 | Register a farm |
| `common.addBedCta` | 베드 추가하기 | Add a bed |
| `common.loadErrorTitle` | 불러오지 못했습니다 | Could not load |
| `common.loadErrorMsg` | 네트워크 상태를 확인하고 다시 시도해 주세요. | Check your connection and try again. |
| `common.retry` | 다시 시도 | Retry |
| `common.viewAll` | 모두 보기 | View all |
| `common.noFarmsTitle` | 등록된 농장이 없습니다 | No farms yet |
| `common.noFarmsMsg` | 농장을 등록하면 베드·양액·알림을 여기서 볼 수 있습니다. | Register a farm to see beds, nutrient data and alerts here. |
| `common.noBedsTitle` | 등록된 베드가 없습니다 | No beds yet |
| `common.noBedsMsg` | 베드를 추가하면 측정과 모니터링을 시작할 수 있습니다. | Add a bed to start logging and monitoring. |
| `nav.home` | 홈 | Home |
| `nav.recordMeasure` | 측정 기록 | Log readings |
| `nav.recordJournal` | 영농 일지 | Farm journal |
| `nav.dashboard` | 모니터링 | Monitoring |
| `nav.nutrient` | 양액 관리 | Nutrient solution |
| `nav.journal` | 영농 일지 | Farm journal |
| `nav.farms` | 농장·기기 관리 | Farms & devices |
| `nav.tagline` | SMART HYDROPONICS | SMART HYDROPONICS |

### 6-1. `home.ts` (2A)

| 키 | ko | en |
|---|---|---|
| `greeting` | 안녕하세요, {{name}}님! | Hello, {{name}}! |
| `greetingSubtitle` | 오늘도 건강한 작물을 위해 시작해볼까요? | Ready for another day of healthy crops? |
| `bedsToday` | 오늘 베드 현황 | Beds today |
| `noBeds` | 등록된 베드가 없습니다. | No beds registered yet. |
| `noBedsAria` | 베드 정보 없음 | No bed information |
| `unresolvedAlerts` | 미처리 알림 {{count}}건 | {{count}} open alerts |
| `unresolvedAlertsCta` | — 모니터링에서 확인 | — review in Monitoring |
| `unresolvedAlertsAria` | 미처리 알림 {{count}}건, 모니터링으로 이동 | {{count}} open alerts, go to Monitoring |
| `recordCard` | 오늘 기록하기 | Log today |
| `recordCardSub` | 측정값·영농 일지 입력 | Readings & farm journal |
| `recordCardAria` | 측정값·영농 일지 입력 페이지로 이동 | Go to readings and journal entry |
| `monitorCard` | 현황 보기 | View status |
| `monitorCardSub` | 양액·알림·통계 확인 | Nutrient, alerts & stats |
| `monitorCardAria` | 양액·알림·통계 모니터링으로 이동 | Go to monitoring |
| `loadingAria` | 베드 현황 불러오는 중 | Loading bed status |

### 6-2. `record.ts` (2A) — 허브 + 측정 폼 + 일지 폼

| 키 | ko | en |
|---|---|---|
| `chooseTitle` | 무엇을 기록할까요? | What would you like to log? |
| `backToHomeAria` | 홈으로 | Back to home |
| `measureTitle` | 측정 기록 | Log readings |
| `measureSub` | EC·pH·양액 온도 등 | EC, pH, solution temp. and more |
| `journalTitle` | 영농 일지 | Farm journal |
| `journalSub` | 양액 보충·교환·설비 점검 등 | Refills, exchanges, maintenance |
| `bedLoadFailed` | 베드 목록을 불러오지 못했습니다. | Could not load beds. |
| `noBedsMeasureMsg` | 측정 기록을 시작하려면 먼저 농장과 베드를 등록해 주세요. | Register a farm and a bed before logging readings. |
| `noBedsJournalMsg` | 영농 일지를 쓰려면 먼저 농장과 베드를 등록해 주세요. | Register a farm and a bed before writing a journal entry. |
| `stepBed` | 베드 선택 | Choose bed |
| `stepConcentration` | 양액 농도 | Solution strength |
| `stepEnvironment` | 양액 환경 | Solution environment |
| `stepCirculation` | 순환 라인 | Circulation line |
| `notice` | 센서가 자동으로 기록하고 있습니다. 이 화면은 휴대용 측정기로 잰 값을 함께 남겨 센서와 대조하는 곳입니다. | Sensors log automatically. Use this screen to record handheld readings alongside them for comparison. |
| `ecTarget` | 이 베드 목표 {{target}} ±{{tol}} mS/cm | Bed target {{target}} ±{{tol}} mS/cm |
| `ecNoTarget` | 이 베드에 목표 EC가 없습니다 — 농장·기기 관리에서 레시피를 설정하면 여기에 목표가 표시됩니다. | No target EC for this bed — set a recipe in Farms & devices to see it here. |
| `phTarget` | 이 베드 목표 {{target}} ±{{tol}} | Bed target {{target}} ±{{tol}} |
| `phNoTarget` | 엽채류 권장 5.5~6.5 | Leafy greens: 5.5–6.5 recommended |
| `tempHint` | 근권 권장 18~22 °C (칠러 가동 시) | Root zone 18–22 °C recommended (with chiller) |
| `doHint` | 5 ppm 이상 권장 | 5 ppm or higher recommended |
| `flowHint` | 평소 유량과 크게 다르면 펌프·배관을 점검하세요. | If far from usual, check pump and piping. |
| `dpHint` | 평소보다 오르면 UV 살균기·필터 막힘을 의심하세요. | Rising above usual suggests a clogged UV unit or filter. |
| `ecRangeError` | EC는 0.1~10 mS/cm 범위로 입력해 주세요. | Enter EC between 0.1 and 10 mS/cm. |
| `phRangeError` | pH는 0~14 범위로 입력해 주세요. | Enter pH between 0 and 14. |
| `saveFailed` | 저장하지 못했습니다. 다시 시도해 주세요. | Could not save. Please try again. |
| `savedViewTrend` | 추세 보기 | View trend |
| `savedAgain` | 한 건 더 기록 | Log another |
| `jStepBedDate` | 베드·날짜 | Bed & date |
| `jStepNutrient` | 양액 관리 | Nutrient solution |
| `jStepWork` | 재배 작업 | Crop work |
| `jStepCheck` | 설비 점검 | Equipment check |
| `nutrientType` | 양액 종류 | Nutrient type |
| `nutrientRefill` | 양액 보충량 | Refill amount |
| `nutrientRefillHint` | 오늘 양액조에 새로 채운 양입니다. | Volume added to the tank today. |
| `refillTimes` | 보충 횟수 | Refills |
| `exchangeRate` | 양액 교환율 | Exchange rate |
| `exchangeRateHint` | 전량 교환이면 100. 일부만 바꿨으면 바꾼 비율을 적습니다. | 100 for a full exchange; otherwise the share replaced. |
| `pestControl` | 방제 실시 | Pest control done |
| `pestAgent` | 약제명 | Agent |
| `pestAgentPlaceholder` | 약제 이름을 입력하세요 | Enter the agent name |
| `inputApplied` | 자재 투입 | Input applied |
| `inputType` | 자재 종류 | Input type |
| `inputAmount` | 투입량 | Amount |
| `inputAmountHint` | 액상 자재는 L 단위로 적습니다 (1 L = 1 kg 로 봅니다). | Liquids in L (1 L counted as 1 kg). |
| `checkPump` | 순환 펌프 | Circulation pump |
| `checkFilterUv` | 필터·UV 살균기 | Filter & UV unit |
| `checkChiller` | 근권 냉방 칠러 | Root-zone chiller |
| `checkGrowth` | 생육 상태 | Crop condition |
| `notes` | 메모 | Notes |
| `notesPlaceholder` | 특이사항을 적어 주세요. 수확량도 여기에 적습니다. | Note anything unusual. Record harvest amounts here too. |

### 6-3. `dashboard.ts` (2A)

| 키 | ko | en |
|---|---|---|
| `title` | 모니터링 | Monitoring |
| `subtitle` | 재배 시설 현황을 한눈에 | Your growing facility at a glance |
| `actionRecord` | 측정값 입력 | Log readings |
| `actionNutrient` | 양액 관리 | Nutrient solution |
| `alertBanner` | 미처리 알림 {{count}}건 | {{count}} open alerts |
| `alertBannerMore` | 외 {{n}}개 베드 | and {{n}} more beds |
| `viewAlerts` | 알림 보기 | View alerts |
| `statFarms` | 운영 농장 | Farms |
| `statFarmsSub` | 베드 {{n}}개 | {{n}} beds |
| `statBeds` | 가동 베드 | Active beds |
| `statBedsSub` | 정상 {{ok}} · 주의 {{warn}} · 위험 {{danger}} | OK {{ok}} · Warn {{warn}} · Danger {{danger}} |
| `statAlerts` | 미처리 알림 | Open alerts |
| `statAlertsSub` | 오늘 | Today |
| `statEcDeviation` | EC 이탈 알림 | EC deviations |
| `statEcDeviationSub` | 베드 레시피 기준 이탈 | Outside bed recipe range |
| `bedsHeading` | 베드 현황 | Bed status |
| `bedDetail` | 상세 | Details |
| `bedSelectAria` | {{name}} 선택 | Select {{name}} |
| `lastMeasuredAgo` | {{ago}} 측정 | measured {{ago}} |
| `noReading` | 측정 데이터가 없습니다 | No readings yet |
| `flowStopped` | 유량 0 — 순환 펌프를 확인하세요 | Flow 0 — check the circulation pump |
| `nutrientHeading` | 양액 상태 · {{name}} | Nutrient status · {{name}} |
| `dpTrendTitle` | 차압 추세 · 최근 24시간 | Diff. pressure · last 24 h |
| `dpDelta` | 24시간 전 대비 {{v}} kPa | {{v}} kPa vs. 24 h ago |
| `dpRisingHint` | 올라가는 추세입니다 — UV 살균기·필터 막힘을 점검해 보세요. | Trending up — check the UV unit and filter for clogging. |
| `dpSteadyHint` | 특이한 변화가 없습니다. | No notable change. |
| `dpNoData` | 차압 데이터가 아직 없습니다. | No pressure data yet. |
| `dpNeedMore` | 추세를 말하기에는 측정이 아직 적습니다 — 6회 이상 쌓이면 비교합니다. | Not enough readings for a trend — compares after 6 or more. |
| `recentAlerts` | 최근 알림 | Recent alerts |
| `noAlerts` | 미처리 알림이 없습니다 | No open alerts |
| `resolve` | 처리 | Resolve |
| `viewAllAlerts` | 알림 전체 보기 | View all alerts |
| `noDataCompact` | 측정 데이터가 없습니다 — 측정값을 입력해 주세요. | No readings yet — log a reading. |

### 6-4. `nutrient.ts` (2B)

| 키 | ko | en |
|---|---|---|
| `title` | 양액 관리 | Nutrient solution |
| `subtitle` | 베드별 양액 데이터를 기록하고 분석하세요 | Track and analyse nutrient data per bed |
| `bedSelectAria` | 베드 선택 | Select bed |
| `allSensors` | 베드 전체 | Whole bed |
| `sensorSelectAria` | 센서 선택 | Select sensor |
| `period24h` | 24시간 | 24 h |
| `period72h` | 3일 | 3 days |
| `period7d` | 7일 | 7 days |
| `autoRefresh` | 자동 갱신 {{n}}분 | Auto-refresh {{n}} min |
| `statusStripTitle` | 항목별 현재 양액 상태 | Current status by parameter |
| `statusLabel` | 상태 | Status |
| `latestHeading` | 최신 측정값 | Latest readings |
| `targetWithTol` | 목표 {{target}} ±{{tol}} | Target {{target}} ±{{tol}} |
| `rangeBetween` | {{min}}~{{max}} | {{min}}–{{max}} |
| `rangeAtLeast` | {{v}} 이상 | {{v}} or more |
| `rangeAtMost` | {{v}} 이하 | {{v}} or less |
| `flowStoppedHint` | 유량 0 — 순환 펌프가 멈췄는지 확인하세요. | Flow 0 — check whether the circulation pump has stopped. |
| `trendTitle` | {{range}} 추세 | {{range}} trend |
| `noRecipeLine` | 레시피가 없어 목표선을 그리지 않습니다. | No recipe set, so no target line is drawn. |
| `caption.ec` | EC (mS/cm) — 양액 농도. 목표를 벗어나면 보충·교환으로 맞춥니다. | EC (mS/cm) — solution strength. Correct with refills or exchange when off target. |
| `caption.ph` | pH — 양분 흡수 효율. 레시피가 없으면 엽채류 권장 5.5~6.5 를 표시합니다. | pH — nutrient uptake. Without a recipe the 5.5–6.5 leafy-greens band is shown. |
| `caption.temp` | 양액 온도 (°C) — 근권 온도. 칠러 가동 상태와 함께 봅니다. | Solution temp. (°C) — root-zone temperature; read alongside chiller status. |
| `caption.do` | DO (ppm) — 양액 용존산소. 낮으면 뿌리 호흡이 떨어집니다. | DO (ppm) — dissolved oxygen; low values stress roots. |
| `caption.flow` | 순환 유량 (L/min) — 급락 시 펌프·배관 점검 | Circulation flow (L/min) — sudden drops: check pump and piping |
| `caption.dp` | 차압 (kPa) — 상승 시 UV 살균기·필터 막힘 의심 | Differential pressure (kPa) — rising: suspect UV unit or filter clogging |
| `noChartData` | 이 기간에 측정이 없습니다 | No readings in this period |
| `noChartDataCta` | 측정값 입력 | Log a reading |
| `fullscreen` | 전체화면 | Full screen |
| `boardMode` | 전광판 모드 | Display board |
| `boardCycleNote` | 15초마다 전환 | Switches every 15 s |
| `compareTitle` | 센서별 비교 | Compare sensors |
| `compareNoHistory` | 센서 기록이 아직 없습니다 | No sensor history yet |
| `compareNoTag` | 센서가 표시되지 않은 기록만 있습니다 | Readings are not tagged by sensor |
| `csv` | CSV | CSV |
| `csvPrefix` | 양액데이터 | nutrient-data |
| `csvTime` | 측정 시각 | Measured at |
| `csvSensor` | 센서 | Sensor |
| `alertsTitle` | 알림 | Alerts |
| `alertsOpenN` | 미처리 {{n}}건 | {{n}} open |
| `noAlerts` | 미처리 알림이 없습니다 — 양액이 목표 범위에 있습니다. | No open alerts — the solution is within range. |
| `resolve` | 처리 | Resolve |
| `noData` | 측정 데이터가 없습니다 | No readings yet |
| `noDataHint` | 측정값을 입력하거나 센서를 연결해 주세요. | Log a reading or connect a sensor. |
| `connectDevice` | 기기 연결 | Connect a device |

### 6-5. `journal.ts` (2B)

| 키 | ko | en |
|---|---|---|
| `title` | 영농 일지 | Farm journal |
| `subtitle` | 양액 교환·방제·설비 점검 등 일상 관리 기록 | Daily log of exchanges, pest control and maintenance |
| `newEntry` | 일지 쓰기 | New entry |
| `allBeds` | 베드 전체 | All beds |
| `bedFilterAria` | 베드로 필터 | Filter by bed |
| `dateFrom` | 시작일 | From |
| `dateTo` | 종료일 | To |
| `searchPlaceholder` | 메모 검색 | Search notes |
| `resetFilters` | 필터 초기화 | Reset filters |
| `noEntries` | 일지 기록이 없습니다 | No journal entries |
| `noEntriesMsg` | 양액 교환·방제·설비 점검 등 농장 작업을 기록하세요. | Record exchanges, pest control and maintenance. |
| `noMatch` | 조건에 맞는 일지가 없습니다 | No entries match the filters |
| `tileRefill` | 양액 보충 | Refill |
| `tileRefillTimes` | 보충 횟수 | Refills |
| `tileExchange` | 양액 교환 | Exchange |
| `tileInput` | 자재 투입 | Input |
| `inputNone` | 투입 없음 | None |
| `inputApplied` | 투입 | Applied |
| `nutrientLabel` | 양액 | Nutrient |
| `pestLabel` | 방제 | Pest control |
| `checksLabel` | 점검 | Checks |
| `me` | 나 | Me |
| `loadMore` | 더 보기 | Load more |
| `edit` | 수정 | Edit |
| `editTitle` | 일지 수정 | Edit entry |
| `editAria` | {{date}} 일지 수정 | Edit entry for {{date}} |
| `delete` | 삭제 | Delete |
| `deleteAria` | {{date}} 일지 삭제 | Delete entry for {{date}} |
| `deleteConfirm` | 이 일지를 삭제합니다. 되돌릴 수 없습니다. | This entry will be deleted. This cannot be undone. |
| `updated` | 일지가 수정되었습니다. | Entry updated. |
| `deleted` | 일지가 삭제되었습니다. | Entry deleted. |
| `csvPrefix` | 영농일지 | farm-journal |

### 6-6. `farms.ts` (2C)

| 키 | ko | en |
|---|---|---|
| `title` | 농장·기기 관리 | Farms & devices |
| `subtitle` | 농장과 베드를 등록하고 기기를 연결하세요 | Register farms and beds, connect devices |
| `farmsHeading` | 농장 | Farms |
| `farmInfo` | 농장 정보 | Farm details |
| `addFarm` | 농장 추가 | Add farm |
| `editFarm` | 농장 수정 | Edit farm |
| `deleteFarm` | 농장 삭제 | Delete farm |
| `farmName` | 농장 이름 | Farm name |
| `farmNamePlaceholder` | 예: 제1온실 | e.g. Greenhouse 1 |
| `address` | 주소 | Address |
| `owner` | 대표자 | Owner |
| `area` | 면적 (㎡) | Area (m²) |
| `farmType` | 농장 유형 | Farm type |
| `farmTypeShrimp` | 양식장 | Aquaculture |
| `farmTypeAgri` | 스마트팜 | Smart farm |
| `farmTypeChangeNote` | 유형을 양식장으로 바꾸면 이 농장은 양식장 화면으로 옮겨집니다. | Changing to aquaculture moves this farm to the aquaculture screens. |
| `farmMoved` | 양식장 화면으로 옮겨졌습니다. | Moved to the aquaculture screens. |
| `deleteFarmConfirm` | 이 농장과 모든 베드 데이터가 삭제됩니다. 계속하시겠습니까? | This farm and all its bed data will be deleted. Continue? |
| `farmCreated` | 농장이 추가되었습니다. | Farm added. |
| `farmUpdated` | 농장이 수정되었습니다. | Farm updated. |
| `farmDeleted` | 농장이 삭제되었습니다. | Farm deleted. |
| `farmLimitTitle` | 농장 한도 초과 | Farm limit reached |
| `farmLimitMsg` | 현재 플랜의 농장 최대 개수에 도달했습니다. | Your plan's farm limit has been reached. |
| `bedsHeading` | {{name}} 베드 | {{name}} beds |
| `bedCountN` | 베드 {{n}} | {{n}} beds |
| `addBed` | 베드 추가 | Add bed |
| `editBed` | 베드 수정 | Edit bed |
| `deleteBed` | 베드 삭제 | Delete bed |
| `bedName` | 베드 이름 | Bed name |
| `bedNamePlaceholder` | 예: A동 1베드 | e.g. House A – Bed 1 |
| `bedNameRequired` | 베드 이름을 입력해 주세요. | Enter a bed name. |
| `bedType` | 베드 유형 | Bed type |
| `bedTypeIndoor` | 실내 | Indoor |
| `bedTypeSemi` | 반실내 | Semi-indoor |
| `bedTypeOutdoor` | 노지 | Outdoor |
| `volume` | 양액조 용량 | Tank volume |
| `volumeOptional` | (㎥, 선택) | (m³, optional) |
| `volumeHint` | 1 ㎥ = 1,000 L | 1 m³ = 1,000 L |
| `volumeUnit` | ㎥ | m³ |
| `plantingDate` | 정식일 | Transplant date |
| `harvestPlanDate` | 수확 예정일 | Planned harvest |
| `recipeTitle` | 양액 레시피 | Nutrient recipe |
| `recipeOptional` | (선택) | (optional) |
| `recipeHint` | 목표값을 벗어나면 알림을 보내드립니다. | We alert you when readings leave the target range. |
| `targetEc` | 목표 EC | Target EC |
| `ecUnit` | mS/cm | mS/cm |
| `targetEcPlaceholder` | 예: 1.8 | e.g. 1.8 |
| `ecTolerance` | EC 허용 오차 | EC tolerance |
| `targetPh` | 목표 pH | Target pH |
| `targetPhPlaceholder` | 예: 6.0 | e.g. 6.0 |
| `phTolerance` | pH 허용 오차 | pH tolerance |
| `ecRangeError` | 목표 EC는 0.1~10 mS/cm 범위로 입력해 주세요. | Enter a target EC between 0.1 and 10 mS/cm. |
| `ecToleranceRangeError` | EC 허용 오차는 0.01~2 mS/cm 범위로 입력해 주세요. | Enter an EC tolerance between 0.01 and 2 mS/cm. |
| `phRangeError` | 목표 pH는 3~9 범위로 입력해 주세요. | Enter a target pH between 3 and 9. |
| `phToleranceRangeError` | pH 허용 오차는 0.1~2 범위로 입력해 주세요. | Enter a pH tolerance between 0.1 and 2. |
| `deleteBedConfirm` | 이 베드와 모든 측정 기록이 삭제됩니다. 계속하시겠습니까? | This bed and all its readings will be deleted. Continue? |
| `bedCreated` | 베드가 추가되었습니다. | Bed added. |
| `bedUpdated` | 베드가 수정되었습니다. | Bed updated. |
| `bedDeleted` | 베드가 삭제되었습니다. | Bed deleted. |
| `bedLimitTitle` | 베드 한도 초과 | Bed limit reached |
| `bedLimitMsg` | 현재 플랜의 베드 최대 개수에 도달했습니다. | Your plan's bed limit has been reached. |
| `statusAutoNote` | 측정 데이터 저장 시 자동 갱신됩니다 | Updates automatically when readings are saved |
| `registered` | 등록 | Registered |
| `devicesHeading` | 기기 | Devices |
| `noDevices` | 연결된 기기가 없습니다 | No devices connected |
| `deviceActiveAria` | {{name}} 사용 여부 | {{name}} enabled |
| `deleteDevice` | 기기 삭제 | Remove device |
| `deleteDeviceAria` | {{name}} 삭제 | Remove {{name}} |
| `deleteDeviceConfirm` | 이 기기 연결을 해제합니다. 기기는 더 이상 데이터를 보낼 수 없습니다. | This device will be disconnected and can no longer send data. |
| `requestUpdate` | 업데이트 요청 | Request update |
| `updateRequested` | 다음 확인 때 업데이트됩니다 (최대 5분). | Will update at the next check-in (within 5 min). |
| `firmwareLatest` | 최신 | Up to date |
| `noFarms` | 등록된 농장이 없습니다 | No farms yet |
| `noFarmsMsg` | 농장을 추가하여 양액 관리를 시작하세요. | Add a farm to start managing nutrient solution. |
| `noBeds` | 등록된 베드가 없습니다 | No beds yet |
| `noBedsMsg` | 베드를 추가하여 양액 모니터링을 시작하세요. | Add a bed to start monitoring. |
| `mapAria` | 농장 위치 지도 | Farm location map |

---

## 7. 다크 모드 — 녹색 브랜드 대비 메모 (서연-1 적용, 태양 검수 10항)

토큰 값으로 계산한 WCAG 대비(상대 휘도 기준, 반올림):

| 전경 | 배경 | 대비 | 판정 |
|---|---|---|---|
| `#15803D` (brand) 텍스트 | 라이트 `--background` hsl(210 40% 98%) | **4.9:1** | AA 통과 |
| `#15803D` 텍스트 | 라이트 `--card` #FFFFFF | **5.0:1** | AA 통과 |
| 흰 글자 | `bg-brand` #15803D (활성 세그먼트·CTA) | **5.0:1** | AA 통과 |
| 흰 글자 | `bg-brand-hover` #16A34A | **3.3:1** | 소형 텍스트 AA **미달** (UI 컴포넌트 3:1 은 통과) |
| `#15803D` 텍스트 | 다크 `--background` hsl(222 47% 7%) ≈ #0A0F1A | **3.8:1** | AA **미달** |
| `#15803D` 텍스트 | 다크 `--card` hsl(222 47% 10%) ≈ #0E1526 | **3.6:1** | AA **미달** |
| `#22C55E` (green-500) 텍스트 | 다크 `--background` | **8.4:1** | AAA 통과 |
| `#22C55E` 텍스트 | 다크 `--card` | **8.0:1** | AAA 통과 |
| (참고) `#1E40AF` 새우 파랑 텍스트 | 다크 `--background` | **2.2:1** | 기존부터 미달 — **이번에 손대지 않는다**(회귀 0) |

결론과 조치:

1. **`text-brand` 를 다크 모드에서 그대로 쓰면 활성 메뉴 글자가 AA 미달이다(3.6~3.8:1).** 해결은 "텍스트용 브랜드 토큰" 하나 추가 — 새 색 계열이 아니라 같은 녹색의 밝은 톤(green-500)이고, 설계서 4장이 이미 허용한 "`--brand-soft`·`--brand-line` 류 보조 토큰" 범주다.
   ```css
   :root                           { --brand-fg: var(--brand); }
   [data-mode="agriculture"]       { --brand-fg: #15803D; }
   .dark [data-mode="agriculture"] { --brand-fg: #22C55E; }
   /* 새우(기본)는 라이트·다크 모두 --brand-fg = --brand → 결과 색상값 변화 0 */
   ```
   ```ts
   brand: { DEFAULT: "var(--brand)", hover: "var(--brand-hover)", fg: "var(--brand-fg)" }
   ```
   **글자·아이콘 색은 `text-brand-fg`**, 면 색(`bg-brand`, 흰 글자 위)은 `bg-brand` 그대로. 사이드바·하단 네비·더보기 시트의 활성 항목(`text-[#1E40AF]` → `text-brand-fg`), 로고 태그라인, 농업 뷰의 섹션 아이콘·링크가 대상이다. 이 문서 1~6장의 `text-brand` 는 전부 `text-brand-fg` 로 읽는다.
2. `bg-brand/10 border-brand/25` 활성 배경은 다크에서 카드와 거의 같은 명도라 글자 대비에 영향이 없다(위 표의 card 값과 동일하게 본다).
3. `bg-brand-hover` 위 흰 글자는 3.3:1 — 버튼 라벨은 `text-sm font-medium` 이상이고 hover 는 일시 상태라 허용하되, **ModeSwitch 활성 칸에는 hover 색을 적용하지 않는다**(2-1). CTA 버튼 hover 는 그대로.
4. 상태색은 `AGRI_STATUS_STYLES` 가 이미 `-600 dark:-400` 으로 다크를 따로 맞춰 두었다. 농업 뷰에서 상태 텍스트를 `text-emerald-600` 처럼 단일 톤으로 적지 말고 **반드시 스타일 객체를 쓴다**.
5. 차트 선 색(`AGRI_PARAMS.color`)은 500 톤이라 다크 카드 위에서 전부 4:1 이상. 레시피 밴드 `#34d399` 8% 는 라이트/다크 모두 배경 침범 없음(기존 운영 확인).
6. 태양 검수 절차: 다크 전환 → `/daumlabs/dashboard` 사이드바 활성 항목 글자를 DevTools 로 추출 → `#22C55E` 인지, 그리고 `/dashboard`(새우)에서는 `#1E40AF` 그대로인지 확인.

---

## 8. 담당별 체크리스트

**서연-1 (1단계)**
- [ ] `ModeSwitch` `size="sm"|"lg"`, 2-1 누름 규칙 3가지, `aria-pressed`·`role="group"`.
- [ ] 헤더 `hidden sm:inline-flex`, 더보기 시트 프로필 아래 `px-5`, 설정 계정 탭 맨 위 라벨+설명.
- [ ] `--brand-fg` 토큰 + `brand.fg` (7장 1). 셸 활성 글자 `text-brand-fg`.
- [ ] `AGRI_PARAMS` 에 `icon` 필드, `agriScaled()` 추가(3-4).
- [ ] `BedStatusBadge fromTank` 변환표(3-1), `AgriEmptyState tone/compact`, `AgriPageHeader actions` 320px 전폭.
- [ ] `common.ts`·`nav.ts` 에 6-0 키.

**서연-2 (2A)** — 5-1~5-5, `home.ts`·`record.ts`·`dashboard.ts`
- [ ] 홈·허브는 `AgriPageHeader` 미사용(가운데 정렬). 나머지는 사용.
- [ ] 측정 폼 null 규칙 표(5-3) 그대로. StepWizard 는 고치지 않는다.
- [ ] `agri-journal-constants.ts` 로 양액·자재 종류 상수 복제.
- [ ] 대시보드 베드 카드: 12개 초과 시 최신값 조회 생략. 선택 베드가 양액 상태·차압·센서 구역을 바꾼다.
- [ ] `ocean-*`·hex·새우 어휘 0건 (`rg "ocean-|#1E40AF|수조|입식|염도|암모니아|사육" components/agri`).

**서연-3 (2B)** — 5-6~5-7, `nutrient.ts`·`journal.ts`, `components/agri/charts/*`
- [ ] 탭 6개 = `AGRI_PARAMS` 순서, "더보기" 없음. y 값 mS/cm 환산, µS/cm 화면 노출 0.
- [ ] 레시피선 3줄+밴드(2×tol 없음). 레시피 없으면 pH·온도·DO 는 표준 밴드, EC·유량·차압은 선 0.
- [ ] 전체화면·전광판: `Escape`, body 스크롤 잠금, 15초 순환(데이터 없는 탭 건너뜀), `big` 상단 수치 줄, 진행 바.
- [ ] CSV 미측정 = 빈 셀.
- [ ] 일지 4타일 네 번째 색 `violet-500`. 진단·측정 동시 입력 없음.

**서연-4 (2C)** — 5-8, `farms.ts`, `components/agri/farms/*`
- [ ] Add 농장은 유형 필드 없이 `agriculture` 고정, Edit 는 2택 + 안내 한 줄 + 이동 토스트.
- [ ] `RecipeFields` 농업판 재작성(선행 시안 §6-2 수치), 아이콘 `text-brand-fg`.
- [ ] 베드 카드 타일 2~4칸 가변, 레시피 요약 줄, `BedStatusBadge fromTank`.
- [ ] `BedDeviceList` — 로직은 `lib/db` 함수만, `PairDeviceDialog` 그대로 import.
- [ ] 교차 링크("양식장 화면 열기") 없음.

**태양 (4단계)** — 설계서 10장에 더해
- [ ] 7장 표의 다크 모드 값 2개(`#22C55E` 농업 / `#1E40AF` 새우 유지) 실측.
- [ ] 320px 에서 8개 화면 가로 스크롤 0(센서 칩 줄 제외).
- [ ] 모든 아이콘 전용 버튼 `aria-label` 존재, 토글 `aria-pressed`.
