# 농업 모드(Agriculture Mode) 설계서

- 작성: 민준 (PM·아키텍트)
- 작성일: 2026-08-18
- 상태: 설계 확정 → 수아(UI) → 서연(구현) → 태양(리뷰)

## 1. 배경과 요구

EC 측정 하드웨어(라즈베리파이 센서)를 농업(수경재배·양액 관리) 고객이 사용할 예정이다.
사용자 요구는 세 가지다.

1. **계정은 기존 Shrimp365와 연동** — 별도 앱·별도 회원 체계를 만들지 않는다.
2. **보이는 화면만 농업에 맞춘다** — 메뉴·용어·기본 지표를 농업 문맥으로.
3. **필요 기능은 셋뿐** — 모니터링 기기 연결, 농가에 보여줄 데이터 표시, 시각화(그래프).

### 절대 원칙

- **새우 양식 사용자에게는 픽셀 하나 변하지 않는다.** 기본값은 언제나 새우 양식이고,
  농업 모드는 명시적으로 선택한 계정에만 적용된다.
- **새 기능을 만들지 않는다.** 아래 3장에서 확인했듯 필요한 기능은 전부 이미 있다.
  이번 작업은 "분기와 라벨"이지 "기능 개발"이 아니다.

## 2. 현황 — 이미 있는 것 (재활용 자산)

코드 탐색 결과, 사용자가 요구한 세 기능은 모두 구현되어 있다.

| 요구 | 이미 있는 구현 | 위치 |
|---|---|---|
| 기기 연결 | 6자리 코드 페어링 (TV 방식) | `components/sensors/pair-device-dialog.tsx`, `supabase/migrations/sensor_pairing.sql`, `app/(dashboard)/farms/page.tsx` (956행에서 사용) |
| 실시간 데이터 표시 | 기기별 마지막 수신값 카드 — **payload 기반이라 EC(conductivity)·TDS도 이미 표시됨** | `components/sensors/device-current-values.tsx`, `app/(dashboard)/dashboard/page.tsx` (387행) |
| EC 시각화 | 전도도 이력·그래프 (µS/cm, 구간 평균 `wq_series`) | `app/(dashboard)/water-quality/page.tsx` (ConductivityChart, 1069행 조건부 탭), `supabase/migrations/wq_conductivity.sql` |
| 측정 항목 선택 | 장비 쪽 `ec_mode` (염도/전도도) | `raspberry-pi/shrimp365_sensor.py`, `config.example.ini` |
| 양액 보충량 계산 | 장비 로컬 화면(webui)에서 목표 EC 대비 보충량 계산 | `raspberry-pi/webui.py`, `raspberry-pi/shrimp365_sensor.py` (528행~) |

즉 **웹에 없는 것은 "농업용 화면 구성"뿐**이다: 모드 플래그, 메뉴 필터, 용어 치환,
온보딩 분기, EC를 기본 지표로 올리는 것.

### 관련 데이터 모델 (supabase/schema.sql)

- `profiles` — id, name, role, plan (계정 단위)
- `farms` — user_id, name, location, owner_name, area (농장 단위)
- `tanks` — farm_id, tank_type(노지/실내/반실내), stocking_* (수조 단위)
- `sensor_devices` — tank_id, device_type, last_payload, last_seen_at

## 3. 모드 결정 방식

### 결정: `farms.farm_type` 컬럼 (farm 단위) + UI 모드는 파생값

```
farms.farm_type TEXT NOT NULL DEFAULT 'shrimp'
  CHECK (farm_type IN ('shrimp', 'agriculture'))
```

- **farm 단위인 이유**: 한 계정이 양식장과 농업 시설을 함께 가질 수 있어야
  "계정 연동" 요구를 만족한다. `tank_type`이 이미 tank 단위에 있는 것과 같은 결.
  profile 단위로 두면 혼합 운영 계정을 나중에 지원할 수 없다.
- **기본값 `'shrimp'`**: 기존 farm 전부와 앞으로의 무지정 farm은 자동으로 새우 양식.
  기존 계정은 마이그레이션 후에도 아무 변화 없음.
- **UI 모드 파생 규칙**: 로그인 사용자의 farm 목록에서
  - 모든 farm이 `agriculture` → **농업 UI 모드**
  - 하나라도 `shrimp` (혼합 포함) → **기존 새우 UI 모드** (모든 메뉴 노출)
  - farm 없음(온보딩 전) → 새우 모드 기본
  - 혼합 계정에 농업 라벨을 섞으면 양쪽 다 어색해진다. 1단계에서는 "전부 농업일 때만
    농업 화면"으로 단순하게 간다.

### 선택 지점

1. **온보딩**(`app/onboarding/page.tsx`) — Step 1 맨 위에 유형 선택 추가:
   "새우 양식(기본)" / "농업 (양액·수경재배)". agriculture 선택 시
   새우 전용 입력(입식 밀도 `stocking_density`, 입식일 `stocking_date`)을 숨기고
   라벨을 농업 용어로 바꾼다(수조→구역).
2. **농장 관리**(`app/(dashboard)/farms/page.tsx`) — 농장 추가·수정 폼에 같은 선택지.
   기존 계정도 여기서 전환할 수 있다.

## 4. 농업 모드 화면 구성

### 4-1. 메뉴 (sidebar / bottom-nav)

| 기존 메뉴 | 농업 모드 | 처리 |
|---|---|---|
| 홈 `/home` | 홈 | 유지 (수조→구역 라벨만 치환) |
| 수질 기록 `/record/water-quality` | 측정 기록 | 유지 |
| 일지 `/record/journal`, `/journal` | 영농 일지 | 유지 (라벨 치환) |
| 대시보드 `/dashboard` | 모니터링 | 유지 — 기기 현재값(EC 포함)이 이미 여기 있음 |
| 수질 관리 `/water-quality` | 양액·수질 | 유지 — EC 그래프의 본진 |
| 양식장 관리 `/farms` | 농장·기기 관리 | 유지 — 기기 페어링이 여기 있음 |
| 생산 관리 `/production` | — | **숨김** (PL 입식·수확 사이클은 새우 전용) |
| 재고 관리 `/inventory` | — | **숨김** (1단계. 필요해지면 "자재 관리"로 후속) |
| AI 어드바이저 `/ai-advisor` | — | **숨김** (새우 조언 전용, 어차피 comingSoon) |
| 리포트 `/reports` | — | **숨김** (1단계. 새우 지표 중심이라 후속 정리 필요) |
| 게시판·카드뉴스·관제센터·관리자 | 그대로 | 역할·플래그 기반 기존 로직 유지 |

숨김은 **노출 제어일 뿐**이다. URL 직접 접근을 서버에서 막지 않는다
(권한 문제가 아니라 문맥 문제이므로. 관제센터 주석의 원칙과 동일).

### 4-2. 용어 치환 (i18n 오버라이드)

새 사전을 만들지 않고, **부분 오버라이드를 deep-merge** 한다.

- `lib/i18n/agri-ko.ts` (신규): `Partial<Dict>` 형태로 농업 문맥 라벨만 정의.
  - 수조 → 구역(베드), 양식장 → 농장, 수질 → 양액·수질, 사육일지 → 영농 일지,
    염도 → (그대로, 단 지표 우선순위에서 제외), "SMART AQUACULTURE" 로고 부제 →
    "SMART FARM MONITORING" 등. 정확한 문안은 수아가 확정.
- `lib/i18n-context.tsx`: 농업 모드일 때 `merge(ko, agriKo)` 를 `t`로 제공.
  오버라이드가 없는 키는 기존 값 그대로 → 영어·베트남어·인니어는 1단계에서
  오버라이드 파일 없이 기존 라벨 사용(깨지지 않음), 후속으로 추가.
- 새우 모드에서는 merge 자체를 하지 않으므로 성능·동작 모두 무변화.

### 4-3. 지표 우선순위

- `/water-quality` 그래프 탭: 농업 모드면 기본 선택 탭을 `conductivity`로,
  탭 순서를 EC → 수온 → pH → DO 순으로 앞세운다. `hasConductivity` 조건은
  유지하되, 농업 모드에서는 데이터가 없어도 EC 탭을 노출해 "여기에 쌓인다"를
  보여준다. 염도·암모니아 등 탭은 농업 모드에서 뒤로 보내거나 접는다(수아 결정).
- `/dashboard`: `DeviceCurrentValues`는 payload 기반이라 수정 불요.
  요약 카드의 "수온" 중심 표기를 농업 모드에서 "EC" 중심으로 (수아 시안).
- EC 기준선: `wq_conductivity.sql` 주석대로 작물마다 적정 EC가 달라
  **기준선을 긋지 않는다**는 기존 결정을 유지한다. 목표 EC는 장비(webui)가 안다.

### 4-4. 장비 연동

변경 없음. 장비는 이미 `ec_mode=conductivity`로 EC를 올리고, 페어링·수신 경로
(`app/api/sensors/data/route.ts`)는 모드와 무관하게 동작한다. 양액 보충량 계산은
장비 로컬 화면 기능으로 유지하고, 웹 표출은 후속 과제로 남긴다(범위 밖).

## 5. DB 마이그레이션

신규 파일 `supabase/migrations/farm_type.sql` (서연 작성, 멱등):

```sql
-- 농장 유형 — 'shrimp'(새우 양식, 기본) / 'agriculture'(농업: 양액·수경재배)
-- 기존 행은 DEFAULT 로 전부 shrimp 가 되어 기존 계정에는 아무 변화가 없다.
ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS farm_type TEXT NOT NULL DEFAULT 'shrimp';

DO $$ BEGIN
  ALTER TABLE public.farms
    ADD CONSTRAINT farms_farm_type_check
    CHECK (farm_type IN ('shrimp', 'agriculture'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
```

- RLS 변경 없음(기존 farms 정책이 그대로 적용).
- `supabase/schema.sql` 과 `build-combined.sh` 산출물(`_ALL_required.sql`)에도 반영.
- **실행은 사람 몫** — Supabase SQL Editor. 에이전트는 파일 커밋까지만.

## 6. 구현 단계와 담당

### 1단계 — 수아 (UI 설계) — `ui-ux-pro-max` 스킬 사용

산출물: 각 화면의 구체 시안(문안 포함). 기존 톤(파랑 `#1E40AF`, 카드 스타일)을 벗어나지 않는다.

1. 온보딩 유형 선택 UI — `app/onboarding/page.tsx` Step 1. 카드 2택
   (새우 양식 / 농업). 기존 스텝 위저드 구조(`components/wizard/step-wizard.tsx` 참고) 안에서.
2. 농업 모드 메뉴 구성 확정 — `components/layout/sidebar.tsx` 39~59행,
   `components/layout/bottom-nav.tsx` 31~52행의 배열을 어떻게 필터·재배치할지.
   로고 부제("SMART AQUACULTURE") 농업판 문안 포함.
3. 농업 용어 사전 초안 — `lib/i18n/agri-ko.ts`에 들어갈 키·문안 목록.
   기준: `lib/i18n/ko.ts`의 `nav`, `waterQuality`, `dashboard`, `onboarding`, `farms` 섹션.
4. `/water-quality` 탭 순서·기본 탭, `/dashboard` 요약 카드의 농업판 배치
   (해당 파일 1056~1070행 탭 구조 참고).

### 2단계 — 서연 (구현)

수아 시안 확정 후. 작업 순서대로:

1. `supabase/migrations/farm_type.sql` 신규 (5장 내용) + `supabase/schema.sql` 반영
   + `supabase/build-combined.sh` 재생성 절차 확인.
2. `types/` 의 Farm 타입에 `farm_type: "shrimp" | "agriculture"` 추가,
   `lib/db.ts` `toFarm`/`createFarm`/`updateFarm` 에 필드 반영.
3. `lib/farm-mode-context.tsx` 신규 — `(dashboard)` 레이아웃에서 getFarms() 결과로
   UI 모드를 파생해 제공하는 클라이언트 컨텍스트. `app/(dashboard)/layout.tsx`에
   프로바이더 추가. auth-context는 건드리지 않는다(profiles만 다루는 현 구조 유지).
   홈 등 기존 페이지가 이미 getFarms()를 각자 부르므로, 컨텍스트에서 1회 캐시하고
   기존 호출과의 중복은 성능상 허용(1단계).
4. `lib/i18n/agri-ko.ts` 신규 + `lib/i18n-context.tsx`에 농업 모드 merge.
   merge 유틸은 얕은 2단 병합이면 충분(Dict 구조가 2단).
5. `components/layout/sidebar.tsx`, `bottom-nav.tsx` — 농업 모드 메뉴 필터.
6. `app/onboarding/page.tsx` — 유형 선택 + agriculture 시 새우 필드 숨김.
7. `app/(dashboard)/farms/page.tsx` — 농장 폼에 farm_type 선택 추가.
8. `app/(dashboard)/water-quality/page.tsx` — 농업 모드 기본 탭 `conductivity`,
   탭 순서 조정(수아 시안대로).

주의: **이 저장소는 Next.js 16.2.4다.** 이번 설계는 신규 라우트·캐싱·서버 액션을
만들지 않고 기존 클라이언트 컴포넌트만 고치므로 라우팅 API를 건드릴 일이 없지만,
만약 구현 중 라우트 추가가 필요해지면 반드시 `node_modules/next/dist/docs/`의
해당 가이드를 먼저 읽는다 (현재 워킹트리에 node_modules 미설치 — `npm install` 후 확인).

### 3단계 — 태양 (리뷰)

- **회귀 0 확인이 최우선**: farm_type 미지정(기존) 계정으로 모든 화면에서
  라벨·메뉴·탭이 이전과 동일한지.
- 마이그레이션 멱등성, CHECK 제약, RLS 영향 없음 확인.
- 농업 계정 시나리오: 온보딩 → 기기 페어링 → EC 수신 → 그래프.
- 혼합 계정(새우+농업 farm)이 새우 모드로 떨어지는지.

### 4단계 — 민준 (완료 보고)

- 사람 몫 안내 포함: `farm_type.sql`을 Supabase SQL Editor에서 실행해야
  농장 유형 저장이 동작한다. 실행 전에는 온보딩 유형 선택이 저장에 실패하므로
  배포 순서는 SQL 먼저.

## 7. 범위 밖 (후속 과제)

- 영어·베트남어·인니어 농업 오버라이드 사전
- 장비 양액 보충량 계산값의 웹 표출
- 농업용 재고(자재) 관리, 농업용 리포트
- 혼합 계정에서 farm별 화면 전환
- 작물별 목표 EC 프리셋(웹 측)
