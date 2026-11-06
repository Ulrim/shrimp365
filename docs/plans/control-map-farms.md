# 관제센터 지도 — 회원 농장 위치 표시 + 표시 필터

- 작성: 민준 (PM·아키텍트)
- 작성일: 2026-10-16
- 상태: 설계 확정 → 서연(구현) → 태양(검수)

## 1. 현상과 원인

사용자: "관제센터에 수질센서가 등록된 것만 표기하지 말고 회원으로 가입된 농장 위치도 표기. 전체보기·농장만·수질센서만 등 구분."

`components/control/control-map.tsx` 는 이미 농장 표식을 그리지만 **`farms.latitude/longitude` 가 있는 농장만** 그린다. 그 좌표는 농가가 양식장 관리에서 직접 넣어야 생기므로 대부분 비어 있다. 반면 장비 표식은 페어링 때 휴대폰 위치가 자동으로 기록돼(`sensor_devices.latitude/longitude`) 늘 찍힌다. 그래서 "센서만 보인다".

## 2. 결정

### 2-1. 농장 위치는 세 단계로 채운다 (`app/api/control/overview/route.ts`)

| 순서 | 출처 | `coord_source` | 화면 표시 |
|---|---|---|---|
| 1 | 농가가 넣은 좌표 `farms.latitude/longitude` | `farm` | 정확한 위치 |
| 2 | 그 농장 장비들의 좌표 평균(`sensor_devices`, active) | `device` | 정확한 위치(장비 기준) |
| 3 | 농장 주소 `farms.location` 지오코딩 결과(캐시) | `address` | **대략 위치** — 표식 둘레 점선 고리, 팝업에 "주소 기준 대략 위치" |
| — | 셋 다 없음 | `null` | 지도 아래 "위치 미확인 농장 N곳" 접이식 목록(이름·소유자·주소) |

- 1·2는 사용자 데이터를 바꾸지 않는다(읽기만). **지오코딩 결과도 `farms` 에 쓰지 않는다** — 농가가 넣은 값과 섞이면 안 된다. 별도 캐시 테이블에 둔다.

### 2-2. 지오코딩

- 새 테이블 `supabase/migrations/farm_geocodes.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS public.farm_geocodes (
    farm_id     uuid PRIMARY KEY REFERENCES public.farms(id) ON DELETE CASCADE,
    query       text NOT NULL,           -- 지오코딩에 쓴 주소 문자열(바뀌면 다시 찾는다)
    latitude    double precision,        -- 실패면 NULL
    longitude   double precision,
    precision   text,                    -- 'address' | 'region'(읍면동·시군 수준으로 줄여서 찾음)
    provider    text,                    -- 'kakao' | 'nominatim'
    geocoded_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE public.farm_geocodes ENABLE ROW LEVEL SECURITY;  -- 정책 없음: service_role 전용
  NOTIFY pgrst, 'reload schema';
  ```
- 제공자 `lib/geocode.ts`(서버 전용):
  - `KAKAO_REST_API_KEY` 가 있으면 **카카오 로컬 주소 검색**(`https://dapi.kakao.com/v2/local/search/address.json`, 헤더 `Authorization: KakaoAK …`) — 한국 주소에 가장 정확.
  - 없으면 **OpenStreetMap Nominatim**(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=kr&limit=1&q=…`). 이용 정책 준수: 초당 1건 이하, `User-Agent: Shrimp365/1.0 (+https://www.shrimp365.kr)`, 결과는 반드시 캐시.
  - 상세 주소로 못 찾으면 뒤에서부터 토큰을 줄여 재시도(예: "전라남도 무안군 해제면 ○○길 12-3" → "… 해제면" → "… 무안군"), 줄여서 찾았으면 `precision = 'region'`. 최대 3회.
- **언제 찾나**: overview 응답을 늦추지 않는다. 응답은 캐시만 쓰고, 캐시가 없거나 `query` 가 현재 주소와 다른 농장을 **응답 후** Next 16 `after()`(`next/server`, 문서 `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`)로 최대 10곳까지 찾아 캐시에 넣는다(Nominatim 이면 1.1초 간격). 다음 새로고침부터 보인다. 실패도 캐시(`latitude NULL`)해서 같은 주소를 매번 다시 묻지 않는다 — 실패 캐시는 7일 뒤 재시도.
- 테이블이 아직 없으면(42P01/PGRST205) 지오코딩을 조용히 건너뛴다(1·2단계만 동작).

### 2-3. 응답 필드 추가 (`ControlFarm`)

`farm_type: "shrimp" | "agriculture"`, `coord_source: "farm" | "device" | "address" | null`, `coord_precision?: "address" | "region"`, `has_sensor: boolean`(active 장비 ≥1). `latitude/longitude` 는 위 규칙으로 채운 값. 기존 필드·통계는 그대로. `stats` 에 `farms_located`(지도에 찍힌 농장 수) 추가. `farms.farm_type` 컬럼이 없는 DB 면 `"shrimp"` 로 폴백(select 재시도 패턴 — 장비 좌표 조회와 같음).

### 2-4. 지도 표식 (`components/control/control-map.tsx`)

| 표식 | 모양 | 색 |
|---|---|---|
| 농장 | `L.divIcon` 둥근 사각 핀(지름 26px) 안에 유형 아이콘(양식장 = 물결, 스마트팜 = 새싹; 인라인 SVG) | 테두리·배경: 위험 red / 주의 amber / 정상 emerald / **센서 없음 slate(회색)** / 기기 끊김은 지금처럼 점선 |
| 대략 위치 농장 | 위 핀 + 바깥 점선 고리(`circle` 반경 = `region` 이면 3km, `address` 면 300m, 채움 없음) | 같은 색 |
| 수질센서 | 지금의 작은 원(파랑 온라인 / 회색 끊김) | 그대로 |

- 팝업: 지금 내용 + 유형("양식장"/"스마트팜"), 센서 없음이면 "수질센서 미설치", 위치 출처 한 줄("농가 입력 좌표" / "장비 위치 기준" / "주소 기준 대략 위치(읍·면 수준)"). 사용자 입력은 지금처럼 `textContent` 로만.
- 대표 수조 수질 툴팁(상시 표시)은 센서 있는 농장만 — 지금 그대로.

### 2-5. 표시 필터 (지도 위 툴바)

```
[ 전체 18 ] [ 농장만 12 ] [ 수질센서만 9 ]     유형: [ 전체 ] [ 양식장 ] [ 스마트팜 ]     [ ☐ 문제 있는 곳만 ]   [ ⤢ 전체 맞춤 ]
```
- 보기(라디오 세그먼트): **전체**(농장+센서) / **농장만** / **수질센서만**. 숫자는 현재 유형 필터 기준 지도에 찍히는 개수.
- 유형(라디오): 전체 / 양식장 / 스마트팜 — 농장과 그 농장 소속 센서에 함께 적용.
- 문제 있는 곳만(토글): 위험·주의 수조가 있거나 기기가 끊긴 농장(+끊긴 센서)만.
- 전체 맞춤: 지금 보이는 표식에 지도를 맞춘다. **필터를 바꿔도 지도를 다시 만들지 않는다** — 레이어 그룹을 켜고 끄기만 해서 확대 상태가 유지된다(지금은 데이터가 바뀌면 지도를 통째로 다시 만든다 — 필터 전환에 그 방식을 쓰면 깜빡이고 확대가 풀린다).
- 선택은 URL 쿼리(`?view=farms&type=shrimp&issues=1`)에 반영해 새로고침·공유해도 유지(`router.replace`, scroll 없이).
- 장비 표식에 농장 유형을 알기 위해 `device_markers` 에 `farm_id`, `farm_type` 추가.
- 320px: 툴바는 줄바꿈(flex-wrap), 버튼 높이 36px 이상, 숫자는 `tabular-nums`. 색은 콘솔 셸 규칙(중립) — 활성 세그먼트 `bg-foreground text-background`.

### 2-6. 범례

`농장(정상·주의·위험·센서 없음)` · `수질센서(온라인·끊김)` · `점선 핀 = 기기 끊김` · `점선 고리 = 주소 기준 대략 위치`. 접이식(모바일 기본 접힘).

### 2-7. 위치 미확인 농장 목록

지도 카드 아래 `<details>`: "위치 미확인 농장 N곳" — 이름·소유자·주소(없으면 "주소 미입력"). 관리자가 농가에 좌표 입력을 안내할 수 있게.

## 3. 소유 파일
`app/api/control/overview/route.ts`(필드 추가·좌표 규칙·after 지오코딩 — **권한 확인 줄은 손대지 않는다**), `lib/geocode.ts`(신규), `supabase/migrations/farm_geocodes.sql`(신규), `components/control/control-map.tsx`, `components/admin/control-view.tsx`(툴바·미확인 목록·URL 쿼리), `.env.example`(`KAKAO_REST_API_KEY=` 주석 한 줄).

## 4. 하지 말 것
- `lib/control-auth.ts` 수정 금지, overview 의 `authorizeControl` 앞 조기 반환 금지(라우트 머리 주석).
- `farms` 테이블에 쓰기 금지.
- 브라우저에서 지오코딩 호출 금지(키 노출·CSP). 서버에서만.
- 새 npm 의존성 금지(Leaflet divIcon·circle 로 충분).

## 5. 검수
1. 좌표 없는 농장이 주소로 찍히고 점선 고리·"대략 위치" 표기. 장비만 좌표가 있는 농장은 장비 평균 위치에 농장 핀.
2. 필터 3종 × 유형 3종 × 문제만 토글 조합에서 개수와 표식이 맞고, 필터 전환 시 확대가 유지됨.
3. `farm_geocodes` 미생성 DB 에서도 overview 200.
4. 지오코딩이 응답을 늦추지 않음(after), Nominatim 간격 1초 이상, 실패 캐시.
5. XSS: 팝업·미확인 목록에 사용자 입력이 textContent/React 텍스트로만.
6. `npm run build`, tsc 0, 바꾼 파일 eslint 에러 0.

## 5. 사람 몫
- `farm_geocodes.sql` 실행.
- (선택·권장) 카카오 개발자 콘솔에서 REST API 키를 발급해 배포 환경변수 `KAKAO_REST_API_KEY` 로 넣으면 한국 주소 정확도가 크게 오른다. 없으면 OpenStreetMap 으로 동작.
