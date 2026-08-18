# 농업 모드(Agriculture Mode) 설계서 — 쪽파 스마트 수경재배 IoT 대시보드 베타

- 작성: 민준 (PM·아키텍트)
- 작성일: 2026-08-18
- 상태: 설계 확정 → 수아(UI) → 서연(구현) → 태양(리뷰)

**개정 이력**

- 2026-08-18 초판 — `farms.farm_type` 기반 전역 UI 모드 자동 판별.
- 2026-08-18 **개정 1 (이 문서)** — 모드 판정 축을 `farm_type` → **URL(`/daumlabs`)** 로
  교체. 3장(모드 결정)·4장(라우트와 화면)·5장(진입 라우팅) 개정, 나머지 장(센서 6종,
  레시피 알림, 양액 카드, DB)은 유효하므로 유지.

## 1. 배경과 요구

이 작업은 **"쪽파 연중 생산을 위한 올인원 스마트 수경재배 모듈 키트" 사업의
IoT 웹 대시보드 베타**다. EC 측정 하드웨어(라즈베리파이 센서)를 쪽파(엽채류)
NFT 다단 베드 수경재배 농가가 사용한다. 시스템 구성: 양액 재순환, 근권부 냉방
칠러, UV 살균기.

사용자 요구:

1. **계정은 기존 Shrimp365와 연동** — 별도 앱·별도 회원 체계를 만들지 않는다.
2. **보이는 화면만 농업에 맞춘다** — 메뉴·용어·기본 지표를 수경재배 문맥으로.
3. **필수 기능**:
   - 모니터링 기기 연결
   - 실시간 데이터 표시 — 센서 6종: **EC, pH, 수온, DO, 유량, 차압(ΔP)**
   - 이력 그래프(시각화)
   - **이상감지 알림 — EC 제어 정확도 목표 ±0.1 dS/m(=±0.1 mS/cm=±100 µS/cm),
     베드별 기준값(레시피) 이탈 시 알림**
   - **양액 EC/pH 기준값(레시피) 대비 표시** — 기존 "양액 EC 관리(보충량 자동
     계산)"를 농업 모드의 핵심 기능으로 전면 배치
4. **(개정 1에서 추가) 수경재배 화면은 별도 URL을 가진다** — 법인명 다움랩스의
   표준 로마자 표기를 따라 **`/daumlabs`**. 계정 유형에 따라 화면이 몰래 바뀌는
   것이 아니라, **주소를 보면 어느 화면인지 알 수 있어야 한다.**

### 절대 원칙

- **새우 양식 사용자에게는 픽셀 하나 변하지 않는다.** 기존 URL(`/home`,
  `/dashboard`, `/water-quality`, `/journal`, `/record/*`, `/farms` …)은
  주소도 화면도 그대로다. 회귀 0.
- **기능은 최대한 재활용한다.** 아래 2장에서 확인했듯 핵심 배관은 전부 이미 있다.
  신규는 (a) URL 분기·라벨, (b) 유량·차압 2개 항목, (c) 베드별 레시피와 이탈
  알림, (d) 보충량 계산값의 웹 표출 — 이 넷뿐이다.
- **화면을 두 벌 만들지 않는다.** 같은 화면 컴포넌트를 두 URL 트리가 공유한다
  (4-1). 페이지 컴포넌트 복사는 금지.

## 2. 현황 — 이미 있는 것 (재활용 자산)

| 요구 | 이미 있는 구현 | 위치 |
|---|---|---|
| 기기 연결 | 6자리 코드 페어링 (TV 방식) | `components/sensors/pair-device-dialog.tsx`, `supabase/migrations/sensor_pairing.sql`, `app/(dashboard)/farms/page.tsx` (956행에서 사용) |
| 실시간 데이터 표시 | 기기별 마지막 수신값 카드 — **payload 기반이라 키만 추가하면 어떤 항목이든 표시됨** | `components/sensors/device-current-values.tsx` (payloadLabels), `app/(dashboard)/dashboard/page.tsx` (387행) |
| EC 시각화 | 전도도 이력·그래프 (µS/cm, 구간 평균 `wq_series`) | `app/(dashboard)/water-quality/page.tsx` (ConductivityChart), `supabase/migrations/wq_conductivity.sql` |
| pH·수온·DO | 측정·저장·그래프·임계값 알림 전부 있음 | 같은 파일들 + `lib/thresholds.ts` |
| 측정 항목 선택 | 장비 쪽 `ec_mode` (염도/전도도) | `raspberry-pi/shrimp365_sensor.py`, `config.example.ini` |
| 양액 보충량 계산 | **쪽파 수경재배 환산표 그대로 이식됨** (`nutrient_plan`, 528행~). 목표 EC·원수 EC·교정값으로 A/B 보충량(mL)·교환량(L) 계산. ATC 온도보정 포함. 단, 현재는 장비 로컬 화면(webui)에만 표시 | `raspberry-pi/shrimp365_sensor.py` 528~600행, `raspberry-pi/webui.py` 952행~ |
| 이상감지 알림 배관 | 수신 시 임계값 체크 → alerts 생성·중복 억제·자동 해제 → 수조 상태 갱신 | `app/api/sensors/data/route.ts` 230~293행 |
| 오프라인 버퍼 | 미연결·통신 두절 시 로컬 보관 후 일괄 전송 | `raspberry-pi/shrimp365_sensor.py` 1864행~ |
| **한 화면을 두 URL 트리가 공유하는 패턴** | `/board`(한국어)와 `/[lang]/board`(다국어)가 `components/board/board-list-view.tsx` 하나를 공유. 페이지 파일은 얇은 래퍼 | `app/board/page.tsx`, `app/[lang]/board/page.tsx`, `components/board/board-list-view.tsx` |

**핵심 관찰 세 가지**

1. 장비의 `nutrient_plan` 계산 결과는 **서버로 올라오지 않는다** — payload는
   `{**values, serial, firmware}` 뿐이다(1862행). 웹 전면 배치를 하려면 장비가
   payload에 계산 요약을 실어 보내는 것이 맞다. 교정값(원액 EC 상승폭 실측)이
   장비에만 있으므로 **계산의 진실은 장비, 웹은 표시**로 역할을 가른다.
2. `lib/thresholds.ts`의 임계값은 흰다리새우 해수 기준 전역 상수다. 염도 주석에
   "농장별 설정이 생기기 전까지"라는 한계가 이미 적혀 있다. 이번에 만드는
   베드별 레시피가 바로 그 "농장별 설정"의 첫 사례다. conductivity는 현재
   임계값 체크 대상이 아니다 → EC 이탈 알림은 신규 로직.
3. `sanitizePayload`(route.ts 31행)는 임의 숫자 키를 32개까지 `last_payload`에
   저장한다 → 장비가 새 키를 보내면 **서버 수정 없이도** 현재값 카드에 띄울
   기반이 이미 있다.

### 관련 데이터 모델 (supabase/schema.sql)

- `profiles` — id, name, role, plan (계정 단위)
- `farms` — user_id, name, location, owner_name, area, **farm_type** (농장 단위)
- `tanks` — farm_id, tank_type, stocking_*, **target_ec/ec_tolerance/target_ph/ph_tolerance** (수조=농업에서는 **베드** 단위)
- `water_quality_readings` — tank_id, device_id, temperature…conductivity, **flow_rate/diff_pressure**
- `sensor_devices` — tank_id, api_key, last_payload, last_seen_at

## 3. 모드 결정 방식 — **URL이 화면을 결정한다** (개정 1)

### 3-1. 결정

```
/daumlabs/**  →  농업(수경재배) 화면
그 밖의 대시보드 URL  →  기존 새우 양식 화면
```

**판정식은 이 한 줄이다.**

```ts
// lib/agri-route.ts
export const AGRI_PREFIX = "/daumlabs"
export function isAgriPath(pathname: string) {
  return pathname === AGRI_PREFIX || pathname.startsWith(AGRI_PREFIX + "/")
}
```

DB 조회 없음, 비동기 없음, 로딩 상태 없음, 깜빡임 없음.

### 3-2. 초판(farm_type 파생) 을 버리는 이유

초판은 `getFarms()` 결과로 `isAgriMode`를 파생했다. 실제로 만들어 보니 세 가지가 걸린다.

1. **주소가 화면을 말해 주지 않는다.** 같은 `/dashboard`가 계정에 따라 다른
   화면이 된다. 링크를 공유해도, 스크린샷을 받아도 어느 화면인지 알 수 없고
   문의 대응이 어렵다.
2. **혼합 계정에 출구가 없다.** 새우 농장과 수경재배 시설을 함께 가진 계정은
   초판 규칙상 영원히 새우 화면이다. 수경재배 화면을 볼 방법이 아예 없었다.
3. **첫 페인트가 항상 틀린다.** farm 목록을 받기 전까지 새우 모드로 그린 뒤
   농업 라벨로 바뀐다. 사이드바 메뉴가 로드 후 4개 줄어드는 것이 눈에 보인다.

URL 축으로 바꾸면 셋이 한 번에 사라진다.

### 3-3. `farms.farm_type` 컬럼은 남는다 — 역할만 바뀐다

전역 UI 모드 판정에서만 빠진다. 아래 세 곳에서는 계속 필요하고, 삭제하지 않는다.

| 쓰임 | 위치 | 설명 |
|---|---|---|
| **로그인 후 착지 주소 결정** | `/home` 진입 시 1회 (5-2) | 전부 수경재배 농장이면 `/daumlabs/home`으로 넘긴다 |
| **온보딩 유형 선택 → 완료 후 이동** | `app/onboarding/page.tsx` | 수경재배를 고르면 완료 후 `/daumlabs/home` |
| **폼 분기·데이터 의미** | `app/(dashboard)/farms/page.tsx` | 농장 유형 선택, 베드 레시피 입력 노출, 화면 전환 진입점(5-4) |

즉 **farm_type = "이 농장이 무엇인가"(데이터), URL = "지금 무엇을 보고 있는가"(화면)**.
둘을 잇는 다리는 로그인 직후 한 번, 그리고 `/farms`의 전환 버튼뿐이다.

## 4. 라우트 구성과 화면

### 4-1. 라우트 구성 방식 — **route group 안의 실제 디렉토리**

읽은 문서(Next.js 16.2.4, `node_modules/next/dist/docs/`):

- `01-app/01-getting-started/03-layouts-and-pages.md` — 파일시스템 라우팅, 중첩
  레이아웃, `PageProps`/`LayoutProps` 타입 헬퍼(typegen)
- `01-app/03-api-reference/03-file-conventions/route-groups.md` — `(folder)`는
  URL에 포함되지 않는 조직용 규약. 서로 다른 그룹이 같은 URL로 해석되면 에러
- `01-app/01-getting-started/16-proxy.md`, `.../file-conventions/proxy.md` —
  **Next 16부터 `middleware`는 `proxy`로 개명·deprecated.** "Proxy는 최후의
  수단으로 쓰라"고 문서가 명시
- `01-app/02-guides/authentication.md#optimistic-checks-with-proxy-optional` —
  "Proxy는 프리페치를 포함해 모든 라우트에서 돈다. 쿠키만 읽고 **DB 조회는 하지
  마라**"

**결정: (a) 실제 디렉토리.** 위치는 기존 route group 안이다.

```
app/(dashboard)/
├── layout.tsx            ← 인증 가드 + 셸(사이드바·헤더·바텀네비). 그대로 재사용
├── loading.tsx  error.tsx ← 그대로 재사용
├── home/page.tsx          → /home              (새우, 무변)
├── dashboard/page.tsx     → /dashboard         (새우, 무변)
│   …
└── daumlabs/
    ├── home/page.tsx                   → /daumlabs/home
    ├── record/page.tsx                 → /daumlabs/record
    ├── record/water-quality/page.tsx   → /daumlabs/record/water-quality
    ├── record/journal/page.tsx         → /daumlabs/record/journal
    ├── dashboard/page.tsx              → /daumlabs/dashboard
    ├── water-quality/page.tsx          → /daumlabs/water-quality
    ├── journal/page.tsx                → /daumlabs/journal
    └── farms/page.tsx                  → /daumlabs/farms
```

`(dashboard)`는 URL에 나타나지 않으므로 `/daumlabs/...`가 그대로 주소가 되고,
**인증 가드·셸·loading·error 를 새우 쪽과 100% 공유**한다. 별도 layout 파일을
만들 필요가 없다.

**중복 없이 화면을 공유하는 법** — 기존 `/board` ↔ `/[lang]/board` 패턴을 그대로
쓴다. 페이지 본문을 뷰 컴포넌트로 옮기고, 두 페이지 파일은 3줄 래퍼가 된다.

```tsx
// app/(dashboard)/home/page.tsx  와  app/(dashboard)/daumlabs/home/page.tsx  둘 다
import { HomeView } from "@/components/home/home-view"
export default function Page() { return <HomeView /> }
```

- 뷰 컴포넌트는 옮기기만 한다(`"use client"` 유지, import는 전부 `@/` 별칭이라
  경로 수정 불필요 — 확인함). **로직 변경 0** 이 회귀 0의 근거다.
- 페이지 래퍼는 `"use client"`를 붙이지 않는다(서버 컴포넌트가 클라이언트 뷰를
  렌더). 파일 이름·폴더는 기존 컨벤션(`components/<기능>/<이름>-view.tsx`)을 따른다.

**기각한 대안**

| 후보 | 기각 사유 |
|---|---|
| (b) route group + rewrite | `next.config` rewrite는 주소와 라우트가 어긋나 프리페치 단위·타입 헬퍼·404 제어가 흐려진다. 숨김 메뉴를 404로 만들려면 와일드카드가 아니라 경로를 하나씩 나열해야 해서 결국 (a)와 선언 개수가 같은데 이득이 없다. proxy 단 rewrite는 Next 16이 스스로 "최후 수단"이라고 못 박았다 |
| (c) 동적 세그먼트 `daumlabs/[[...slug]]` | 8개 화면이 라우트 하나로 뭉쳐 존재하지 않는 경로의 404를 손으로 만들어야 하고, loading/error 경계와 프리페치 단위가 사라진다. 정적 라우트로 두면 typegen이 `PageProps<'/daumlabs/home'>`까지 만들어 준다 |
| 페이지 컴포넌트 복사 | 논외. 두 벌을 따로 고치는 순간 화면이 갈라진다 |

### 4-2. `/daumlabs` 아래에 두는 페이지 — 8개, 그게 전부

농업 모드 메뉴(홈·측정 기록·영농 일지·모니터링·양액 관리·농장 기기 관리)에
해당하는 것만 둔다. **숨김 메뉴는 파일 자체를 만들지 않으므로 `/daumlabs/production`
같은 주소는 그냥 404다** — "숨김"이 아니라 "없음"이 된다.

| `/daumlabs` 경로 | 농업 메뉴 이름 | 공유 뷰 컴포넌트(신규 위치) | 원본 |
|---|---|---|---|
| `/daumlabs/home` | 홈 | `components/home/home-view.tsx` | `app/(dashboard)/home/page.tsx` (180행) |
| `/daumlabs/record` | 기록하기 허브 | `components/record/record-hub-view.tsx` | `app/(dashboard)/record/page.tsx` (52행) |
| `/daumlabs/record/water-quality` | 측정 기록 | `components/record/water-quality-record-view.tsx` | `app/(dashboard)/record/water-quality/page.tsx` (183행) |
| `/daumlabs/record/journal` | 영농 일지 쓰기 | `components/record/journal-record-view.tsx` | `app/(dashboard)/record/journal/page.tsx` (188행) |
| `/daumlabs/dashboard` | 모니터링 | `components/dashboard/dashboard-view.tsx` | `app/(dashboard)/dashboard/page.tsx` (441행) |
| `/daumlabs/water-quality` | 양액 관리 | `components/water-quality/water-quality-view.tsx` | `app/(dashboard)/water-quality/page.tsx` (1403행) |
| `/daumlabs/journal` | 영농 일지 | `components/journal/journal-view.tsx` | `app/(dashboard)/journal/page.tsx` (1423행) |
| `/daumlabs/farms` | 농장·기기 관리 | `components/farms/farms-view.tsx` | `app/(dashboard)/farms/page.tsx` (1854행) |

**세그먼트 이름은 새우 쪽과 1:1로 맞춘다**(`/water-quality`는 `/daumlabs/water-quality`).
농업식 별칭(`/daumlabs/nutrient` 등)을 쓰지 않는 이유: 링크 접두사 규칙(4-4)이
`prefix + path` 한 줄로 끝나고, 딥링크가 기계적으로 번역되며, 헤더 제목표
같은 경로 키 맵을 그대로 재사용할 수 있다.

**`/daumlabs` 아래에 두지 않는 것** (접두사 없이 공유):

- `/help`, `/onboarding`, `/board`, `/cardnews`, `/control`, `/admin` — 계정·전사
  공통 화면. 농업판이 따로 없다.
- `/production`, `/inventory`, `/ai-advisor`, `/reports`, `/diagnosis` — 새우 전용.
  농업 메뉴에 없고 `/daumlabs` 아래에도 없다.
- 설정 패널·알림 패널·검색 패널 — 셸의 일부라 URL이 없다.

주의: `/daumlabs/water-quality`에서 `/help`로 가면 주소에 접두사가 없어지므로
농업 용어가 풀린다. **URL이 화면을 결정한다**는 규칙의 당연한 귀결이고, 그대로
받아들인다. 농업판 도움말(`/daumlabs/help`)은 8장 로드맵으로 넘긴다.

### 4-3. 메뉴 (sidebar / bottom-nav) — 필터 + 접두사

| 기존 메뉴 | 농업 모드 | 링크 |
|---|---|---|
| 홈 `/home` | 홈 | `/daumlabs/home` |
| 수질 기록 `/record/water-quality` | 측정 기록 | `/daumlabs/record/water-quality` |
| 일지 쓰기 `/record/journal` | 영농 일지 쓰기 | `/daumlabs/record/journal` |
| 대시보드 `/dashboard` | 모니터링 | `/daumlabs/dashboard` (+ 양액 상태 카드 4-7) |
| 수질 관리 `/water-quality` | 양액 관리 | `/daumlabs/water-quality` |
| 일지 `/journal` | 영농 일지 | `/daumlabs/journal` |
| 양식장 관리 `/farms` | 농장·기기 관리 | `/daumlabs/farms` |
| 생산 관리 `/production` | — | **메뉴에서 제거 + 라우트 없음(404)** |
| 재고 관리 `/inventory` | — | 〃 (후속: "자재 관리"로 재도입 검토) |
| AI 어드바이저 `/ai-advisor` | — | 〃 |
| 리포트 `/reports` | — | 〃 (후속: KPI 리포트로 재설계, 8장) |
| 게시판·카드뉴스·관제센터·관리자·도움말 | 그대로 | 접두사 없이 공유 |

기존 `AGRI_HIDDEN` 집합(sidebar 25행, bottom-nav 23행)은 그대로 살려 쓴다. 다만
의미가 "숨김"에서 **"접두사를 붙일 수 없는 항목 = 농업 트리에 없는 항목"** 으로
바뀐다. 판정 입력은 `useFarmMode()`(비동기 farm 조회)가 아니라 `usePathname()`이다.

초판의 "URL 직접 접근을 서버에서 막지 않는다(권한이 아니라 문맥 문제)"는 원칙은
5-3에서 다시 다룬다. 여기서 404가 나는 것은 차단이 아니라 **그 주소에 페이지를
만들지 않았기 때문**이다.

### 4-4. 링크 접두사 규칙

`lib/agri-route.ts` (신규, 순수 함수 + 훅 하나. 컨텍스트도 DB도 없음):

```ts
export const AGRI_PREFIX = "/daumlabs"

/** /daumlabs 아래에 실제로 존재하는 경로. 여기 없는 주소엔 접두사를 붙이지 않는다. */
export const AGRI_ROUTES = [
  "/home", "/record", "/record/water-quality", "/record/journal",
  "/dashboard", "/water-quality", "/journal", "/farms",
] as const

export function isAgriPath(pathname: string): boolean
export function stripAgriPrefix(pathname: string): string   // 헤더 제목표 조회용
export function agriHref(href: string, agri: boolean): string
/** 화면에서 쓰는 훅: const { isAgri, href } = useAgriRoute() */
export function useAgriRoute(): { isAgri: boolean; href: (p: string) => string }
```

- `agriHref`는 **`AGRI_ROUTES`에 있는 경로만** 접두사를 붙인다. `/help`,
  `/onboarding`, `/board`, 언어 접두사가 붙은 주소(`/en/cardnews`)는 손대지 않는다.
- 쿼리스트링이 붙은 주소(`/water-quality?tank=…`)는 경로 부분만 떼어 판정한다.
- 새우 모드에서는 `href(p) === p` — 문자열이 그대로 나온다. **회귀 0의 기계적 보증.**
- 활성 메뉴 표시는 이미 접두사가 붙은 href와 pathname을 그대로 비교하면 되므로
  기존 `stripLocalePrefix` 로직을 건드리지 않는다.

접두사를 먹여야 하는 지점(전수 조사 결과):

| 파일 | 대상 |
|---|---|
| `components/layout/sidebar.tsx` | 로고 링크(115행), 홈(131행), `RECORD_NAV`, `MONITOR_NAV` |
| `components/layout/bottom-nav.tsx` | `PRIMARY`, `MORE` |
| `components/layout/header.tsx` | 26~33행 제목 맵 — **조회 키를 `stripAgriPrefix(pathname)`으로** |
| `components/layout/search-panel.tsx` | 28~33행 페이지 목록, 81~82행 `router.push` |
| `components/layout/notifications-panel.tsx` | 172행·198행 `/water-quality` |
| `components/weather/weather-card.tsx` | 82행 `/farms` |
| `components/farms/farm-map.tsx` | 152행 `/farms` |
| `components/home/home-view.tsx` | `/dashboard`(122·161행), `/record`(147행). `/onboarding`은 접두사 없음 |
| `components/record/record-hub-view.tsx` | `/home`, `/record/water-quality`, `/record/journal` |
| `components/record/water-quality-record-view.tsx` | 저장 후 `/dashboard`(86행) |
| `components/record/journal-record-view.tsx` | 저장 후 `/home`(78행) |
| `components/dashboard/dashboard-view.tsx` | `/water-quality`(194·276행), `/farms`(331행). **`/inventory`(213행)·`/diagnosis`(399행)는 농업에서 렌더하지 않는다** |
| `components/water-quality/water-quality-view.tsx` | `/farms`(720행), `/journal`(785행) |

### 4-5. 용어 치환 (i18n 오버라이드) — 거는 위치만 바뀐다

사전(`lib/i18n/agri-ko.ts`)과 병합 함수(`mergeDict`)는 초판 그대로 유효하다.
바뀌는 것은 **언제 켜지는가** 뿐이다.

- 이전: `FarmModeProvider`가 farm 목록을 읽어 `<AgriDictOverride enabled={isAgriMode}>`.
- 이후: `app/(dashboard)/layout.tsx`에서 **`<AgriDictOverride enabled={isAgriPath(pathname)}>`**.
  레이아웃은 이미 클라이언트 컴포넌트라 `usePathname()`을 쓸 수 있고, 네비게이션마다
  다시 렌더되므로 `/home ↔ /daumlabs/home` 전환에 즉시 반응한다.
- 사이드바·헤더·바텀네비가 이 프로바이더 **안쪽**에 있으므로 메뉴 라벨까지 함께
  치환된다(초판과 동일한 위치 관계).
- **`AgriDictOverride`는 항상 `I18nContext.Provider`를 렌더하도록 고친다.** 지금은
  `enabled=false`일 때 `<>{children}</>`를 반환해서, 경계를 넘을 때 엘리먼트 타입이
  바뀌어 셸 전체가 언마운트(사이드바 접힘 상태·스크롤 소실)된다. 값만 바꾸도록:

  ```tsx
  const value = enabled && locale === "ko" ? merged : ctx
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
  ```
- 온보딩(`app/onboarding/page.tsx`)의 페이지 로컬 `mergeDict`는 그대로 둔다.
  온보딩은 `/daumlabs` 밖이고, 유형을 고르는 순간부터 라벨이 바뀌어야 한다.
- 영어·베트남어·인니어는 오버라이드 사전이 없어 기존 라벨 그대로(깨지지 않음).

### 4-6. 센서 6종과 지표 우선순위 (초판 유지)

| 항목 | 상태 | 저장 칸 | 단위 |
|---|---|---|---|
| EC | 기존 (`conductivity`) | 있음 | µS/cm (표시는 mS/cm 병기) |
| pH | 기존 | 있음 | — |
| 수온 | 기존 (`temperature`) | 있음 | °C |
| DO | 기존 (`do_level`) | 있음 | ppm |
| 유량 | 신규 `flow_rate` | 추가 | L/min |
| 차압(ΔP) | 신규 `diff_pressure` | 추가 | kPa (UV 살균기·필터 막힘 감시) |

- 수신 경로 화이트리스트(`route.ts`의 `FIELDS`·`VALID_RANGE`·`OPTIONAL_COLS`),
  `wq_series`, `payloadLabels`, 그래프 탭까지 이미 반영되어 있다.
- `water-quality-view.tsx`의 농업 분기(기본 탭 `conductivity`, 탭 순서
  EC → pH → 수온 → DO → 유량 → 차압, EC/pH 목표선·허용밴드)는 **판정 입력만**
  `useFarmMode()` → `useAgriRoute().isAgri`로 교체한다. 분기 로직 자체는 그대로.
- **EC 목표선**: 전역 기준선은 긋지 않는다는 원칙(wq_conductivity.sql 주석)은 유지.
  베드별 레시피가 있을 때만 목표선 + 허용밴드(±0.1 dS/m)를 그린다.

### 4-7. 양액 레시피와 이상감지 알림 (초판 유지)

**저장** — `tanks`(베드)의 레시피 컬럼:

```
target_ec    double precision   -- 목표 EC, µS/cm (예: 1800 = 1.8 dS/m)
ec_tolerance double precision NOT NULL DEFAULT 100  -- ±µS/cm. 사업 목표 ±0.1 dS/m
target_ph    double precision
ph_tolerance double precision NOT NULL DEFAULT 0.5
```

**알림** — `app/api/sensors/data/route.ts`: tank 레시피를 함께 select →
`|conductivity − target_ec| > ec_tolerance` → warning, `> 2×tolerance` → danger.
pH 동일. 기존 alerts 중복 억제·자동 해제 흐름을 그대로 탄다. 레시피가 설정된
베드에서는 전역 염도 체크를 건너뛴다.

**이 경로는 URL과 무관하다.** 서버 수신 로직의 판정 축은 계속 데이터(tank 레시피
유무)다. 화면 라우팅 변경이 알림 동작에 영향을 주지 않는다 — 개정 1의 변경 범위에서
가장 중요한 무영향 지점이다.

**보충량 표시** — 계산은 장비, 표시는 웹. 장비가 payload에 `nut_*` 요약을 실어
보내고, `components/sensors/nutrient-status-card.tsx`가 표시한다. 이 카드의 렌더
조건만 `useFarmMode().isAgriMode` → `useAgriRoute().isAgri`로 바꾼다.

## 5. 진입·전환 라우팅 (개정 1 신규)

### 5-1. 미들웨어(현 `middleware.ts`)

```diff
 const PROTECTED_PATHS = [
   "/home",
+  "/daumlabs",
   "/record",
   …
 ]
```

한 줄이면 된다. 충돌 점검(전부 확인함):

- `MARKETING_LOCALE_PREFIXES`는 `["en","vi","id"]` — 첫 세그먼트가 `daumlabs`면
  걸리지 않는다.
- `KOREAN_PUBLIC_PATHS`에 `"/"` 가 있지만 판정식이 `pathname === p ||
  pathname.startsWith(p + "/")` 라 `p === "/"` 일 때 `startsWith("//")` 는 거짓이다.
  `/daumlabs/*`가 공개 경로로 새지 않는다.
- 비로그인 시 `/login` 리다이렉트, 로그인 상태의 인증 페이지 → `/home` 리다이렉트는
  그대로 둔다(`/home`이 스스로 교정한다, 5-2).
- `matcher`는 이미 전 경로라 수정 불필요.

**`app/robots.ts`의 `PRIVATE_PATHS`에 `"/daumlabs"` 를 추가한다** (9행). 로그인
뒤 화면이 색인 목록에 들어갈 이유가 없다.

> **별건 관찰(이번 범위 밖):** Next 16에서 `middleware` 파일 규약은 **deprecated이며
> `proxy.ts`로 개명**됐다(`.../file-conventions/proxy.md` 11행, 마이그레이션 코드모드
> `npx @next/codemod@canary middleware-to-proxy .`). 지금 당장 깨지지는 않으므로
> 이번 변경과 섞지 않고 **별도 작업으로 분리**한다(8장 로드맵). 라우팅 변경과 파일
> 개명을 한 커밋에 넣으면 회귀 원인 추적이 어려워진다.

### 5-2. 로그인·온보딩 후 착지 — **판정은 `/home` 진입 시 클라이언트에서 1회**

**미들웨어에서 판정하지 않는다.** 근거는 Next 16 문서 두 곳이다.

- `authentication.md#optimistic-checks-with-proxy-optional`: "Proxy는 프리페치를
  포함해 모든 라우트에서 실행되므로 쿠키만 읽고 **DB 조회는 피하라**".
- `16-proxy.md`: "Proxy는 느린 데이터 페칭용이 아니다".

farm_type을 미들웨어에서 알려면 요청마다 Supabase 조회가 붙는다. 프리페치까지
포함하면 비용이 페이지 수만큼 곱해진다. 채택 불가.

**대신 `/home`이 스스로 교정한다.** `components/home/home-view.tsx`는 이미 마운트
시 `getFarms()`를 부른다(현재 180행짜리 페이지의 34행). **추가 조회 0회**로 판정할 수 있다.

```
/home 진입
  └ getFarms()  (이미 부르고 있음)
      ├ farms.length === 0                       → /onboarding      (기존 동작)
      ├ 모든 farm 이 agriculture 이고 지금 /home  → /daumlabs/home  (신규, replace)
      └ 그 밖                                     → 그대로 새우 홈  (기존 동작)
```

이 한 곳이 **모든 진입 경로를 덮는다**: 로그인 폼(`app/login/page.tsx` 36행),
소셜 로그인 콜백, 랜딩의 세션 복귀(`components/landing/landing-page.tsx` 162행),
미들웨어의 인증 페이지 리다이렉트, 북마크·직접 입력. 각 지점을 따로 고칠 필요가
없다 — **고칠 곳이 하나면 어긋날 곳도 하나다.**

- 데모·테스트 계정(`isTestAccount`)은 목데이터가 전부 새우라 판정 자체를 건너뛴다.
- `getFarms()` 실패 시 새우 홈에 남는다(기본값은 언제나 새우 — 절대 원칙).
- **역방향 자동 이동은 하지 않는다.** `/daumlabs/home`에 온 사용자를 `/home`으로
  되돌리지 않는다. 되돌리면 혼합 계정이 수경재배 화면에 아예 못 들어가고, 공유된
  `/daumlabs/*` 링크가 전부 무력화된다.
- 온보딩(`app/onboarding/page.tsx`): 완료 처리 후
  `router.replace(farmType === "agriculture" ? "/daumlabs/home" : "/home")`.
  기존 farm이 있을 때의 가드(79~80행)는 `/home`으로 두면 위 규칙이 알아서 교정한다.

### 5-3. 엉뚱한 URL로 왔을 때 — 막지 않는다

초판의 원칙("권한 문제가 아니라 문맥 문제")을 그대로 이어받는다.

| 상황 | 처리 | 이유 |
|---|---|---|
| 새우 농장만 있는 사용자가 `/daumlabs/home` | **그대로 보여준다.** 자기 데이터가 농업 라벨(베드·양액)로 보인다 | 남의 데이터가 새는 게 아니다. RLS는 그대로 동작하고 보이는 건 언제나 본인 농장이다. 서버 차단을 넣으면 farm 조회가 요청마다 붙는다(5-2와 같은 이유) |
| 수경재배 사용자가 `/dashboard`(새우 주소) | **그대로 보여준다.** 새우 라벨로 보인다 | 위와 같음. 링크를 잘못 눌렀을 때 404보다 낫다 |
| 누구든 `/daumlabs/production` 등 | **404** | 차단이 아니라 그 주소에 페이지를 만들지 않았기 때문(4-2) |
| 비로그인 상태의 `/daumlabs/*` | `/login`으로 (미들웨어) | 5-1 |

### 5-4. 화면 전환 진입점

혼합 계정과 "잘못 들어온" 사용자를 위해 **눈에 보이는 출구**를 하나 둔다.

- `/farms`(새우)의 농장 카드에서 `farm_type === "agriculture"` 인 농장에
  **"수경재배 화면 열기 →"** (→ `/daumlabs/home`).
- `/daumlabs/farms`의 농장 카드에서 `farm_type === "shrimp"` 인 농장에
  **"새우 양식 화면 열기 →"** (→ `/home`).
- `/farms`는 이미 farm 목록과 `farm_type`을 들고 있으므로 **추가 조회 0회**다.
- 문안·버튼 위치는 수아가 확정(기존 농장 카드 결 유지). 사이드바 하단 전역
  전환 스위치는 farm 조회가 새로 필요해지므로 8장 로드맵으로 미룬다.

### 5-5. `lib/farm-mode-context.tsx` 처리 — **삭제**

- `deriveMode`(farm 목록 파생)는 3-2의 이유로 폐기.
- `AgriDictOverride` 장착은 `app/(dashboard)/layout.tsx`로 이동(4-5).
- `refreshFarmMode()`(farms 페이지 1718행)는 존재 이유가 사라진다 — 농장 유형을
  바꿔도 지금 보고 있는 화면의 URL은 그대로이므로 다시 계산할 전역 상태가 없다.
  호출부와 함께 제거.
- 대체물은 `lib/agri-route.ts` — 컨텍스트도 프로바이더도 없는 순수 함수 모듈.
  **비동기가 사라지므로 첫 페인트가 항상 옳다.**

## 6. DB 마이그레이션 (초판 유지 — 이번 개정에 DB 변경 없음)

`supabase/migrations/agriculture_mode.sql` (이미 작성·커밋됨):

```sql
-- 1) 농장 유형 — 기존 행은 DEFAULT 로 전부 shrimp (기존 계정 무변화)
ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS farm_type TEXT NOT NULL DEFAULT 'shrimp';
DO $$ BEGIN
  ALTER TABLE public.farms ADD CONSTRAINT farms_farm_type_check
    CHECK (farm_type IN ('shrimp', 'agriculture'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) 베드별 양액 레시피 (µS/cm 통일 — wq_conductivity.sql 원칙)
ALTER TABLE public.tanks
  ADD COLUMN IF NOT EXISTS target_ec    double precision,
  ADD COLUMN IF NOT EXISTS ec_tolerance double precision NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS target_ph    double precision,
  ADD COLUMN IF NOT EXISTS ph_tolerance double precision NOT NULL DEFAULT 0.5;

-- 3) 유량·차압 측정 칸
ALTER TABLE public.water_quality_readings
  ADD COLUMN IF NOT EXISTS flow_rate     double precision,
  ADD COLUMN IF NOT EXISTS diff_pressure double precision;

-- 4) wq_series 재정의 — 반환 칸이 늘므로 DROP 후 CREATE

NOTIFY pgrst, 'reload schema';
```

- **개정 1은 스키마를 건드리지 않는다.** `farms.farm_type`은 3-3의 역할로 계속 쓴다.
  컬럼을 지우지 마라.
- RLS 변경 없음. 실행은 사람 몫(Supabase SQL Editor).
  배포 순서: SQL 실행 → 웹 배포 → 장비 펌웨어.

## 7. 구현 단계와 담당

### 7-A. 개정 1 작업 목록 — 서연 (`seoyeon-dev`)

순서대로. **1~3단계는 순수 이동/추출이라 로직 변경이 0이어야 한다.**

**1단계 — 라우팅 헬퍼 신규**

1. `lib/agri-route.ts` 신규 — 4-4의 상수·함수·훅. 한국어 주석.

**2단계 — 뷰 컴포넌트 추출 (이동만, 내용 변경 금지)**

2. 아래 8개 페이지 본문을 `components/<기능>/<이름>-view.tsx`로 **이동**하고
   default export를 named export로 바꾼다(4-2 표의 신규 위치 참조).
   import는 전부 `@/` 별칭이라 경로 수정이 필요 없다(확인함). `"use client"` 유지.
   - `app/(dashboard)/home/page.tsx` → `components/home/home-view.tsx` (`HomeView`)
   - `app/(dashboard)/record/page.tsx` → `components/record/record-hub-view.tsx`
   - `app/(dashboard)/record/water-quality/page.tsx` → `components/record/water-quality-record-view.tsx`
   - `app/(dashboard)/record/journal/page.tsx` → `components/record/journal-record-view.tsx`
   - `app/(dashboard)/dashboard/page.tsx` → `components/dashboard/dashboard-view.tsx`
   - `app/(dashboard)/water-quality/page.tsx` → `components/water-quality/water-quality-view.tsx`
   - `app/(dashboard)/journal/page.tsx` → `components/journal/journal-view.tsx`
   - `app/(dashboard)/farms/page.tsx` → `components/farms/farms-view.tsx`
     (`components/farms/` 는 이미 있는 폴더 — 그 안에 둔다)
3. 기존 8개 페이지 파일을 3줄 래퍼로 다시 만든다(`"use client"` 없이).

**3단계 — `/daumlabs` 라우트 신규**

4. `app/(dashboard)/daumlabs/` 아래 8개 페이지 래퍼 신규(4-1 트리 그대로).
   같은 뷰 컴포넌트를 렌더한다. layout·loading·error 신규 생성 금지 —
   `(dashboard)` 것을 그대로 물려받는다.

**4단계 — 모드 판정 축 교체**

5. `app/(dashboard)/layout.tsx` — `FarmModeProvider` 제거,
   `<AgriDictOverride enabled={isAgriPath(pathname)}>`로 교체(`usePathname()` 사용).
6. `lib/i18n-context.tsx` — `AgriDictOverride`가 항상 Provider를 렌더하도록 수정(4-5).
7. `lib/farm-mode-context.tsx` **삭제**. 참조 4곳 교체:
   - `components/layout/sidebar.tsx` 9·38·68행
   - `components/layout/bottom-nav.tsx` 9·30·57행
   - `components/water-quality/water-quality-view.tsx` (31·434·473·499·670·673·1153·1265·1281·1293·1303·1323행 — `isAgriMode` → `isAgri`)
   - `components/sensors/nutrient-status-card.tsx` 16·51·56행
   - `components/farms/farms-view.tsx` 52·1647·1718행 — `refreshFarmMode` 호출 제거

**5단계 — 링크 접두사 먹이기**

8. 4-4 표의 13개 파일. `useAgriRoute().href(...)` 로 감싼다.
   `components/layout/header.tsx`는 제목 맵 조회 키를 `stripAgriPrefix(pathname)`로.
9. `components/dashboard/dashboard-view.tsx` — 농업(`isAgri`)일 때
   재고 바로가기(213행)와 진단 카드(399행)를 렌더하지 않는다.
   `/daumlabs` 아래에 그 페이지가 없으므로 죽은 링크가 된다.

**6단계 — 진입 라우팅**

10. `components/home/home-view.tsx` — 5-2의 자동 교정 추가.
    이미 부르는 `getFarms()` 결과를 재사용하고 **추가 조회를 만들지 말 것.**
11. `app/onboarding/page.tsx` — 완료 후 `farmType`에 따라 착지 주소 분기(5-2).
12. `middleware.ts` — `PROTECTED_PATHS`에 `"/daumlabs"` 추가(5-1). **다른 줄은 손대지 말 것.**
    파일명을 `proxy.ts`로 바꾸지 말 것(별건, 8장).
13. `app/robots.ts` — `PRIVATE_PATHS`에 `"/daumlabs"` 추가.

**7단계 — 화면 전환 진입점**

14. `components/farms/farms-view.tsx` — 5-4의 전환 버튼. 수아 문안 확정 후.

**하지 말 것**

- `next.config.ts`에 rewrite/redirect 추가 금지(4-1에서 기각).
- 페이지 컴포넌트 복사 금지.
- `farms.farm_type` 컬럼·타입·DB 함수 변경 금지(3-3).
- `app/api/sensors/data/route.ts`, `lib/thresholds.ts` 변경 금지 —
  서버 수신·알림은 URL과 무관하다(4-7).
- 기존 새우 URL의 주소·동작 변경 금지.

### 7-B. 수아 (`sua-designer`) — 개정 1에서 필요한 것만

1. 5-4 화면 전환 버튼 문안·배치(농장 카드 결 유지, `ui-ux-pro-max` 스킬).
2. `/daumlabs` 진입 시 사용자가 "다른 화면에 왔다"고 알아차릴 최소 신호가
   필요한지 판단 — 사이드바 로고 부제(`t.nav.brandTagline`)의 농업판 문안이
   이미 그 역할을 하는지 확인하고, 부족하면 보완안 1개.
3. 기존 시안(`docs/plans/agriculture-mode-ui.md`)에서 "전역 모드 자동 전환"을
   전제로 쓴 문장이 있으면 URL 전제로 고친다.

### 7-C. 태양 (`taeyang-reviewer`) — 개정 1 검수

**회귀 0 확인이 최우선이다. 이번 변경은 파일이 대거 이동하므로 회귀 위험이
기능 추가보다 크다.**

1. 새우 계정으로 `/home`, `/record`, `/record/water-quality`, `/record/journal`,
   `/dashboard`, `/water-quality`, `/journal`, `/farms` 전부 — 라벨·링크·데이터·
   차트가 이동 전과 동일한지. 8개 뷰의 diff가 "이름 바꾸기 + export 형태"뿐인지
   확인(로직 diff가 있으면 반려).
2. `/production`, `/inventory`, `/ai-advisor`, `/reports`, `/diagnosis`, `/help`,
   `/board`, `/cardnews`, `/control`, `/admin` 무변.
3. `/daumlabs/*` 8개 경로가 뜨는지, `/daumlabs/production` 등이 404인지.
4. `/daumlabs` 안에서 클릭한 모든 링크가 `/daumlabs` 안에 남는지(빠져나가면 라벨이
   풀린다). 헤더 제목이 `/daumlabs/*`에서 비지 않는지.
5. 전 농장 agriculture 계정: 로그인 → `/daumlabs/home` 착지. 혼합 계정: `/home` 착지
   후 `/farms` 버튼으로 전환. 온보딩 수경재배 → `/daumlabs/home`.
6. 비로그인 `/daumlabs/home` → `/login`. 로그인 후 원복 동작.
7. `/home ↔ /daumlabs/home` 왕복 시 사이드바 접힘 상태가 유지되는지(4-5의
   Provider 항상 렌더 수정이 제대로 됐는지).
8. `lib/farm-mode-context.tsx` 잔여 import가 없는지(`rg farm-mode-context`).
9. `npm run build` 타입 체크 통과, 라우트 목록에 8개 신규 경로가 정확히 나오는지.
10. 서버 수신·알림 경로 무변(레시피 이탈 알림 생성·해제 시나리오 1회 재확인).

### 7-D. 민준 (완료 보고)

사람 몫 안내 포함:
- `agriculture_mode.sql` 실행(아직 안 했다면). 배포 순서 SQL → 웹 → 장비 펌웨어.
- 농가에 안내할 주소가 `/daumlabs`로 바뀐다 — 기존에 공유한 링크가 있으면 갱신.
- 보충량 정확도는 현장 실측 교정에 달렸다.
- 유량·차압 Modbus 레지스터 맵은 하드웨어 스펙 확정 후 장비 설정에 입력.

### 7-E. (완료) 초판 구현 내역

DB 마이그레이션, 타입·`lib/db.ts`, `lib/i18n/agri-ko.ts`, 온보딩 유형 선택,
`/farms` 레시피 폼, `route.ts` 레시피 알림, `nutrient-status-card`,
water-quality 농업 탭·목표선, 장비 payload `nut_*` — HEAD `f26452b`에 반영됨.
개정 1은 이 위에 라우팅 축만 얹는다.

## 8. 범위 밖 (로드맵)

- **`middleware.ts` → `proxy.ts` 개명** — Next 16에서 deprecated.
  `npx @next/codemod@canary middleware-to-proxy .`. 라우팅 변경과 섞지 않고
  별도 커밋으로. (5-1 주석)
- 농업판 도움말 `/daumlabs/help`, 농업판 리포트 `/daumlabs/reports`(KPI 재설계)
- 사이드바 상단 전역 화면 전환 스위치(farm 조회가 필요 — 5-4)
- **KPI 자동산출·성능 검증 리포트** — EC 제어 정확도(목표 대비 체류율),
  가동률, 이탈 횟수·복귀 시간
- **SaaS 구독 모니터링** — 기존 plan/구독 체계(`lib/plans.ts`) 위에 농업 요금제
- 유량 하한·차압 상한 알림(펌프 정지·필터 막힘 감지) — 베드별 설정으로 확장
- 근권부 칠러·UV 살균기 제어 상태 표시(현재는 측정만, 제어는 장비 로컬)
- 영어·베트남어·인니어 농업 오버라이드 사전
- 농업용 자재 관리(inventory 재도입)
- 작물별(쪽파 외) 레시피 프리셋
