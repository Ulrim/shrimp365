# 농업 모드(Agriculture Mode) 설계서 — 쪽파 스마트 수경재배 IoT 대시보드 베타

- 작성: 민준 (PM·아키텍트)
- 작성일: 2026-08-18
- 상태: 설계 확정 → 수아(UI) → 서연(구현) → 태양(리뷰)

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

### 절대 원칙

- **새우 양식 사용자에게는 픽셀 하나 변하지 않는다.** 기본값은 언제나 새우 양식이고,
  농업 모드는 명시적으로 선택한 계정에만 적용된다.
- **기능은 최대한 재활용한다.** 아래 2장에서 확인했듯 핵심 배관은 전부 이미 있다.
  신규는 (a) 모드 분기·라벨, (b) 유량·차압 2개 항목, (c) 베드별 레시피와 이탈
  알림, (d) 보충량 계산값의 웹 표출 — 이 넷뿐이다.

## 2. 현황 — 이미 있는 것 (재활용 자산)

| 요구 | 이미 있는 구현 | 위치 |
|---|---|---|
| 기기 연결 | 6자리 코드 페어링 (TV 방식) | `components/sensors/pair-device-dialog.tsx`, `supabase/migrations/sensor_pairing.sql`, `app/(dashboard)/farms/page.tsx` (956행에서 사용) |
| 실시간 데이터 표시 | 기기별 마지막 수신값 카드 — **payload 기반이라 키만 추가하면 어떤 항목이든 표시됨** | `components/sensors/device-current-values.tsx` (payloadLabels), `app/(dashboard)/dashboard/page.tsx` (387행) |
| EC 시각화 | 전도도 이력·그래프 (µS/cm, 구간 평균 `wq_series`) | `app/(dashboard)/water-quality/page.tsx` (ConductivityChart, 1069행 조건부 탭), `supabase/migrations/wq_conductivity.sql` |
| pH·수온·DO | 측정·저장·그래프·임계값 알림 전부 있음 | 같은 파일들 + `lib/thresholds.ts` |
| 측정 항목 선택 | 장비 쪽 `ec_mode` (염도/전도도) | `raspberry-pi/shrimp365_sensor.py`, `config.example.ini` |
| 양액 보충량 계산 | **쪽파 수경재배 환산표 그대로 이식됨** (`nutrient_plan`, 528행~). 목표 EC·원수 EC·교정값으로 A/B 보충량(mL)·교환량(L) 계산. ATC 온도보정 포함. 단, 현재는 장비 로컬 화면(webui)에만 표시 | `raspberry-pi/shrimp365_sensor.py` 528~600행, `raspberry-pi/webui.py` 952행~ |
| 이상감지 알림 배관 | 수신 시 임계값 체크 → alerts 생성·중복 억제·자동 해제 → 수조 상태 갱신 | `app/api/sensors/data/route.ts` 230~293행 |
| 오프라인 버퍼 | 미연결·통신 두절 시 로컬 보관 후 일괄 전송 | `raspberry-pi/shrimp365_sensor.py` 1864행~ |

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
- `farms` — user_id, name, location, owner_name, area (농장 단위)
- `tanks` — farm_id, tank_type, stocking_* (수조=농업에서는 **베드** 단위)
- `water_quality_readings` — tank_id, device_id, temperature…conductivity
- `sensor_devices` — tank_id, api_key, last_payload, last_seen_at

## 3. 모드 결정 방식

### 결정: `farms.farm_type` 컬럼 (farm 단위) + UI 모드는 파생값

```
farms.farm_type TEXT NOT NULL DEFAULT 'shrimp'
  CHECK (farm_type IN ('shrimp', 'agriculture'))
```

- **farm 단위인 이유**: 한 계정이 양식장과 수경재배 시설을 함께 가질 수 있어야
  "계정 연동" 요구를 만족한다. `tank_type`이 이미 tank 단위에 있는 것과 같은 결.
- **기본값 `'shrimp'`**: 기존 farm 전부와 무지정 farm은 자동으로 새우 양식.
  기존 계정은 마이그레이션 후에도 아무 변화 없음.
- **UI 모드 파생 규칙**: 로그인 사용자의 farm 목록에서
  - 모든 farm이 `agriculture` → **농업 UI 모드**
  - 하나라도 `shrimp` (혼합 포함) → 기존 새우 UI 모드 (모든 메뉴 노출)
  - farm 없음(온보딩 전) → 새우 모드 기본

### 선택 지점

1. **온보딩**(`app/onboarding/page.tsx`) — Step 1 맨 위에 유형 선택:
   "새우 양식(기본)" / "수경재배 (양액·NFT)". agriculture 선택 시 새우 전용 입력
   (입식 밀도·입식일)을 숨기고 라벨을 농업 용어로(수조→베드), 베드별
   **양액 레시피(목표 EC·pH)** 입력을 추가한다.
2. **농장 관리**(`app/(dashboard)/farms/page.tsx`) — 농장 폼에 같은 선택지.
   기존 계정도 여기서 전환 가능. 베드 편집 폼에서 레시피 수정.

## 4. 농업 모드 화면 구성

### 4-1. 메뉴 (sidebar / bottom-nav)

| 기존 메뉴 | 농업 모드 | 처리 |
|---|---|---|
| 홈 `/home` | 홈 | 유지 (수조→베드 라벨 치환) |
| 수질 기록 `/record/water-quality` | 측정 기록 | 유지 |
| 일지 `/record/journal`, `/journal` | 영농 일지 | 유지 (라벨 치환) |
| 대시보드 `/dashboard` | 모니터링 | 유지 + **양액 상태 카드**(4-4) 추가 |
| 수질 관리 `/water-quality` | 양액 관리 | 유지 — EC 그래프의 본진, 레시피 목표선 표시 |
| 양식장 관리 `/farms` | 농장·기기 관리 | 유지 — 기기 페어링·레시피 설정이 여기 |
| 생산 관리 `/production` | — | **숨김** (PL 입식·수확 사이클은 새우 전용) |
| 재고 관리 `/inventory` | — | **숨김** (후속: "자재 관리"로 재도입 검토) |
| AI 어드바이저 `/ai-advisor` | — | **숨김** |
| 리포트 `/reports` | — | **숨김** (후속: KPI 리포트로 재설계, 7장) |
| 게시판·카드뉴스·관제센터·관리자 | 그대로 | 역할·플래그 기반 기존 로직 유지 |

숨김은 노출 제어일 뿐, URL 직접 접근을 서버에서 막지 않는다(권한 문제가 아니라
문맥 문제 — 관제센터 주석의 원칙과 동일).

### 4-2. 용어 치환 (i18n 오버라이드)

새 사전을 만들지 않고 **부분 오버라이드를 deep-merge** 한다.

- `lib/i18n/agri-ko.ts` (신규): `Partial<Dict>`로 수경재배 문맥 라벨만 정의.
  수조 → **베드**, 양식장 → 농장, 수질 관리 → 양액 관리, 사육 일지 → 영농 일지,
  로고 부제 "SMART AQUACULTURE" → 농업판 문안(수아 확정, 예: "SMART HYDROPONICS").
  정확한 키·문안 목록은 수아가 `lib/i18n/ko.ts` 기준으로 작성.
- `lib/i18n-context.tsx`: 농업 모드일 때만 `merge(ko, agriKo)`를 `t`로 제공.
  오버라이드 없는 키는 기존 값 → 영어·베트남어·인니어는 1단계에서 기존 라벨
  그대로(깨지지 않음), 오버라이드 사전은 후속.
- 새우 모드에서는 merge 자체를 하지 않으므로 동작 무변화.

### 4-3. 센서 6종과 지표 우선순위

| 항목 | 상태 | 저장 칸 | 단위 |
|---|---|---|---|
| EC | 기존 (`conductivity`) | 있음 | µS/cm (표시는 mS/cm 병기) |
| pH | 기존 | 있음 | — |
| 수온 | 기존 (`temperature`) | 있음 | °C |
| DO | 기존 (`do_level`) | 있음 | ppm |
| 유량 | **신규** `flow_rate` | 추가 | L/min |
| 차압(ΔP) | **신규** `diff_pressure` | 추가 | kPa (UV 살균기·필터 막힘 감시) |

- 신규 2종은 `water_quality_readings` 컬럼 추가 + 수신 경로 화이트리스트
  (`route.ts` 149행 `FIELDS`·`VALID_RANGE`) + `wq_series` 함수 갱신 +
  `payloadLabels`(device-current-values) + 그래프 탭. 유효 범위 제안:
  flow_rate 0~1000 L/min, diff_pressure 0~1000 kPa (서연이 장비 스펙 보고 확정).
- `/water-quality` 그래프 탭(1056~1070행): 농업 모드 기본 탭 `conductivity`,
  순서 EC → pH → 수온 → DO → 유량 → 차압. 염도·암모니아·아질산염 등 새우
  지표는 뒤로 접는다(수아 확정). 농업 모드에서는 EC 탭을 데이터가 없어도 노출.
- **EC 목표선**: 기존 "전역 기준선을 긋지 않는다" 결정(wq_conductivity.sql 주석)은
  유지하되, 이는 '전역 상수' 이야기다. 베드별 레시피가 있으면 그 베드의 그래프에
  **목표 EC 선 + 허용밴드(±0.1 dS/m)** 를 그린다. pH도 동일.

### 4-4. 양액 레시피와 이상감지 알림 (핵심 신규)

**저장** — `tanks`(베드)에 레시피 컬럼 추가:

```
target_ec    double precision   -- 목표 EC, µS/cm (예: 1800 = 1.8 dS/m)
ec_tolerance double precision NOT NULL DEFAULT 100  -- ±µS/cm. 사업 목표 ±0.1 dS/m
target_ph    double precision
ph_tolerance double precision NOT NULL DEFAULT 0.5
```

- 단위는 저장 원칙(µS/cm 통일, 표시에서 환산)을 따른다. NULL이면 레시피 미설정.

**알림** — `app/api/sensors/data/route.ts` 수신 시:

1. device 조회 시 tank의 레시피 컬럼을 함께 select.
2. `target_ec`가 있으면 `|conductivity − target_ec| > ec_tolerance` → warning,
   `> 2×ec_tolerance` → danger. pH 동일. 알림 문구는 "EC 1.95 mS/cm — 목표
   1.80±0.10 이탈" 형태(도량형은 mS/cm 표기, 저장은 µS/cm).
3. 기존 alerts 중복 억제·자동 해제·수조 상태 갱신 흐름(238~293행)을 그대로 탄다.
   구현은 `checkThresholds`를 대체하지 말고 **레시피 기반 체크를 별도 함수**
   (`lib/thresholds.ts`에 `checkRecipe` 추가)로 만들어 결과를 합친다.
4. 레시피가 설정된 베드에서는 전역 `WQ_THRESHOLDS`의 **염도 체크를 건너뛴다**
   (새우 해수 기준이라 농업에서 오탐. 단 농업 장비는 `ec_mode=conductivity`라
   염도를 보내지 않으므로 실제 발생 빈도는 낮다 — 방어적 처리).

**보충량 표시 (웹 전면 배치)** — 역할 분담: 계산은 장비, 표시는 웹.

1. 장비(`shrimp365_sensor.py`): `nutrient_plan` 결과를 업로드 payload에 평탄한
   키로 추가 — `nut_percent`, `nut_verdict`("low"|"ok"|"high"), `nut_dose_a_ml`,
   `nut_dose_b_ml`, `nut_exchange_l`, `nut_target_ec`. `sanitizePayload`가 이미
   통과시키므로 **서버 수정 없이** `sensor_devices.last_payload`에 실린다.
2. 웹: 대시보드에 **양액 상태 카드**(신규 `components/sensors/nutrient-status-card.tsx`)
   — last_payload의 nut_* 값으로 "현재 농도 87% · 목표 1.8 · A액 320mL / B액
   320mL 보충" 형태 표시. verdict에 따라 색(ok=녹색, low/high=주황).
   농업 모드에서만 렌더.
3. 교정 전 정확도 경고(장비 화면의 기존 안내)를 웹 카드에도 병기 — 장비가
   `nut_calibrated` 불리언을 함께 보내면 미교정 시 "실측 교정 전 — 참고값" 배지.

## 5. DB 마이그레이션

신규 파일 `supabase/migrations/agriculture_mode.sql` (서연 작성, 멱등, 한 파일로):

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
-- CHECK 제약(범위)은 서연이 wqr_conductivity_range 와 같은 패턴으로 추가

-- 3) 유량·차압 측정 칸
ALTER TABLE public.water_quality_readings
  ADD COLUMN IF NOT EXISTS flow_rate     double precision,
  ADD COLUMN IF NOT EXISTS diff_pressure double precision;

-- 4) wq_series 재정의 — 반환 칸이 늘므로 DROP 후 CREATE
--    (wq_conductivity.sql 27~64행과 동일 패턴, flow_rate·diff_pressure 추가)

NOTIFY pgrst, 'reload schema';
```

- RLS 변경 없음(기존 farms/tanks/readings 정책 그대로).
- `supabase/schema.sql`과 `build-combined.sh` 산출물(`_ALL_required.sql`) 반영.
- route.ts의 `OPTIONAL_COLS` 폴백 목록(197행)에 `flow_rate`·`diff_pressure` 추가
  — 마이그레이션 전 DB에서도 측정이 멈추지 않아야 한다는 기존 원칙.
- **실행은 사람 몫** — Supabase SQL Editor. 에이전트는 파일 커밋까지만.
  배포 순서: SQL 실행 → 웹 배포 → 장비 펌웨어 업데이트.

## 6. 구현 단계와 담당

### 1단계 — 수아 (UI 설계) — `ui-ux-pro-max` 스킬 사용

산출물: 화면별 구체 시안(문안 포함). 기존 톤(파랑 `#1E40AF`, 카드 스타일) 유지.

1. 온보딩 유형 선택 UI — `app/onboarding/page.tsx` Step 1. 카드 2택
   (새우 양식 / 수경재배) + agriculture 선택 시 베드 입력(레시피 포함) 구성.
2. 농업 모드 메뉴 — `components/layout/sidebar.tsx` 39~59행,
   `components/layout/bottom-nav.tsx` 31~52행 배열의 필터·재배치안.
   로고 부제 농업판 문안.
3. 수경재배 용어 사전 초안 — `lib/i18n/agri-ko.ts`에 들어갈 키·문안.
   기준: `lib/i18n/ko.ts`의 `nav`, `waterQuality(X)`, `dashboard`, `onboarding`,
   `farms` 섹션. 쪽파·NFT 베드·양액 재순환 문맥의 자연스러운 농가 언어로.
4. **양액 상태 카드** 시안 — 현재 농도 %, 목표 EC, verdict별 색, A/B 보충량,
   미교정 배지. `components/sensors/device-current-values.tsx`의 카드 결 유지.
5. `/water-quality` 농업판 — 탭 순서(EC·pH·수온·DO·유량·차압), EC/pH 그래프의
   목표선+허용밴드 표현(해당 파일 314~331행 ConductivityChart 참고),
   베드(수조) 선택 UI 라벨.
6. `/farms` 베드 폼의 레시피 입력(목표 EC는 mS/cm로 입력받고 저장 시 µS/cm 환산).

### 2단계 — 서연 (구현)

수아 시안 확정 후, 작업 순서대로:

1. `supabase/migrations/agriculture_mode.sql` 신규 (5장) + `supabase/schema.sql`
   반영 + `supabase/build-combined.sh` 재생성.
2. `types/`의 Farm에 `farm_type`, Tank에 레시피 4필드, Reading에
   `flow_rate`·`diff_pressure` 추가. `lib/db.ts`의 toFarm/createFarm/updateFarm,
   tank CRUD에 반영.
3. `lib/farm-mode-context.tsx` 신규 — `(dashboard)` 레이아웃에서 getFarms()
   결과로 UI 모드 파생·제공. `app/(dashboard)/layout.tsx`에 프로바이더 추가.
   auth-context는 건드리지 않는다(profiles 전용 현 구조 유지).
4. `lib/i18n/agri-ko.ts` 신규 + `lib/i18n-context.tsx` 농업 모드 merge
   (Dict는 2단 구조 — 얕은 2단 병합이면 충분).
5. `components/layout/sidebar.tsx`, `bottom-nav.tsx` — 농업 모드 메뉴 필터.
6. `app/onboarding/page.tsx` — 유형 선택, agriculture 시 새우 필드 숨김·레시피 입력.
7. `app/(dashboard)/farms/page.tsx` — farm_type 선택 + 베드 레시피 편집.
8. **수신·알림**: `lib/thresholds.ts`에 `checkRecipe`(EC·pH 레시피 이탈 판정,
   ±tolerance=warning, ±2×tolerance=danger) 추가.
   `app/api/sensors/data/route.ts` — tank 레시피 select, checkRecipe 결과를
   기존 알림 흐름에 합류, 레시피 베드의 염도 전역 체크 생략,
   `FIELDS`/`VALID_RANGE`/`OPTIONAL_COLS`에 flow_rate·diff_pressure 추가.
9. **장비**: `raspberry-pi/shrimp365_sensor.py` — 업로드 payload에 nut_* 요약
   추가(1862행 payload 조립부). 유량·차압 센서 키를 `flow_rate`·`diff_pressure`로
   전송(센서 레지스터는 장비 스펙 확정 후 — config.example.ini에 항목 추가).
10. **웹 표시**: `components/sensors/nutrient-status-card.tsx` 신규(농업 모드 전용),
    `app/(dashboard)/dashboard/page.tsx`에 배치.
    `components/sensors/device-current-values.tsx` payloadLabels에
    flow_rate(L/min)·diff_pressure(kPa) 추가 — 이 두 키는 새우 모드에서도
    무해(장비가 안 보내면 안 보임).
11. `app/(dashboard)/water-quality/page.tsx` — 유량·차압 차트, 농업 모드 기본 탭
    `conductivity`·탭 재배치, EC/pH 목표선+밴드(해당 베드 레시피 있을 때만).

주의: **이 저장소는 Next.js 16.2.4다.** 이번 설계는 신규 라우트·캐싱·서버 액션을
만들지 않고 기존 클라이언트 컴포넌트와 기존 Route Handler 수정만 있지만, 라우트
구조를 바꾸게 되면 반드시 `node_modules/next/dist/docs/`의 해당 가이드를 먼저
읽는다 (현재 워킹트리에 node_modules 미설치 — `npm install` 후 확인).

### 3단계 — 태양 (리뷰)

- **회귀 0 확인 최우선**: farm_type 미지정(기존) 새우 계정에서 라벨·메뉴·탭·알림이
  이전과 동일한지. 특히 route.ts 변경이 기존 새우 장비 수신에 영향 없는지.
- 마이그레이션 멱등성, CHECK 제약, `wq_series` DROP/CREATE 순간의 폴백 경로,
  RLS 영향 없음.
- 농업 시나리오: 온보딩(수경재배) → 페어링 → EC·유량·차압 수신 → 그래프 →
  레시피 이탈 시 알림 생성·복귀 시 자동 해제 → 양액 상태 카드 표시.
- 이탈 판정 경계값(정확히 ±0.1 dS/m 지점) 단위 혼동(µS/cm vs mS/cm) 점검.
- 혼합 계정(새우+농업 farm)이 새우 모드로 떨어지는지.
- payload nut_* 키가 `sanitizePayload` 32개 제한 안에 드는지(현재 센서 값 +
  serial/firmware + nut_* 6개면 여유 있음).

### 4단계 — 민준 (완료 보고)

사람 몫 안내 포함:
- `agriculture_mode.sql`을 Supabase SQL Editor에서 실행해야 한다. 배포 순서는
  SQL → 웹 → 장비 펌웨어.
- 보충량 정확도는 현장 실측 교정(원액 EC 상승폭)에 달렸다 — 농가 안내 필요.
- 유량·차압 센서의 Modbus 레지스터 맵은 하드웨어 스펙 확정 후 장비 설정에 입력.

## 7. 범위 밖 (로드맵)

- **KPI 자동산출·성능 검증 리포트** — EC 제어 정확도(목표 대비 체류율),
  가동률, 이탈 횟수·복귀 시간 등을 `/reports`의 농업판으로 재설계
- **SaaS 구독 모니터링** — 기존 plan/구독 체계(`lib/plans.ts`) 위에 농업 요금제
- 유량 하한·차압 상한 알림(펌프 정지·필터 막힘 감지) — 베드별 설정으로 확장
- 근권부 칠러·UV 살균기 제어 상태 표시(현재는 측정만, 제어는 장비 로컬)
- 영어·베트남어·인니어 농업 오버라이드 사전
- 농업용 자재 관리(inventory 재도입), 혼합 계정의 farm별 화면 전환
- 작물별(쪽파 외) 레시피 프리셋
