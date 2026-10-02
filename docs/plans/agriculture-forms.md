# 농업 모드 개정 2 — 화면 내용물과 입력 폼의 농업화

- 작성: 민준 (PM·아키텍트)
- 작성일: 2026-08-19
- 상위 문서: `docs/plans/agriculture-mode.md`(개정 1), `docs/plans/agriculture-mode-ui.md`(수아)
- 상태: 설계 확정 → 수아(UI·문안) → 서연(구현) → 태양(리뷰)

## 0. 이 문서가 다루는 것

사용자 지적 원문:

> 수경재배 농가가 사용하는 모니터링 및 데이터 입력폼이 새우양식에 맞춰져있습니다.
> 수경재배, 농업에 맞춰서 수정·보완해주세요.

초판·개정 1이 한 것은 **껍데기**였다 — 메뉴 숨김, 용어 치환(i18n 오버라이드),
URL 분기(`/daumlabs`), EC 그래프 탭, 양액 카드. 화면의 **알맹이**는 손대지 않았다.

개정 2가 다루는 것: **입력 폼이 무엇을 받는가**, **모니터링이 무엇을 보여주는가**,
**임계값이 무엇을 기준으로 판정하는가**.

기존에 정해진 규칙(용어 사전 `lib/i18n/agri-ko.ts`, `lib/agri-route.ts`,
mS/cm↔µS/cm 단위 원칙, 회귀 0)은 **그대로 따르고 확장만 한다.** 새 규칙을 만들지 않는다.

---

## 1. 전수 조사 — 확인된 사실

파일을 직접 읽고 확인한 것만 적는다. 행 번호는 HEAD 기준이다.

### 1-1. 측정 입력 폼 — `components/record/water-quality-record-view.tsx`

**농업 화면(`/daumlabs/record/water-quality`)이 지금 받는 항목 전부** (26~38행 state,
96~127행 스텝 정의):

| 순서 | 항목 | 단위 | 힌트 문구 | 행 |
|---|---|---|---|---|
| 1 | 수조 선택 | — | 라벨 하드코딩 `"수조 선택"` | 98 |
| 2 | 날짜 | — | | 102 |
| 3 | 수온 | °C | `"최적 범위: 26~28°C"` | 103 |
| 4 | **염도** | ‰ | **`"흰다리새우 적정 15~35‰ (=ppt)"`** | 104 |
| 5 | pH | — | `"최적 범위: 7.8~8.5"` | 109 |
| 6 | DO | mg/L | `"최적: 7.0 mg/L 이상"` | 110 |
| 7 | **암모니아** | mg/L | `"0.5 mg/L 이상 시 위험"` | 115 |
| 8 | **아질산염** | mg/L | | 116 |
| 9 | **질산염** | mg/L | | 117 |
| 10 | **알칼리도** | mg/L | `"최적 범위: 100~150 mg/L"` | 122 |
| 11 | **탁도** | NTU | `"10 NTU 이하 권장"` | 123 |

**가장 큰 문제: EC(전도도) 입력 칸이 없다.** 사업의 핵심 지표이고 KPI가
"EC 제어 정확도 ±0.1 dS/m"인데, 수경재배 농가가 손으로 EC를 적을 방법이
이 앱에 존재하지 않는다. 유량·차압도 없다. `conductivity`/`flow_rate`/
`diff_pressure` 컬럼과 타입(`types/index.ts` 74·76·78행)은 이미 있는데
**입력 폼만 비어 있다.**

부수 문제:
- `isAgri` 분기가 이 파일에 **아예 없다.** `useAgriRoute()`는 저장 후
  리다이렉트(20·88행)에만 쓰인다.
- 빈 상태·에러 문구 하드코딩: `"수조 목록을 불러오지 못했습니다"`(140행),
  `"등록된 수조가 없습니다"`(158행), `"수질 기록을 시작하려면 먼저 양식장과
  수조를 등록해 주세요"`(159행), `"양식장 등록하기"`(166행). i18n을 안 타므로
  agri-ko 오버라이드가 닿지 않는다.
- 빈 상태의 `/onboarding` 링크(162행)에 접두사가 없다 — 이건 설계서 4-4의
  의도된 예외(온보딩은 공유 화면)이므로 그대로 둔다.

### 1-2. 두 번째 측정 입력 경로 — `components/journal/journal-view.tsx`

일지 추가 다이얼로그에 **"수질 측정" 탭**이 있고, 여기서도 `insertWaterQuality`를
부른다(492~503행). 항목은 1-1과 동일한 9종(1226~1235행), 역시 **EC 없음**.
입력 폼을 고칠 때 이 경로를 빠뜨리면 반쪽이 된다.

### 1-3. 임계값 — `lib/thresholds.ts` + 두 호출 경로

`WQ_THRESHOLDS`(2~13행)는 흰다리새우 해수 기준 전역 상수다.

시드된 농업 실측값(`supabase/migrations/agriculture_demo_seed.sql` 241~246행:
수온 22.1~23.9 ℃, pH 5.88~6.19, DO 6.4~7.6 ppm, 염도 이하 전부 NULL)을
이 상수에 넣어 보면:

| 항목 | 농업 실측 | 새우 기준(warning/danger) | 판정 |
|---|---|---|---|
| **수온** | 22.1~23.9 | warning 25~32 / danger 22~35 | **매 수신 주의 알림** |
| pH | 5.88~6.19 | warning 7.5~8.5 / danger 7.0~9.0 | 위험 (레시피 있으면 회피됨) |
| DO | 6.4~7.6 | warning min 5.0 | 정상 |
| 염도 | NULL→0 | — | 0은 판정 제외 |

**수온 오탐이 살아 있다.** 근권부 냉방 칠러로 일부러 22~24 ℃를 유지하는 것이
설계 의도인데, 그 정상 운전이 그대로 경보가 된다.

수신 경로(`app/api/sensors/data/route.ts` 253~255행)는 레시피가 있을 때
`salinity`와 (목표 pH가 있을 때) `ph`만 전역 체크에서 뺀다. **수온·DO·알칼리도
등은 그대로 통과한다.**

수동 입력 경로(`lib/db.ts` 289~299행 `insertWaterQuality`)는 더 나쁘다 —
`checkRecipe`를 **아예 부르지 않고**, salinity 예외도 없다. 레시피 이탈 알림이
센서 값에만 생기고 손으로 적은 값에는 안 생긴다(비대칭).

`hasRecipe`/`checkRecipe`(94~147행)는 이미 잘 만들어져 있다. 문제는 **전역
기준의 적용 범위**이지 레시피 로직이 아니다.

### 1-4. 모니터링 대시보드 — `components/dashboard/dashboard-view.tsx`

| # | 요소 | 현재(새우 전제) | 행 |
|---|---|---|---|
| a | 저재고 배너 | `getInventoryItems()` 결과로 배너가 뜬다. 농업에서는 **버튼만** 숨겼고 배너 본체는 그대로 렌더된다 | 205~225 (버튼 조건 217) |
| b | StatCard 4번째 | **최근 진단(비브리오 검사 종류·결과)** — 새우 질병 진단 | 263 |
| c | 메인 차트 | 수온·DO·pH 3선. **EC가 없다** — 농업의 1순위 지표가 대시보드에 없다 | 164~172, 298~300 |
| d | 최신값 요약 타일 3개 | **판정이 하드코딩된 새우 기준**: 수온 `>=25 && <=32`, DO `>=5`, pH `>=7.5 && <=8.5`. 농업 실측(22.3 ℃, pH 5.88)이면 3개 중 **2개가 빨강** | 314~316 |
| e | 베드 목록 부제 | `tank.cycle_day` 원시 숫자. 농업 베드는 0 | 352 |
| f | 진단 표 | 농업에서 카드째 숨김 (개정 1에서 처리 완료) | 403~448 |
| g | 유량·차압 | **어디에도 없다.** 필터 막힘·펌프 정지는 수경재배의 핵심 고장 모드인데 대시보드에 신호가 없다 | — |

즉 **농업 농가가 첫 화면에서 보는 것: 빨간 타일 2개, 비브리오 카드 1개, EC 0개.**

### 1-5. 양액 관리 — `components/water-quality/water-quality-view.tsx`

| # | 요소 | 현재 | 행 |
|---|---|---|---|
| a | 상단 요약 스트립 | 재배일수 `0일차` / 용량 / **입식수 `0 마리`** / **밀도 `0 마리/㎥`** — 뒤 둘은 농업 베드에서 항상 0이고 agri-ko 오버라이드도 없다 | 846~865 |
| b | "항목별 현재 양액 상태" | `PARAM_META` 9종 **전부** 배지로 렌더. 판정은 `WATER_QUALITY_STANDARDS`(`lib/mock-data.ts` 158~167행, 새우 해수 기준). 농업 데이터 넣으면 **수온·pH·염도·알칼리도 4개가 빨강**, 나머지는 값이 0인 채 "정상" | 960~988 |
| c | 센서 비교 차트 항목 선택 | `["temperature","ph","do_level","salinity"]` 고정 — 농업에 **EC가 없고 염도가 있다** | 1064 |
| d | CSV 내보내기 | 염도/암모니아/아질산염/질산염/알칼리도/탁도 열을 항상 쓴다 | 690~695 |
| e | 그래프 탭 | 개정 1에서 농업 순서·더보기 접기 처리 완료 | 1160~1186 |

### 1-6. 일지 — 폼과 목록

**폼** `components/record/journal-record-view.tsx` (88~132행). 전부 하드코딩
한국어, i18n도 `isAgri` 분기도 없다:

| 스텝 | 항목 | 행 |
|---|---|---|
| 1 | `"수조 선택"` / 날짜 | 92~93 |
| 2 | **사료 종류**(PHOCA 9071~9075 — 새우 사료 상품명) / **급이량 kg** / **급이 횟수 회/일** | 99~101 |
| 3 | **폐사 수 마리** / **일일 환수율 %** (힌트 `"하루 교환하는 물의 비율 (10~30% 권장)"`) | 107~108 |
| 4 | 소독 여부·종류 / **미생물 투여**(컬리버 1~3호) | 114~118 |
| 5 | **폭기 장치 / 여과 장치 / 순환 장치 / 급이 장치** 점검 스위치 / 메모 | 125~129 |

선택지 상수는 `lib/record-actions.ts` 7~11행 (`FEED_TYPES`, `MICROBIAL_TYPES`).

빈 상태 하드코딩: `"양식 일지를 작성하려면 먼저 양식장과 수조를 등록해 주세요"`
(164행), `"양식장 등록하기"`(171행).

**목록** `components/journal/journal-view.tsx` — 카드 상단 4타일(189~209행):
급이량 kg / **폐사 N 마리** / 환수율 % / 미생물. agri-ko가 `journal.catFeeding`을
`"양액 보충"`으로 바꾸지만 **단위는 kg 그대로**(양액은 L다). 폐사 타일은
`t.journalX.mortality`·`t.journalX.unitFish`를 쓰는데 **`journalX`는 agri-ko에
오버라이드가 단 한 줄도 없다** — `ko.ts` 793~877행 전체가 새우 어휘
(사료·급이 횟수·폐사·환수율·비브리오·병원성 비율·섭이 반응·에어레이터…)다.

### 1-7. 베드 등록·편집 폼 — `components/farms/farms-view.tsx`

**폼은 이미 정리돼 있다**(개정 1). `isAgriFarm = farm.farm_type === "agriculture"`
기준으로 입식 밀도(616~630행)·입식일/출하일(631~654행)을 숨기고 용량 라벨을
"양액조 용량"으로 바꾸고 레시피 섹션(655행 `RecipeFields`)을 붙인다. 저장 시
새우 칸은 0/null(474~500, 887~906행).

**남은 것은 카드다.** `TankCard`(1431~1526행)는 농업 베드에도 그대로:

- 1449~1454행 — 재배일수 칩. `stocking_date`가 null이라 `cycle_day`(=0)로
  `"0일차"`가 뜬다.
- 1464~1469행 — **밀도 타일 `0 마리/㎥`**
- 1470~1475행 — **입식 마리수 타일 `0 마리`** (`Fish` 아이콘 + `t.farmsX.shrimpCount`)
- 1497~1511행 — 레시피 요약 (개정 1에서 추가됨, 정상)

즉 농업 농가의 베드 카드 절반이 `0 마리`다.

### 1-8. 홈 허브 / 기록 허브

- `components/home/home-view.tsx` — i18n만 쓴다(`t.hub.*`, `t.homeHub.*`,
  `t.dashboard.*`). agri-ko가 이미 덮고 있어 **새우 잔재 없음.** 링크 접두사도
  정상(132·157·171행). 판정 로직(43행)도 설계대로.
- `components/record/record-hub-view.tsx` — 마찬가지. 다만 부제
  `t.recordX.waterQualitySub`·`journalSub`(33·47행)가 **agri-ko에 없다.**
  `recordX` 섹션 전체가 오버라이드 미적용.

### 1-9. 기타

- `components/sensors/device-current-values.tsx` 12~26행 — payload 라벨에
  EC·유량·차압이 이미 들어 있다. **손댈 필요 없음.**
- `app/(dashboard)/daumlabs/` 8개 페이지 래퍼 존재 확인. 라우팅은 정상.
- `lib/agri-route.ts` 확인. `isAgri`/`href` 계약 그대로 쓴다.

---

## 2. 조사 결과 요약표 (화면 → 새우 요소 → 위치 → 농업 대안)

| 화면 | 새우 요소 | 파일:행 | 농업 대안 | 중요도 |
|---|---|---|---|---|
| 측정 입력 | **EC 입력 칸 없음** | `record/water-quality-record-view.tsx:96-127` | EC(mS/cm) 1순위 필드 신설 | **1** |
| 임계값 | 수온 새우 기준이 농업 베드에 적용 → 상시 오탐 | `lib/thresholds.ts:2`, `api/sensors/data/route.ts:253-255` | `AGRI_THRESHOLDS` + `farm_type` 분기 | **1** |
| 대시보드 | 요약 타일 판정 하드코딩(새우) | `dashboard/dashboard-view.tsx:314-316` | 레시피 기준 EC/pH + 농업 수온/유량 | **1** |
| 양액 관리 | 항목 상태 배지 9종 전부 새우 기준 | `water-quality/water-quality-view.tsx:960-988` | 농업 6종만 + 레시피/농업 기준 | **1** |
| 일지 폼 | 사료·급이·폐사·환수·폭기 | `record/journal-record-view.tsx:99-129` | 양액 보충/교환·방제·설비 점검 | **2** |
| 측정 입력 | 염도·암모니아·아질산·질산·알칼리도·탁도 | `record/water-quality-record-view.tsx:104,115-123` | 농업 폼에서 제외(0 저장) | **2** |
| 대시보드 | 메인 차트에 EC 없음 | `dashboard/dashboard-view.tsx:164-172` | EC 단독 차트 + 목표 밴드 | **2** |
| 대시보드 | 4번째 StatCard = 비브리오 진단 | `dashboard/dashboard-view.tsx:263` | EC 이탈 알림 건수 | **2** |
| 베드 카드 | 밀도 `0 마리/㎥`, 입식수 `0 마리` | `farms/farms-view.tsx:1464-1475` | 타일 숨김 + 베드 유형·레시피 | **2** |
| 양액 관리 | 요약 스트립 입식수·밀도 | `water-quality/water-quality-view.tsx:846-865` | 정식일·재배일수·양액조 용량 | **2** |
| 일지 목록 | 폐사 타일, 급이량 kg | `journal/journal-view.tsx:189-209` | 폐사 숨김, 보충량 L | **2** |
| 일지 폼 | 두 번째 WQ 입력 경로(EC 없음) | `journal/journal-view.tsx:1226-1235` | 측정 폼과 같은 규칙 적용 | **2** |
| 일지 어휘 | `journalX` 전체 오버라이드 없음 | `lib/i18n/ko.ts:793-877` | agri-ko에 `journalX` 섹션 추가 | **3** |
| 대시보드 | 저재고 배너 본체가 농업에도 렌더 | `dashboard/dashboard-view.tsx:205-225` | 배너째 `!isAgri` | **3** |
| 대시보드 | 유량·차압 신호 없음 | — | 차압 추세 미니 카드 | **3** |
| 양액 관리 | 센서 비교 항목에 EC 없고 염도 있음 | `water-quality/water-quality-view.tsx:1064` | EC·pH·수온·DO | **3** |
| 양액 관리 | CSV 열이 새우 6종 고정 | `water-quality/water-quality-view.tsx:690-695` | 농업 6종 열 | **3** |
| 측정/일지 폼 | 빈 상태·에러 문구 하드코딩 | `record/*-view.tsx:140,158-166 / 145,163-171` | i18n 추출 + agri-ko | **3** |
| 기록 허브 | `recordX` 부제 오버라이드 없음 | `record/record-hub-view.tsx:33,47` | agri-ko에 `recordX` 추가 | **3** |

---

## 3. 결정 사항

### 3-1. 측정 입력 폼 — 농업판 항목과 순서

**농업 모드(`isAgri`)일 때 받는 항목. 이것이 전부다.**

| 스텝 | 키 | 라벨 | 입력 단위 | 저장 | 필수 | 힌트 |
|---|---|---|---|---|---|---|
| 1 | `tank_id` | 베드 선택 | — | — | 필수 | — |
| 2 | `date` | 날짜 | — | — | 필수 | — |
| 2 | `conductivity` | **EC** | **mS/cm** | **×1000 → µS/cm** | 선택 | 베드 레시피가 있으면 `목표 1.80 ±0.10 mS/cm` |
| 2 | `ph` | pH | — | 그대로 | 선택 | 레시피 있으면 `목표 6.0 ±0.5`, 없으면 `엽채류 권장 5.5~6.5` |
| 3 | `temperature` | 양액 온도 | °C | 그대로 | 선택 | `근권 권장 18~22 °C (칠러 가동 시)` |
| 3 | `do_level` | DO | ppm | 그대로 | 선택 | `5 ppm 이상 권장` |
| 4 | `flow_rate` | 유량 | L/min | 그대로 | 선택 | `급락 시 펌프·배관 점검` |
| 4 | `diff_pressure` | 차압 | kPa | 그대로 | 선택 | `상승 시 UV 살균기·필터 막힘 의심` |

- 스텝은 5개 → **4개**로 줄인다. 마지막 스텝에 `title: t.wizard.confirmTitle`.
- **EC를 첫 입력 항목으로 둔다.** 사업 KPI가 EC 제어 정확도다.
- 힌트에 **베드 레시피 목표값을 실제로 표시한다.** `tanks.target_ec`는 이미
  `Tank` 타입에 있고(`types/index.ts:52`) `getAllTanks()`가 `select("*")`로
  가져오므로 **추가 조회 0회**다. 레시피 없는 베드는 일반 권장 범위 문구.

**새우 6항목(염도·암모니아·아질산염·질산염·알칼리도·탁도)은 숨긴다 — 접지 않는다.**

근거:
1. NFT 재순환 양액에 해수 염도 개념이 없다. 알칼리도·탁도도 측정 관행이 없다.
2. 질소 3종은 양액에서 의미가 아주 없진 않지만(질산태 질소), 새우용 임계값·
   단위·힌트 문구가 전부 다르다. 어중간하게 남기면 농가가 새우 기준으로
   판단하게 된다.
3. `/water-quality` **그래프 탭**은 "더보기"로 접었다(수아 시안 5-1). 그건
   **이미 쌓인 데이터를 보는** 화면이라 접기가 맞다. **입력 폼은 새 데이터를
   만드는** 화면이다. 접어 두면 언젠가 누군가 펼쳐서 농업 베드에 새우 기준
   데이터를 쌓는다. **만들 수 없게 하는 것이 보는 것을 막는 것보다 강하다.**

저장 시 6항목은 `0`을 보낸다. `checkThresholds`가 `value === 0`을 건너뛰므로
(`lib/thresholds.ts:42`) 알림 오탐이 생기지 않는다. 컬럼 제약도 없다.

**수동 입력이 실제로 필요한 항목은 무엇인가** (센서 자동 수신과의 역할 분담):

| 항목 | 센서 자동 | 수동 입력의 이유 |
|---|---|---|
| EC | ○ (1분) | **휴대용 EC 미터 대조값.** 센서 드리프트 교정의 기준이 된다. 가장 중요한 수동 항목 |
| pH | ○ | 휴대용 pH 미터 대조. pH 전극은 드리프트가 크다 |
| 수온 | ○ | 대조·백업 |
| DO | ○ | 대조·백업 |
| 유량 | ○ | 유량계 눈금 직독. 센서 미설치 베드 |
| 차압 | ○ | 압력계 2개 차이 직독. 센서 미설치 베드 |

즉 농업 모드의 수동 입력은 **센서 대체가 아니라 센서 대조**가 주 용도다.
폼 상단에 그 취지를 한 줄로 알린다(문안은 수아).

**원수 EC(지하수·수돗물 EC)는 이번에 받지 않는다.** 보충량 계산의 입력이지만
저장 칸이 없고, 계산의 진실은 장비에 있다는 역할 분담(설계서 2장 관찰 1)이
이미 서 있다. 컬럼을 새로 뚫을 만큼 급하지 않다 → 6장 로드맵.

**일지 다이얼로그의 "수질 측정" 탭**(`journal-view.tsx:1226-1235`)도 같은 규칙을
받는다. 두 입력 경로가 다른 항목을 받으면 데이터가 갈라진다.

### 3-2. 일지 카테고리 — DB 확인 결과와 매핑

**DB 확인: `journal_entries`에 category enum도 CHECK 제약도 없다**
(`supabase/schema.sql:126-147`). 카테고리 개념 자체가 없고, 고정 폭 컬럼
테이블이다. agri-ko의 `catFeeding`/`catWaterChange` 등은 **카테고리가 아니라
개별 컬럼 타일의 라벨**이다.

→ **enum 마이그레이션 불필요.** 대신 **컬럼 재해석 매핑**을 확정한다.

| 기존 컬럼 | 타입 | 농업 의미 | 농업 단위 | 폼 노출 |
|---|---|---|---|---|
| `feed_type` | TEXT | 양액 종류 | — | ○ (선택지 교체) |
| `feeding_amount` | NUMERIC | **양액 보충량** | **L** | ○ |
| `feeding_times` | INTEGER | 보충 횟수 | 회/일 | ○ |
| `water_exchange_rate` | NUMERIC | **양액 교환율** | % | ○ |
| `disinfection` | BOOLEAN | **방제 실시** | — | ○ |
| `disinfection_type` | TEXT | 약제명 | — | ○ |
| `microbial_input` | BOOLEAN | **자재 투입** | — | ○ |
| `microbial_type` | TEXT | 자재 종류 | — | ○ (선택지 교체) |
| `microbial_amount` | NUMERIC | 투입량 | — | ○ |
| `check_circulation` | BOOLEAN | 순환 펌프 점검 | — | ○ |
| `check_filtration` | BOOLEAN | **필터·UV 살균기 점검** | — | ○ |
| `check_aeration` | BOOLEAN | **근권 냉방 칠러 점검** | — | ○ |
| `check_feeding_check` | BOOLEAN | **생육 상태 확인** | — | ○ |
| `notes` | TEXT | 메모 | — | ○ |
| `mortality_count` | INTEGER | — 대응물 없음 | — | **× (0 저장)** |

**`mortality_count`를 다른 뜻으로 재활용하지 않는다.** 컬럼 이름과 뜻이
어긋나는 순간 나중에 반드시 사고가 난다. 농업에서는 안 쓰고 0으로 둔다.

**농업판 선택지 상수** (`lib/record-actions.ts`에 신설, 기존 `FEED_TYPES`·
`MICROBIAL_TYPES`는 손대지 않는다):

```
AGRI_NUTRIENT_TYPES = ["A/B 표준 배양액", "자가 배양액", "추비(단비)", "기타"]
AGRI_INPUT_TYPES    = ["미생물제", "칼슘·규산 보충제", "천적", "기타"]
```

**정식·수확은 이번 범위에 넣지 않는다.** 근거: 수확 실적 관리는 `/production`
재설계(설계서 8장 로드맵)의 몫이다. 일지에 `harvest_kg` 컬럼을 뚫으면
`production` 테이블과 이중 관리가 되고, 나중에 어느 쪽이 진실인지 다투게 된다.
1단계에서는 `notes`에 적도록 안내하고, **연간 수확 9회 KPI 산출은 로드맵**으로
명시한다.

**농업 일지 폼 구성 (4스텝)**:

1. 베드 선택 / 날짜
2. 양액 관리 — 양액 종류(select) / 보충량(L) / 보충 횟수(회/일) / 교환율(%)
3. 재배 작업 — 방제 실시(switch) → 약제명 / 자재 투입(switch) → 종류·투입량
4. 설비 점검 + 메모 — 순환 펌프 / 필터·UV / 근권 냉방 칠러 / 생육 상태 / 메모

`loadJournalDefaults`/`saveJournalDefaults`의 localStorage 키
(`JOURNAL_DEFAULTS_KEY`)는 **농업용으로 분리한다** (`journal_form_defaults_agri`).
혼합 계정이 두 폼을 오가며 기본값이 섞이면 새우 폼에 양액 종류가 뜬다.

### 3-3. 베드 폼과 카드 — **DB 컬럼 추가 없음**

폼은 이미 정리됐다(1-7). 결정할 것은 **무엇을 대신 받고 보여줄 것인가**다.

**결정: 새 컬럼을 만들지 않고 기존 컬럼을 농업 의미로 되살린다.**

| 필요한 농업 정보 | 처리 | 근거 |
|---|---|---|
| 작물명 | **받지 않음** | 현재 쪽파 단일 작목. `farms.name`(`제1온실`)·`tanks.name`(`1번 베드 (NFT-A)`)로 충분히 식별된다. 작물이 늘면 그때 컬럼을 만든다 |
| **정식일** | **`stocking_date` 재사용, 라벨만 "정식일"** | 의미가 1:1이다. 개정 1에서 숨겼던 필드를 **농업 라벨로 되살린다** |
| **수확 예정일** | **`harvest_date` 재사용, 라벨 "수확 예정일"** | 위와 같음 |
| **재배일수** | `cycle_day` — `stocking_date`에서 자동 계산 | agri-ko에 `cycleDays: "재배일수"`가 이미 있다. 정식일이 들어오면 `0일차`가 사라진다 |
| 양액조 용량 | `volume` (㎥) — 이미 처리됨 | — |
| 베드 유형 | `tank_type` (노지/실내/반실내) — 이미 처리됨, 기본 "실내" | CHECK 제약이 있으므로 값은 그대로 두고 라벨만 "베드 유형" |
| 베드 단수(다단 층수) | **로드맵** | 새 컬럼 필요. 하드웨어 스펙(단수·단당 정식공 수)이 확정되지 않아 지금 정하면 다시 고친다 |
| 재배 면적(㎡) | **로드맵** | `farms.area`(농장 단위)는 있으나 베드 단위는 없다. 단수와 함께 결정해야 한다 |
| 양액 레시피 | `target_ec`/`ec_tolerance`/`target_ph`/`ph_tolerance` — 이미 있음 | — |
| 입식 밀도·마리수 | **폼·카드 모두 제외** | — |

이 결정으로 **DB 마이그레이션이 0건이 된다.** 개정 1에서 "숨김"으로 처리한
두 날짜 필드를 되살리는 것이므로 `farms-view.tsx` 616~654행·985~989행의
`!isAgriFarm` 조건을 **밀도에만 남기고 날짜에서는 뗀다.**

**베드 카드**(`farms-view.tsx:1456-1494`) 농업판 타일 구성:

| 타일 | 값 |
|---|---|
| 양액조 용량 | `volume` ㎥ |
| 베드 유형 | `tank_type` |
| 정식일 | `stocking_date` (있을 때만) |
| 수확 예정일 | `harvest_date` (있을 때만) |
| (기존) 레시피 요약 | `⚗ EC 1.80 ±0.10 · pH 6.0 ±0.5` |

밀도 타일(1464~1469행)·입식 마리수 타일(1470~1475행)은 `!isAgriFarm`으로 감싼다.
재배일수 칩(1449~1454행)은 `stocking_date`가 있을 때만 렌더한다(농업·새우 공통으로
안전 — 새우는 `stocking_date`가 없으면 `cycle_day`를 쓰던 기존 폴백을 유지).

### 3-4. 모니터링 대시보드 — 농업판 구성

**농업 농가가 첫 화면에서 봐야 할 것**을 우선순위대로 배치한다.

| 위치 | 새우 | 농업 |
|---|---|---|
| 배너 | 알림 배너 / **저재고 배너** | 알림 배너만 (저재고 배너 `!isAgri`) |
| 바로가기 | 양액·일지·AI·재고 | 양액·일지 (이미 필터됨) |
| StatCard 1 | 운영 농장 | 그대로 |
| StatCard 2 | 가동 베드 | 그대로 |
| StatCard 3 | 오늘 알림 | 그대로 |
| **StatCard 4** | **최근 진단(비브리오)** | **EC 이탈 알림** — `alerts.filter(a => a.parameter === "EC").length`, 부제 `베드 레시피 기준 이탈`. **추가 조회 0회** (`alerts`는 이미 로드돼 있다) |
| **메인 차트** | 수온·DO·pH 3선 | **EC 단독 라인 + 목표선·허용밴드.** 축 스케일이 다르므로(EC 1800 vs pH 6) 한 차트에 섞지 않는다. `/water-quality`의 `ConductivityChart` 결과 색·`ReferenceArea` 패턴을 그대로 쓴다 |
| **최신값 타일** | 3개, 판정 하드코딩 | **4개**: EC / pH / 양액 온도 / 유량. 판정 규칙은 아래 |
| 우측 베드 목록 | `cycle_day` 숫자 | 레시피 요약(`EC 1.80`) 또는 재배일수. `cycle_day === 0`이면 아무것도 안 쓴다 |
| **신규** | — | **차압 추세 미니 카드** — 최근 24h `diff_pressure` 스파크라인 + 상승 추세면 `필터·UV 살균기 점검 권장`. `wqData`에 이미 들어 있어 **추가 조회 0회** |
| 양액 상태 카드 | (없음) | 그대로 (개정 1) |
| 진단 표 | 표시 | 숨김 (개정 1) |

> **구현 중 정정 (태양 리뷰 Y-1)** — 부제를 `목표 ±0.1 mS/cm` 로 쓰라고 이 표가
> 지시했으나 구현에서 **무수치 문안**으로 바꿨다. 카운트는 전 베드 합산인데 부제가
> ±0.10 을 단언하면, `ec_tolerance` 가 다른 베드(데모 시드 2번 베드 = ±0.15)에서
> 운영자가 실제 알림선과 다른 값을 믿고 조정하게 된다. ±0.1 dS/m 는 사업 KPI 지
> 전역 기준선이 아니다 — "전역 EC 기준선 없음" 원칙이 문안보다 우선한다.

**최신값 타일 판정 규칙 (농업)** — 색을 함부로 칠하지 않는다:

| 타일 | 정상 판정 | 기준이 없을 때 |
|---|---|---|
| EC | `\|EC − target_ec\| <= ec_tolerance` | **판정 안 함 — 중립(회색) 표시.** 전역 EC 기준선을 긋지 않는다는 원칙 유지 |
| pH | `\|pH − target_ph\| <= ph_tolerance` | 농업 기본 5.5~6.5 |
| 양액 온도 | 18~24 °C | 같음 |
| 유량 | 값이 있으면 중립 표시(수치만) | 하한 알림은 로드맵 |

**"기준이 없으면 색을 칠하지 않는다"** 를 원칙으로 세운다. 지금 화면이 빨간
이유는 기준이 없어서가 아니라 **틀린 기준이 있어서**다. 없는 것보다 나쁘다.

### 3-5. 임계값 — 오탐을 끊는 방법

**판정 축은 URL이 아니라 데이터다.** 서버 수신 경로에 URL은 존재하지 않는다
(설계서 4-7의 무영향 원칙). 그러므로 축은 **`farms.farm_type`** 이다.

**왜 `hasRecipe(tank)`가 아니라 `farm_type`인가.** 레시피를 아직 입력하지 않은
농업 베드가 있다(온보딩에서 레시피는 선택 입력이다). `hasRecipe`로 가르면
그 베드는 계속 새우 기준을 맞는다. `farm_type`은 농장 등록 시점에 반드시
정해지므로 빈 구멍이 없다.

**설계 (`lib/thresholds.ts`)**:

```ts
export type FarmProfile = "shrimp" | "agriculture"

// 수경재배(엽채류 NFT) 양액 전역 기준.
// 레시피(베드별 목표)가 우선이고, 이 상수는 레시피가 없을 때의 안전망이다.
export const AGRI_THRESHOLDS = {
  temperature: { warning: { min: 16, max: 26 }, danger: { min: 12, max: 30 } },
  ph:          { warning: { min: 5.5, max: 6.5 }, danger: { min: 5.0, max: 7.0 } },
  do_level:    { warning: { min: 4.0, max: null }, danger: { min: 2.0, max: null } },
}

// 두 번째 인자 기본값이 "shrimp" 다 → 기존 호출부 전부 무변. 새우 회귀 0.
export function checkThresholds(values, profile: FarmProfile = "shrimp"): ThresholdAlert[]
```

농업 프로필에서의 동작:

1. 판정 항목은 **수온·pH·DO 3종뿐.** 염도·암모니아·아질산염·질산염·알칼리도·
   탁도는 **판정 대상에서 제외**한다(값이 0이라 어차피 걸러지지만, 옛 데이터나
   혼입 값에 대한 방어). 
2. `target_ph`가 있으면 pH는 `checkRecipe`가 맡고 전역 pH 체크는 건너뛴다
   — 기존 route.ts 255행 규칙 그대로.
3. EC는 레시피가 있을 때만 판정한다 — **전역 EC 기준선 없음** 원칙 유지.
4. 라벨은 농업 어휘로: `수온` → `양액 온도`.

**도메인 수치의 근거와 한계 — 반드시 명시한다.**

`AGRI_THRESHOLDS`의 값은 **엽채류 수경재배의 일반 통설**에 기반한 것이며,
**쪽파 전용 실증 데이터가 아니다.**

- 근권 양액 온도: 권장 18~22 °C. 25 °C를 넘으면 용존산소가 떨어지고 피시움
  등 근부병 위험이 오른다. → warning 상한 26, danger 상한 30. 겨울 하한은
  칠러 과냉·외기 유입 감지용으로 16/12.
- 양액 pH: 엽채류 권장 5.5~6.5. 이 범위를 벗어나면 미량요소 흡수가 막힌다.
  → warning 5.5~6.5, danger 5.0~7.0.
- 양액 DO: 5 ppm 이상 권장. → warning 하한 4.0, danger 하한 2.0.
- 시드 데이터의 실측(22.1~23.9 °C, pH 5.88~6.19, DO 6.4~7.6)이 모두 warning
  범위 안에 들어온다 — 오탐이 사라진다는 것을 수치로 확인했다.

**이 값들은 나주 시험포 운영 데이터가 쌓이면 재교정해야 한다.** 특히 여름철
칠러 부하 한계에서의 실제 상한을 모른다. 태양 리뷰 시 "이 수치가 실증치가
아님"을 보고에 남길 것.

**적용 지점 두 곳**:

| 경로 | 현재 | 변경 |
|---|---|---|
| 센서 수신 `app/api/sensors/data/route.ts:238-260` | tank만 조회, `salinity`/`ph`만 예외 | tank 조회에 `farms!inner(farm_type)` **조인 추가**(쿼리 수 증가 0) → `checkThresholds(globalValues, profile)` |
| 수동 입력 `lib/db.ts:276-320` | `checkThresholds`만, `checkRecipe` 없음 | tank의 `farm_type` + 레시피를 1회 조회 → `checkThresholds(values, profile)` + `checkRecipe(values, recipe)` |

**주의**: 개정 1 문서 7-A "하지 말 것"에 `lib/thresholds.ts`·`route.ts` 변경
금지가 있다. 그 금지는 **개정 1(라우팅 축 교체) 범위 한정**이었다. 라우팅
변경과 알림 로직 변경을 한 커밋에 섞지 말라는 뜻이지 영구 금지가 아니다.
개정 2에서 해제한다. **다만 커밋은 분리한다** — 화면 변경과 알림 로직 변경을
같은 커밋에 넣으면 회귀 원인 추적이 어렵다.

`lib/db.ts` 조회 실패(마이그레이션 전 DB 등)는 `try/catch`로 삼키고
`profile = "shrimp"`로 폴백한다 — **기본값은 언제나 새우**(절대 원칙).

### 3-6. `WATER_QUALITY_STANDARDS`(화면 표시용 기준)

`lib/mock-data.ts:158-167`은 화면 배지·차트 기준선용 별도 상수다.
`lib/thresholds.ts`와 값이 겹치지만 **통합하지 않는다** — 통합하면 새우 화면의
차트 기준선이 미세하게 움직여 회귀가 된다. 대신 농업용 표시 기준을 별도로 둔다:

```ts
// lib/mock-data.ts 또는 신규 lib/agri-standards.ts
export const AGRI_QUALITY_STANDARDS = {
  temperature: { min: 18, max: 24, warning_min: 16, warning_max: 26, unit: "°C" },
  ph:          { min: 5.5, max: 6.5, warning_min: 5.0, warning_max: 7.0, unit: "" },
  do_level:    { min: 5.0, max: 10.0, warning_min: 4.0, warning_max: 12.0, unit: "ppm" },
  conductivity:{ /* 전역 기준 없음 — 레시피로만 판정 */ },
  flow_rate:   { /* 전역 기준 없음 — 로드맵 */ },
  diff_pressure:{ /* 전역 기준 없음 — 로드맵 */ },
}
```

배치 위치(기존 파일 확장 vs 신규 파일)는 서연이 판단하되, **새우 상수의 값을
한 글자도 바꾸지 않는다**가 조건이다.

> **개정(구현 시 수정됨 — `lib/agri-standards.ts`가 실제 기준)**
> 위 블록처럼 표시용 숫자를 따로 적지 않는다. 손으로 적은 결과 표시 기준과 알림
> 기준(`AGRI_THRESHOLDS`)이 어긋나 DO 3.0 ppm·27 ℃가 "카드는 위험인데 알림은
> warning", DO 12 초과가 "카드는 위험인데 알림은 없음"이 됐다.
> `AGRI_QUALITY_STANDARDS`는 이제 `AGRI_THRESHOLDS`에서 파생한다:
> warning 밴드 = 화면 "정상", danger 밴드 = 화면 "주의", 그 밖 = 화면 "위험".
> 기준을 고칠 때는 `lib/thresholds.ts` 한 곳만 고친다.

"항목별 현재 양액 상태" 카드(`water-quality-view.tsx:960-988`)는 농업일 때
**표시 항목을 EC·pH·양액 온도·DO·유량·차압 6종으로 교체**하고, 기준이 없는
항목(EC 레시피 미설정·유량·차압)은 **중립 배지(값만, 색 없음)** 로 표시한다.

---

## 4. DB 마이그레이션 — **필요 없음 (0건)**

확인 결과:

| 항목 | 확인 | 결론 |
|---|---|---|
| `conductivity`/`flow_rate`/`diff_pressure` 컬럼 | `agriculture_mode.sql`에서 추가 완료, `types/index.ts:74-78` 반영됨 | 있음 |
| `tanks.target_ec` 외 레시피 4종 | `schema.sql:72-76` | 있음 |
| `farms.farm_type` | `schema.sql:53` (CHECK 포함) | 있음 |
| `journal_entries` 카테고리 enum/CHECK | **없음** — 카테고리 개념 자체가 없는 고정 폭 테이블 (`schema.sql:126-147`) | 마이그레이션 불필요, 컬럼 재해석으로 해결 (3-2) |
| `tanks.tank_type` CHECK | `('노지','실내','반실내')` — 값은 그대로 두고 라벨만 치환 | 변경 불필요 |
| 정식일·수확 예정일 | `stocking_date`/`harvest_date` 재사용 (3-3) | 컬럼 추가 불필요 |
| 원수 EC / 베드 단수 / 재배 면적 / 수확량 | 저장 칸 없음 | **로드맵으로 미룸** (6장). 지금 뚫으면 스펙 확정 후 다시 고친다 |

**이번 개정에 SQL 실행이 필요 없다.** 사람이 손으로 할 일이 하나 줄었다.
(단 `agriculture_mode.sql`·`agriculture_demo_seed.sql`을 아직 실행하지
않았다면 그것은 여전히 선행 조건이다.)

---

## 5. 작업 분해

### 5-A. 수아 (`sua-designer`) — UI·문안

`ui-ux-pro-max` 스킬을 쓴다. **기존 시안
(`docs/plans/agriculture-mode-ui.md`)의 톤·색·컴포넌트 결을 그대로 잇는다.
새 색·새 컴포넌트를 만들지 않는다.**

1. **농업 측정 입력 폼 시안** — `components/record/water-quality-record-view.tsx`
   - 3-1 표의 4스텝 구성 확정. 각 필드의 라벨·placeholder·unit·hint 문안.
   - 레시피 목표값을 힌트에 넣는 문장 형식 확정
     (예: `목표 1.80 ±0.10 mS/cm — 베드 레시피`).
   - 폼 상단 "센서 대조용 수동 입력" 안내 한 줄의 문안과 배치.
   - EC 입력 단위 표기(mS/cm)와 저장 단위(µS/cm) 차이를 농가가 오해하지 않게
     하는 표기 규칙.

2. **농업 일지 폼 시안** — `components/record/journal-record-view.tsx`
   - 3-2의 4스텝 구성. 라벨·단위·힌트.
   - `AGRI_NUTRIENT_TYPES`·`AGRI_INPUT_TYPES` 선택지 문안 확정.
   - 설비 점검 4종 라벨: 순환 펌프 / 필터·UV 살균기 / 근권 냉방 칠러 / 생육 상태.

3. **대시보드 농업판 시안** — `components/dashboard/dashboard-view.tsx`
   - 3-4 표대로. StatCard 4번째(EC 이탈 알림) 아이콘·색·부제.
   - EC 단독 차트: `/water-quality`의 `ConductivityChart` + `ReferenceArea`
     패턴(수아 시안 5-2)을 재사용. 대시보드 크기에 맞춘 조정만.
   - 최신값 타일 4개의 레이아웃과 **중립(회색) 상태 스타일 신규 정의** —
     지금은 `ok ? emerald : red` 2색뿐이라 "판정 없음"을 표현할 수단이 없다.
     3색(정상/이탈/판정없음)으로 확장. **색+텍스트 병기 원칙 유지.**
   - 차압 추세 미니 카드 레이아웃·문안.

4. **베드 카드·요약 스트립 농업판** —
   `components/farms/farms-view.tsx:1449-1494`,
   `components/water-quality/water-quality-view.tsx:846-865`
   - 3-3 표의 타일 구성. 숨길 것과 남길 것.

5. **항목별 상태 카드 농업판** —
   `components/water-quality/water-quality-view.tsx:960-988`
   - 6종 항목, 중립 배지 스타일(3번 항목과 같은 토큰 재사용).

6. **i18n 신규 키 + agri-ko 추가분 목록** — 기존 시안 3장의 형식 그대로.
   - `ko/en/vi/id` 4파일 + `types.ts`에 넣을 신규 키.
   - **`agri-ko.ts`에 신규 오버라이드 섹션 3개**: `journalX`(가장 큼 —
     `ko.ts:793-877` 중 농업에서 뜻이 달라지는 키), `recordX`, `waterQualityX`
     추가분(`stockedCount`·`density`·`dissolvedOxygen` 등).
   - **하드코딩 문구의 i18n 추출 목록** — 아래 파일:행의 한국어 리터럴:
     - `record/water-quality-record-view.tsx` 98, 140, 158, 159, 166
     - `record/journal-record-view.tsx` 92, 99~101, 107~108, 114~118,
       125~129, 145, 163, 164, 171

7. 기존 시안 문서에 "전역 모드 자동 전환" 전제로 쓰인 문장이 남아 있으면
   URL 전제로 고친다(개정 1 7-B 3의 잔여분 확인).

### 5-B. 서연 (`seoyeon-dev`) — 구현

**커밋을 3개로 나눈다.** 화면 변경과 알림 로직 변경을 섞지 않는다.

#### 커밋 1 — 임계값·알림 (화면 변경 없음)

1. `lib/thresholds.ts`
   - `FarmProfile` 타입, `AGRI_THRESHOLDS` 상수(3-5의 값과 한국어 근거 주석).
   - `checkThresholds(values, profile = "shrimp")` — **두 번째 인자 기본값이
     "shrimp"** 라 기존 호출부는 한 글자도 안 고쳐도 된다.
   - 농업 프로필: 수온·pH·DO만 판정, 나머지 6종 제외, 라벨 `양액 온도`.
2. `app/api/sensors/data/route.ts` 238~260행
   - tank 조회 select에 `farms!inner(farm_type)` 추가 (**쿼리 수 증가 0**).
   - `checkThresholds(globalValues, profile)`.
   - 기존 `salinity`/`ph` 예외 로직은 그대로 둔다(이중 안전).
   - 조회 실패 시 `profile = "shrimp"` 폴백 — 기존 `try/catch` 결 유지.
3. `lib/db.ts` `insertWaterQuality` 276~320행
   - tank의 `farm_type` + 레시피 1회 조회(`tanks ... farms!inner(farm_type)`).
   - `checkThresholds(values, profile)` + `checkRecipe(values, recipe)` 합산.
   - 실패는 비치명 — 기존처럼 알림 실패가 저장을 막지 않는다.
4. `lib/mock-data.ts`(또는 신규 `lib/agri-standards.ts`) — `AGRI_QUALITY_STANDARDS`
   추가. **기존 `WATER_QUALITY_STANDARDS` 값 변경 금지.**

#### 커밋 2 — 입력 폼

5. `components/record/water-quality-record-view.tsx`
   - `useAgriRoute().isAgri`로 `steps`·`values` 초기값·검증 배열·저장 payload를
     분기. **새우 분기는 현재 코드를 그대로 옮기기만 한다(diff가 들여쓰기뿐이어야
     한다).**
   - EC: 입력 mS/cm → 저장 `×1000` µS/cm. **환산 지점이 4번째로 늘어난다**
     (기존 3곳: 레시피 폼 저장, 목표선 라벨, 양액 카드 — 수아 시안 7-4).
     주석으로 남길 것.
   - 검증: `WQ_BOUNDS`(`lib/utils.ts:33-43`)에 `conductivity`·`flow_rate`·
     `diff_pressure` 항목 추가. 범위는 EC 0~20000 µS/cm, 유량 0~500 L/min,
     차압 0~500 kPa. **기존 9항목의 값 변경 금지.**
   - 농업 저장 시 새우 6항목은 `0`.
   - 힌트에 `tanks.target_ec`/`target_ph` 표시 — `tanks` state에 이미 있다.
     **추가 조회 금지.**
   - 하드코딩 문구를 i18n 키로 교체(수아 6번 산출물).
6. `components/record/journal-record-view.tsx`
   - `isAgri` 분기로 3-2의 4스텝. 새우 분기는 그대로 이동.
   - `mortality_count`는 농업에서 0 저장.
   - localStorage 기본값 키 분리(`journal_form_defaults_agri`).
7. `lib/record-actions.ts`
   - `AGRI_NUTRIENT_TYPES`·`AGRI_INPUT_TYPES` 추가. **`FEED_TYPES`·
     `MICROBIAL_TYPES` 변경 금지.**
   - `submitJournal`은 컬럼 매핑이 같으므로 **변경 없음.** 재고 자동차감
     (101~121행)은 농업에서 `feedItemId` 등이 빈 문자열이라 자연히 건너뛴다 —
     확인만 하고 손대지 말 것.
8. `components/journal/journal-view.tsx` 1226~1235행 — 일지 다이얼로그의
   "수질 측정" 탭 항목을 5번과 같은 규칙으로 분기(EC 추가, 새우 6종 숨김).
   441~443행 검증 배열, 492~503행 저장 payload도 함께.

#### 커밋 3 — 모니터링·목록 화면

9. `components/dashboard/dashboard-view.tsx`
   - 저재고 배너 205행 전체를 `!isAgri`로 감싼다(현재는 217행 버튼만).
   - StatCard 4번째(263행) `isAgri` 분기 → EC 이탈 알림.
   - 차트(164~172, 289~309행) `isAgri` 분기 → EC 단독 + 목표 밴드.
   - 최신값 타일(311~327행) `isAgri` 분기 → 4개 + 3색 판정(3-4).
   - 베드 목록 부제(352행) — `cycle_day === 0`이면 렌더 안 함.
   - 차압 추세 미니 카드 신규.
   - **`getDiagnoses()`·`getInventoryItems()` 호출 자체는 건드리지 않는다** —
     렌더만 막는다. 조건부 호출로 바꾸면 `reload`/`useEffect` 의존성이 갈라져
     회귀 위험이 이득보다 크다.
10. `components/water-quality/water-quality-view.tsx`
    - 요약 스트립(846~865행) `isAgri` 분기 → 재배일수·양액조 용량·정식일·레시피.
    - 항목 상태 카드(960~988행) `isAgri` 분기 → 6종 + `AGRI_QUALITY_STANDARDS`
      + 중립 배지.
    - 센서 비교 항목(1064행) `isAgri`면 `["conductivity","ph","temperature","do_level"]`.
    - CSV 열(690~695행) `isAgri` 분기.
11. `components/farms/farms-view.tsx`
    - 616~630행 밀도 필드 — `!isAgriFarm` **유지**.
    - 631~654행(Add)·985~989행(Edit) 날짜 필드 — **`!isAgriFarm` 조건을 뗀다.**
      라벨을 `isAgriFarm ? "정식일"/"수확 예정일" : 기존`으로.
    - 474~500행·887~906행 저장 — 농업에서도 `stocking_date`/`harvest_date`를
      저장하고 `cycle_day`를 계산한다. `stocking_density`·`shrimp_count`는
      계속 0.
    - `TankCard` 1449~1494행 — 3-3 표대로 타일 분기.
12. `lib/i18n/{ko,en,vi,id}.ts` + `types.ts` + `lib/i18n/agri-ko.ts` —
    수아 6번 산출물 반영.

#### 하지 말 것

- **DB 마이그레이션 작성 금지.** 4장에서 필요 없다고 판정했다.
- `journal_entries`에 컬럼 추가 금지. `mortality_count` 재해석 금지.
- 새우 상수 값 변경 금지: `WQ_THRESHOLDS`, `WATER_QUALITY_STANDARDS`,
  `WQ_BOUNDS` 기존 9항목, `FEED_TYPES`, `MICROBIAL_TYPES`.
- `checkThresholds`의 **첫 번째 인자 시그니처 변경 금지** — 기본값 인자
  추가만 허용.
- 페이지 컴포넌트 복사 금지. `/daumlabs` 라우트 구조 변경 금지.
- `lib/agri-route.ts` 계약 변경 금지.
- 라우팅 관련 파일(`middleware.ts`, `app/robots.ts`, `next.config.ts`) 무변.

### 5-C. 태양 (`taeyang-reviewer`) — 검수

1. **회귀 0이 최우선.** 새우 계정으로 8개 화면 + `/production`, `/inventory`,
   `/ai-advisor`, `/reports`, `/diagnosis` 전부 이전과 동일한지.
   특히 **측정 입력 폼·일지 폼의 새우 분기 diff가 들여쓰기뿐인지** 확인.
   로직 diff가 있으면 반려.
2. `checkThresholds`를 인자 없이 부르는 기존 호출부가 전부 새우 판정 그대로인지
   (`rg "checkThresholds\("` 로 호출부 전수).
3. 농업 베드에 시드 실측값(수온 22.3, pH 5.88, DO 7.42)을 넣었을 때
   **알림이 하나도 생기지 않는지.** 지금은 "수온 주의"가 생긴다 — 이 회귀
   테스트가 이번 개정의 합격 기준이다.
4. 농업 측정 폼에서 EC `1.85` 입력 → DB `conductivity = 1850` 인지(×1000 환산).
   레시피 `target_ec = 1800, tol = 100` 인 베드에서 알림이 안 생기는지.
   `1.95` 입력 시 warning(이탈 150 µS/cm — tol 초과·2×tol 이내),
   `2.10` 입력 시 **danger**(이탈 300 > 2×tol=200), `2.50` 도 danger 인지.
   (초판에 `2.10` → warning 이라 적혀 있었으나 `checkRecipe` 규칙상 오답이다.
   기대치를 틀리게 두면 나중에 누가 코드를 버그로 보고 고친다.)
5. 수동 입력 경로에서도 레시피 이탈 알림이 생기고, 정상 복귀 시 닫히는지
   (센서 경로와 대칭인지).
6. 농업 대시보드에 빨간 타일이 남아 있지 않은지. 판정 불가 항목이 회색인지.
7. 농업 베드 카드·요약 스트립에 `0 마리`가 하나도 없는지 (`rg "unitFish"` 렌더 경로).
8. 일지 농업 폼 저장 → `journal_entries` 행의 컬럼 매핑이 3-2 표대로인지,
   `mortality_count = 0` 인지.
9. `npm run build` 타입 체크. i18n 4개 언어 키 누락 없는지.
10. **`AGRI_THRESHOLDS` 수치가 쪽파 실증치가 아님**을 리뷰 코멘트에 남길 것.

---

## 6. 범위 밖 (로드맵)

- **원수 EC 수동 입력** — 보충량 계산 입력. 저장 칸 신설 필요.
- **베드 단수·재배 면적** — 하드웨어 스펙(단수·단당 정식공 수) 확정 후.
- **수확 실적** — `/daumlabs/production` 재설계와 함께. 연간 수확 9회 KPI의
  기반. 일지에 임시 칸을 뚫지 않는다(이중 관리 방지).
- **유량 하한·차압 상한 알림** — 베드별 설정으로 확장(설계서 8장에 이미 있음).
  지금은 대시보드 표시만.
- ~~**수동 입력 경로의 알림 중복 억제·자동 해제**~~ — **개정 3에서 구현했다.**
  개정 2에서 미룬 판단(새우 알림 동작이 바뀐다)은 그때는 옳았으나, 이후 만든
  대시보드 "EC 이탈" 타일이 열린 알림 **개수**를 세면서 결과가 달라졌다 —
  센서 없는 베드에서는 그 숫자가 단조 증가해 영영 0 이 안 된다. `lib/db.ts`
  `insertWaterQuality` 가 이제 센서 경로와 같은 규칙을 쓴다(같은 항목이 열려
  있으면 갱신, 범위 복귀 시 해제). 새우 수동 입력 동작 변화는 커밋 메시지와
  리뷰 보고의 표에 정리돼 있다.
- **축이 안 걸러지는 나머지 목록** — 개정 3에서 수조 목록을 화면 축에 맞춰
  거르는 처리(`belongsToAgriScreen()`)를 대시보드·양액 관리·일지·측정 입력 폼·
  일지 입력 폼 5개 화면에 넣었다. 아직 두 축을 섞어 보여 주는 곳이 셋 남았다:
  알림 패널(`components/layout/notifications-panel.tsx`)과 검색 패널
  (`search-panel.tsx`), 그리고 `/production`·`/inventory`·`/reports`
  (`/daumlabs` 변형이 없는 새우 전용 화면이라 혼합 계정에서 베드가 목록에
  섞인다). 읽기 전용이라 잘못 저장되는 행은 없지만, 혼합 계정이 늘면 먼저
  드러날 자리다. 알림 패널은 개정 3에서 착지점만 교정했다 — 다른 축 수조를
  가리키는 `?tank=` 는 그 수조가 사는 화면으로 넘긴다.
- **일지 페이지네이션이 축을 모른다** — 개정 3에서 일지 목록·CSV 에 축 필터
  (`visibleJournals`)를 넣으면서 새로 생긴 상태다. 서버는 여전히 안 걸러진
  20행 단위로 넘기므로, 혼합 계정에서 그 페이지에 농업 일지가 없으면
  **빈 목록 + "더 보기"** 가 뜬다. 데이터가 틀어지는 것은 아니지만 사용자
  눈에는 버그로 보인다. 서버에서 거르려면 `tanks!inner(farms!inner(farm_type))`
  가 되는데 그건 조인을 INNER 로 바꾸고 컬럼 이름을 집는 것이라, 마이그레이션
  전 DB 에서 쿼리가 400 으로 죽는 실패 모드를 되살린다(개정 3 내내 피한 것).
  대안은 수조 id 를 먼저 조회해 `.in("tank_id", ids)` 로 거는 것 — 왕복이 늘고
  목록 로딩 순서에 의존한다. 설계 비용이 실재하므로 별건으로 다룬다.

- **`farm_type` 을 선택 필드에서 "필수 + undefined 허용" 으로** — 개정 4의 버그
  (일지 저장 시 목록에서 사라짐)는 매핑 함수가 `farm_type` 을 빠뜨렸는데
  **선택 필드라 tsc 가 못 잡은** 것이 원인이었다. `farm_type?: T` 를
  `farm_type: T | undefined` 로 바꾸면 누락이 TS2741 이 된다(실측 확인).
  다만 지금 바꾸면 `lib/mock-data.ts` 의 목 객체 18개에 `farm_type: undefined`
  를 일일이 적어야 해 소음이 크다. 재발 방지의 실질은 이미 **매핑 함수와
  select 문자열의 단일화**(`toJournalEntry` · `JOURNAL_SELECT`)가 맡고 있으므로
  급하지 않다. 목데이터를 손볼 일이 생길 때 함께 처리한다. Farm · Tank ·
  Alert · JournalEntry 넷을 한 번에 바꿔야 한다.

- **생육 균일도 KPI** — 측정 방법(초장·엽수 샘플링)이 정해지지 않았다.
- **`AGRI_THRESHOLDS` 실증 재교정** — 나주 시험포 여름·겨울 각 1주기 데이터.
- 작물별 레시피 프리셋, 영어·베트남어·인니어 농업 오버라이드 사전.

---

## 7. 회귀 원칙 (재확인)

**새우 양식 화면은 픽셀 하나 바뀌면 안 된다.** 분기 축은 기존 그대로,
이번에 세 번째 축이 명시적으로 추가된다.

| # | 축 | 판정 입력 | 적용 대상 |
|---|---|---|---|
| 1 | **URL** | `useAgriRoute().isAgri` | 전역 화면 — 대시보드, 양액 관리, 측정 폼, 일지 폼·목록, 홈·기록 허브 |
| 2 | **farm 데이터** | `farm.farm_type` | `/farms`의 농장·베드 폼과 카드 (혼합 계정 대응) |
| 3 | **DB (신규 명시)** | `farms.farm_type` 조인 | **서버 판정** — 임계값·알림 생성. 서버에 URL은 없다 |

기계적 보증:

- `agriHref(p, false) === p` — 새우 링크는 문자열 그대로 (`lib/agri-route.ts:58`).
- `checkThresholds(values)` — 두 번째 인자 기본값 `"shrimp"`. 기존 호출부 무변.
- 모든 새우 상수(`WQ_THRESHOLDS`, `WATER_QUALITY_STANDARDS`, `WQ_BOUNDS` 9항목,
  `FEED_TYPES`, `MICROBIAL_TYPES`)는 값 변경 금지.
- 실패·불명 시 기본값은 언제나 새우.
