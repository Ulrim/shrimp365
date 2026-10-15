# 모드 분리 설계서 — 양식장(Shrimp) / 스마트팜(Agriculture) 완전 분리

- 작성: 민준 (PM·아키텍트)
- 작성일: 2026-10-15
- 상태: 설계 확정 → 서연(1단계 기반) ∥ 수아(UI 시안) → 서연×3(2단계 농업 화면) → 서연(3단계 새우 정리) → 태양(검수)
- 선행 문서: `agriculture-mode.md`(개정 1, URL 축), `agriculture-mode-ui.md`(수아 초판 시안)

## 1. 왜 다시 설계하는가

개정 1은 "화면을 두 벌 만들지 않는다"를 원칙으로, **같은 뷰 컴포넌트를 두 URL 트리가
공유**하고 한국어 사전만 덮어써(`agri-ko.ts`, 수조→베드) 농업 화면을 만들었다.
베타로는 충분했지만 지금은 한계가 드러났다.

| 증상 | 수치 |
|---|---|
| 공유 뷰 안의 `isAgri` 분기 | `water-quality-view.tsx` 53곳, `farms-view.tsx` 47곳, `journal-view.tsx` 37곳, `dashboard-view.tsx` 24곳 — **총 310곳 / 27파일** |
| 공유 뷰 크기 | 수질 1,845줄 · 농장 1,916줄 · 일지 1,522줄 |
| 다국어 | 농업 오버라이드가 한국어뿐 → 영어·베트남어·인니어 사용자는 농업 화면에서 "Tank"·"Salinity"를 본다 |
| 사용자 체감 | 모드가 URL에만 있어 전환 스위치가 없고, 로그인마다 `/home` 교정에 의존 |

사용자 지시: **모드 자체를 아예 나누고, 전환 스위치를 두고, 농업 화면은 전부 따로 만든다.**

### 사용자 결정 (2026-10-15 확인)

1. **모드 저장 = 계정 설정** (`profiles.ui_mode`). 전환 스위치로 바꾸고 로그인 시 그 모드로 착지.
2. **측정 범위 = 지금 센서 데이터** — EC·pH·양액온도·DO·유량·차압 + 베드 레시피. 환경 센서(온습도·CO₂·광량) 자리는 두지 않는다.
3. **브랜드 = Shrimp365 유지 + 농업 테마** — 로고·이름 그대로, 태그라인·강조색(파랑→녹색)·아이콘만 농업용.

### 절대 원칙 (개정 1에서 이어받음)

- **새우 화면 회귀 0.** 기존 URL·화면·동작 그대로. 이번에 새우 뷰에서 하는 일은 농업 분기를 **빼는 것**뿐이다.
- **서버 수신·알림(`app/api/sensors/data/route.ts`, `lib/thresholds.ts`)은 건드리지 않는다.** 판정 축은 데이터(tank 레시피·farm_type)이고 화면 모드와 무관하다.
- **장비 프로그램(`raspberry-pi/`)은 이번 범위 밖.** 이미 `ec_mode`·`nutrient_plan`이 있다.

## 2. 두 축 — 계정 모드와 화면 URL

```
profiles.ui_mode   = "이 계정의 기본 모드"      (shrimp | agriculture)   ← 전환 스위치가 저장
URL(/daumlabs/**)  = "지금 보고 있는 화면"      (isAgriPath)             ← 렌더링 판정
farms.farm_type    = "이 농장이 무엇인가"       (데이터)                 ← 목록 필터·폼 분기
```

- **렌더링 판정은 계속 URL이다.** 개정 1의 근거(주소가 화면을 말해 준다, 첫 페인트가 옳다, 혼합 계정 출구)는 그대로 유효하다. `/daumlabs` 접두사도 유지한다(농가에 이미 안내된 주소).
- `ui_mode`가 하는 일은 둘뿐이다: (a) `/home` 진입 시 착지 결정, (b) 전환 스위치의 저장값.
  개정 1의 "전 농장이 agriculture면 자동 이동" 규칙은 **`ui_mode`로 대체**한다(온보딩에서 유형을 고를 때 함께 저장하므로 결과는 같고, 혼합 계정도 자기 뜻대로 정할 수 있다).
- 스위치가 보여 주는 활성 상태는 **URL 기준**이다(지금 보는 화면). 누르면 `ui_mode` 저장 → 상대 화면으로 이동.

### 2-1. DB

`supabase/migrations/profiles_ui_mode.sql` (사람이 SQL Editor에서 실행):

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ui_mode TEXT NOT NULL DEFAULT 'shrimp';
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_ui_mode_check
    CHECK (ui_mode IN ('shrimp', 'agriculture'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- 기존 농업 전용 계정은 농업 모드로 시작하게 한다(농장이 전부 agriculture 인 사용자).
UPDATE public.profiles p SET ui_mode = 'agriculture'
WHERE EXISTS (SELECT 1 FROM public.farms f WHERE f.user_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM public.farms f WHERE f.user_id = p.id AND f.farm_type <> 'agriculture');
NOTIFY pgrst, 'reload schema';
```

- RLS: profiles 는 이미 본인 행 UPDATE 가 허용돼 있다(`updateProfile(name)`이 그 경로). 추가 정책 없음.
- **마이그레이션 전 DB 호환**: `fetchProfile`이 `ui_mode` 컬럼 부재(42703)를 만나면 `'shrimp'`로 간주하고, `updateUiMode`는 실패를 삼키고 경고만 남긴다. 화면은 URL로 계속 동작한다.

### 2-2. 클라이언트

- `lib/auth-context.tsx`: `AppUser.ui_mode: UiMode`, `updateUiMode(mode)` 추가. `fetchProfile`의 select 에 `ui_mode` 추가(실패 시 두 번째 select 로 폴백 — `sensor_device_location` 패턴).
- `lib/agri-route.ts` → 유지하되 확장:
  ```ts
  export type UiMode = "shrimp" | "agriculture"
  export function modeOfPath(pathname: string): UiMode        // isAgriPath ? agriculture : shrimp
  export function counterpartHref(pathname: string, to: UiMode): string
  //  /dashboard ↔ /daumlabs/dashboard (AGRI_ROUTES 에 있으면 1:1), 없으면 /home ↔ /daumlabs/home
  export function useUiMode(): { current: UiMode; saved: UiMode; switchTo(mode: UiMode): Promise<void> }
  //  current = URL, saved = user.ui_mode, switchTo = updateUiMode + router.push(counterpartHref)
  ```
  `belongsToAgriScreen`은 3단계에서 제거한다(새우 뷰는 `farm_type !== "agriculture"` 필터, 농업 뷰는 `=== "agriculture"` 필터를 각자 가진다).
- `components/home/home-view.tsx` (새우 홈): `!isAgri && user.ui_mode === "agriculture"` → `router.replace("/daumlabs/home")`. 기존 farm_type 전수 규칙은 삭제.
- `app/onboarding/page.tsx`: 완료 시 `farmType === "agriculture"` 면 `updateUiMode("agriculture")` 후 `/daumlabs/home`.

## 3. 전환 스위치 (`components/layout/mode-switch.tsx`)

세그먼트 토글 2칸. 왼쪽 `Waves` "양식장", 오른쪽 `Sprout` "스마트팜". 활성 칸은 `bg-brand text-white`.

| 위치 | 형태 |
|---|---|
| 헤더 우측(검색 버튼 왼쪽), `sm` 이상 | 아이콘+라벨 세그먼트 |
| 하단 네비 "더보기" 시트 프로필 행 아래 | 전체 폭 세그먼트 |
| 설정 패널 계정 탭 맨 위 | 라벨 "기본 화면" + 세그먼트 + 한 줄 설명 "로그인하면 이 화면으로 시작합니다." |

동작: `switchTo(mode)` → 저장 → `counterpartHref` 로 `router.push`. 저장 실패해도 이동은 한다(URL이 화면을 결정).
라벨은 `agriDict.common.modeShrimp / modeAgri` (4개 언어). 접근성: `role="group" aria-label`, 각 칸 `aria-pressed`.

## 4. 테마 — 강조색 토큰화

지금 셸은 `#1E40AF`를 74곳에 하드코딩한다. 농업 테마를 넣으려면 **대시보드 셸의 강조색을 토큰으로** 빼야 한다.

```css
/* app/globals.css */
:root            { --brand: #1E40AF; --brand-hover: #3B82F6; }
[data-mode="agriculture"] { --brand: #15803D; --brand-hover: #16A34A; }
```
```ts
// tailwind.config.ts  colors.extend
brand: { DEFAULT: "var(--brand)", hover: "var(--brand-hover)" }
```
- Tailwind v4 는 불투명도 수식어를 `color-mix` 로 처리하므로 `bg-brand/10`·`border-brand/25` 가 CSS 변수에도 동작한다. **빌드 후 생성 CSS 에서 `.bg-brand\/10` 이 color-mix 로 나오는지 확인**할 것(안 되면 `--brand-soft`·`--brand-line` 토큰을 따로 둔다).
- `data-mode` 는 `app/(dashboard)/layout.tsx` 최상위 div 에 `modeOfPath(pathname)` 으로 붙인다. 설정·알림·검색 패널은 그 하위에 렌더되므로 함께 물든다.
- **치환 범위는 대시보드 셸만**: `sidebar.tsx`, `header.tsx`, `bottom-nav.tsx`, `settings-panel.tsx`, `(dashboard)/layout.tsx` 스피너, `home-view.tsx`. 랜딩·게시판·카드뉴스·관제센터·`brand-mark.tsx` 는 손대지 않는다(공개 화면은 항상 파랑).
- 농업 테마에서 로고 마크(물방울)는 그대로, 태그라인만 `SMART HYDROPONICS`.

## 5. 농업 전용 화면 — `components/agri/`

`/daumlabs/**` 8개 페이지는 공유 뷰 대신 **전용 뷰**를 렌더한다. 페이지 파일은 3줄 래퍼 그대로, import 만 바뀐다.

| URL | 전용 뷰 | 내용 (수아 시안이 상세 확정) |
|---|---|---|
| `/daumlabs/home` | `agri-home-view.tsx` | 인사, 오늘 베드 현황(위험/주의/정상), 기록하기·현황 보기 카드. `farm_type === "agriculture"` 수조·알림만 |
| `/daumlabs/record` | `agri-record-hub-view.tsx` | 측정 기록 / 영농 일지 2택 |
| `/daumlabs/record/water-quality` | `agri-measure-record-view.tsx` | 베드 선택 → EC(mS/cm)·pH·양액온도·DO·유량·차압 입력. 빈 칸=null, EC 0=null (`agri-standards.ts`) |
| `/daumlabs/record/journal` | `agri-journal-record-view.tsx` | 양액 보충/교환/방제/수확/설비 점검 |
| `/daumlabs/dashboard` | `agri-dashboard-view.tsx` | 농장·베드 수, 미처리 알림, 베드 카드(EC·pH·온도 타일 + 상태), `NutrientStatusCard`, `DeviceCurrentValues`, 최근 알림 |
| `/daumlabs/water-quality` | `agri-nutrient-view.tsx` | **양액 관리**: 베드·센서 선택, 기간, 탭 EC(기본)→pH→양액온도→DO→유량→차압, 레시피 목표선·허용밴드, 센서 비교, CSV, 전체화면 |
| `/daumlabs/journal` | `agri-journal-view.tsx` | 영농 일지 목록·필터·수정·삭제 |
| `/daumlabs/farms` | `agri-farms-view.tsx` | 농장(위치·지도) · 베드(유형·양액조 용량·정식일·수확 예정·레시피) · 기기 연결(`PairDeviceDialog`)·업데이트 |

**재사용하는 기존 조각** (수정 없이 import): `components/sensors/pair-device-dialog.tsx`,
`device-current-values.tsx`, `nutrient-status-card.tsx`(3단계에서 `isAgri` 조건만 제거),
`components/farms/farm-map.tsx`, `coordinate-field.tsx`, `components/ui/*`,
`lib/db.ts` 전부, `lib/agri-standards.ts`, `lib/thresholds.ts`(`AGRI_THRESHOLDS`, `alertDisplayLabel(.., "agriculture")`).

**농업 뷰가 지키는 규칙**
- 데이터 필터는 뷰 안에서 `farm_type === "agriculture"` 한 줄. 새우 농장은 보이지 않는다. 농업 농장이 0개면 빈 상태 + "농장 등록하기"(→ `/daumlabs/farms`).
- 수조·입식·사육일·염도·암모니아 등 새우 어휘·필드를 **코드에 두지 않는다**. 데이터 모델 이름(`tank`, `tank_id`)은 그대로 쓰되 화면 라벨은 전부 농업 사전.
- 0의 뜻은 `agriIsMissing()` 한 곳에 맡긴다(유량 0 = 펌프 정지는 실측).
- 전역 EC 기준선을 긋지 않는다. 레시피가 있을 때만 목표선+밴드.
- 링크는 `/daumlabs/...` 리터럴로 쓴다(`agriHref` 불필요 — 이 뷰는 농업 화면에서만 렌더된다).

### 5-1. 공통 조각 (1단계에서 먼저 만든다 — 2단계 에이전트 셋이 함께 쓴다)

- `lib/agri-params.ts` — 6개 항목 메타 한 벌:
  `AGRI_PARAMS: { key, dictKey, unit, digits, scale, color }[]`
  (conductivity→mS/cm ÷1000 2자리 `#0ea5e9`, ph 2자리 `#8b5cf6`, temperature °C 1자리 `#f59e0b`, do_level ppm 1자리 `#14b8a6`, flow_rate L/min 1자리 `#6366f1`, diff_pressure kPa 1자리 `#f43f5e`).
  `agriFormat(key, value)` → `"—"` 또는 숫자 문자열(`agriIsMissing` 사용).
- `components/agri/bed-status-badge.tsx` — `AgriStatusLevel`(정상/주의/위험/미측정/기준 없음) 배지, 색+텍스트 병기, 주의·위험만 pulse.
- `components/agri/agri-page-header.tsx` — 제목·부제·우측 액션 슬롯(모든 농업 페이지 상단 통일).
- `components/agri/agri-empty-state.tsx` — 아이콘·제목·설명·CTA.

## 6. 농업 사전 — `lib/i18n/agri/` (4개 언어, 섹션별 파일)

기존 `agri-ko.ts`(한국어 오버라이드)는 3단계에서 삭제한다. 농업 뷰는 **자기 사전**을 읽는다.

```
lib/i18n/agri/
  index.ts      ← agriDict(locale): AgriDict  (민준이 만든다. 아무도 고치지 않는다)
  common.ts     ← 모드 라벨, 베드/농장 공통 어휘, 상태 라벨, 단위          (1단계 서연)
  nav.ts        ← 사이드바·하단 메뉴 라벨, 헤더 제목, 태그라인              (1단계 서연)
  home.ts  dashboard.ts  record.ts   (2A)
  nutrient.ts  journal.ts            (2B)
  farms.ts                           (2C)
```

각 파일은 **자기 타입 + 4개 언어 레코드**를 함께 export 한다. 다른 파일을 건드릴 일이 없어 세 에이전트가 동시에 작업해도 충돌이 없다.

```ts
// lib/i18n/agri/home.ts
import type { Locale } from "@/lib/i18n"
export interface AgriHomeDict { greetingSubtitle: string; bedsToday: string; /* … */ }
export const agriHome: Record<Locale, AgriHomeDict> = { ko: {…}, en: {…}, vi: {…}, id: {…} }
```

훅: `useAgriT()` (`lib/i18n-context.tsx`에 추가) → `agriDict(locale)`. 공용 UI 문구(저장·취소·날짜·시간)는 기존 `useT().t.common / t.time` 을 그대로 쓴다 — 중복 번역 금지.

**번역 품질**: ko 는 농업 용어(베드·양액·정식·EC)로, en 은 hydroponics 어휘(bed, nutrient solution, transplant), vi/id 는 en 기준 번역. 자리표시자는 기존 관례 `{{name}}`.

## 7. 새우 화면 정리 (3단계 — 2단계가 끝난 뒤)

`/daumlabs/**` 가 더는 공유 뷰를 쓰지 않으므로, 공유 뷰는 **새우 전용**이 된다.

- `useAgriRoute`·`isAgri`·`belongsToAgriScreen`·`agriHref`·`AGRI_HIDDEN_NAV` 참조를 8개 뷰에서 제거. 농장·수조·알림 목록은 `(farm_type ?? "shrimp") !== "agriculture"` 로 필터(혼합 계정 보호).
- `water-quality-view.tsx`: 농업 탭 순서·레시피선·`AGRI_PARAM_META`·EC mS/cm 분기 제거. `conductivity` 탭은 `hasConductivity` 조건으로 새우에서도 유지(기존 동작).
- `farms-view.tsx`: `isAgriFarm` 폼 분기·`RecipeFields`·"수경재배 화면 열기" 버튼 제거. 농장 추가/수정 폼의 **유형 선택은 남긴다**(농업 농장을 새우 화면에서 만들면 `/daumlabs/farms` 로 안내하는 토스트 1줄).
- `dashboard-view.tsx`·`journal-view.tsx`·`home-view.tsx`·`record/*`: 같은 방식.
- `lib/i18n-context.tsx`: `AgriDictOverride` 삭제, `(dashboard)/layout.tsx` 에서 래퍼 제거. `lib/i18n/agri-ko.ts` 삭제. `types.ts` 의 `DictOverride` 는 다른 사용처가 없으면 함께 삭제.
- `nutrient-status-card.tsx`: `isAgri` 조건 삭제(농업 대시보드에서만 렌더됨).
- `app/onboarding/page.tsx` 의 `mergeDict(baseT, agriKo)` → `useAgriT()` 로 교체.
- 제거 뒤 `rg "isAgri|agriKo|AgriDictOverride|belongsToAgriScreen" components app lib` 결과가 `components/agri/**`·`lib/agri-route.ts` 밖에서 0건이어야 한다.

## 8. 단계·담당·파일 소유권

병렬 작업의 충돌 방지 원칙: **한 파일은 한 단계의 한 에이전트만 고친다.** 아래 표 밖의 파일을 고쳐야 하면 멈추고 보고한다.

| 단계 | 담당 | 소유 파일 |
|---|---|---|
| **1. 기반** | 서연-1 | `supabase/migrations/profiles_ui_mode.sql`, `lib/auth-context.tsx`, `lib/agri-route.ts`, `lib/agri-params.ts`, `lib/i18n-context.tsx`(useAgriT 추가만), `lib/i18n/agri/{common,nav}.ts`, `components/layout/{mode-switch,sidebar,header,bottom-nav,settings-panel}.tsx`, `app/(dashboard)/layout.tsx`, `app/globals.css`, `tailwind.config.ts`, `components/agri/{bed-status-badge,agri-page-header,agri-empty-state}.tsx`, `components/home/home-view.tsx`(착지 규칙만), `app/onboarding/page.tsx`(ui_mode 저장만), `types/index.ts`(User.ui_mode) |
| **UI 시안** (1과 병렬) | 수아 | `docs/plans/mode-split-ui.md` 만 |
| **2A** | 서연-2 | `components/agri/agri-{home,record-hub,measure-record,journal-record,dashboard}-view.tsx`, `lib/i18n/agri/{home,dashboard,record}.ts`, `app/(dashboard)/daumlabs/{home,dashboard,record,record/*}/page.tsx` |
| **2B** | 서연-3 | `components/agri/agri-{nutrient,journal}-view.tsx`, `components/agri/charts/*`, `lib/i18n/agri/{nutrient,journal}.ts`, `app/(dashboard)/daumlabs/{water-quality,journal}/page.tsx` |
| **2C** | 서연-4 | `components/agri/agri-farms-view.tsx`, `components/agri/farms/*`, `lib/i18n/agri/farms.ts`, `app/(dashboard)/daumlabs/farms/page.tsx` |
| **3. 새우 정리** | 서연-5 | 7장의 공유 뷰 8개, `lib/i18n-context.tsx`, `lib/i18n/agri-ko.ts`(삭제), `lib/agri-route.ts`(불용 함수 삭제), `components/sensors/nutrient-status-card.tsx`, `app/onboarding/page.tsx` |
| **4. 검수** | 태양 | 수정 없음 — 10장 체크리스트 |

2단계 셋은 `lib/i18n/agri/index.ts` 를 고치지 않는다(민준이 섹션 import 를 미리 적어 둔다). 공통 조각이 모자라면 **자기 폴더 안에** 만든다.

## 9. 하지 말 것

- `/daumlabs` 접두사 변경·`next.config` rewrite 금지.
- 공유 뷰(새우)를 복사해 농업 뷰를 만들지 말 것 — 농업 뷰는 6개 항목만 다루므로 훨씬 작아야 정상이다.
- `farms.farm_type`·tank 레시피 컬럼·`route.ts`·`thresholds.ts` 변경 금지.
- 랜딩·게시판·카드뉴스·관제센터·관리자 화면의 색·문구 변경 금지.
- 새 색을 만들지 말 것 — 농업 강조색은 `brand` 토큰(녹색)과 기존 emerald/amber/red 상태색만.
- `localStorage` 에 모드를 저장하지 말 것(기기마다 달라진다 — 계정에 저장한다).

## 10. 검수 체크리스트 (태양)

1. `npm run build` 통과, `/daumlabs/*` 8개 라우트 존재, `/daumlabs/production` 404.
2. 새우 계정(`ui_mode=shrimp`): 로그인 → `/home`. 8개 새우 화면이 변경 전과 동일(라벨·링크·차트). 셸 색만 토큰으로 바뀌었고 결과 색상값은 동일(`#1E40AF`).
3. 스위치: 헤더·더보기 시트·설정 패널 3곳 모두 동작. `/dashboard` 에서 누르면 `/daumlabs/dashboard`, `/production` 에서 누르면 `/daumlabs/home`. 되돌리기도 1:1.
4. 농업 모드 셸: 녹색 강조, 태그라인 `SMART HYDROPONICS`, 메뉴 7개(홈·측정 기록·영농 일지·모니터링·양액 관리·영농 일지·농장·기기 관리)+공통(게시판·카드뉴스·관제·관리자·도움말).
5. 농업 8개 화면: 새우 어휘(수조·입식·염도·암모니아·사육일) 0건 — `rg` 로 `components/agri` 검색. 4개 언어 전환 시 모두 농업 어휘.
6. 혼합 계정: 새우 화면엔 새우 농장만, 농업 화면엔 농업 농장만. 알림도 같은 축.
7. 마이그레이션 전 DB 시뮬레이션(`ui_mode` select 실패): 로그인·전환·화면 모두 동작(저장만 안 됨).
8. `rg "isAgri|agriKo|AgriDictOverride|belongsToAgriScreen|agriHref" components app lib` → `components/agri/**`·`lib/agri-route.ts` 밖 0건.
9. 서버 수신·알림 경로 diff 0 (`git diff --stat app/api lib/thresholds.ts` 비어 있음).
10. 라이트·다크 모두에서 녹색 테마 대비 확인(활성 메뉴 텍스트 AA).

## 11. 사람 몫 (완료 보고에 포함)

- `profiles_ui_mode.sql` 실행(Supabase SQL Editor). 실행 전에도 웹은 동작하되 전환이 저장되지 않는다.
- 농가 안내: 농업 사용자는 로그인 후 자동으로 스마트팜 화면. 화면 전환은 헤더 스위치.
