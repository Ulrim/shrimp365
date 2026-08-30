# 컬리버 탄소 MRV 플랫폼 (`/mrv`)

정부 청년그린창업 스프링캠프 과제 **"흰다리새우 양식 공정의 탄소배출 저감을 위한 통합 관리
기술 개발"** 의 산출물을 shrimp365 안으로 이식한 것이다. 원본은 별도 저장소
[`Ulrim/culiver-mrv-platform`](https://github.com/Ulrim/culiver-mrv-platform) 의
FastAPI + React(Vite) 모노레포였고, 이 문서는 그것이 여기서 어떤 모습이 되었는지를 적는다.

한 문장으로: **전력·산소·수질·급이·폐사 데이터를 한 흐름으로 모아 공정 KPI(EI·OEI·FCR·
폐사율)를 산출하고, 전력 절감을 Scope2 탄소저감 성과로 환산해 "달성/미달성"이 명확한 MRV
리포트로 증빙하는 B2B 구독형 시스템.**

멋진 대시보드가 아니라 **심사위원이 달성 여부를 판정할 수 있는 증빙 시스템**이라는 것이
설계 전반의 기준이다. 값 옆에 늘 산식 버전·기간·근거 참조가 붙어 있는 이유다.

---

## 1. 어디에 무엇이 있나

| 자리 | 내용 |
|---|---|
| `app/mrv/**` | 화면 14개(개요·입력·기준선·알림·비교·추천·MRV 리포트·SOP·온보딩·제어 콘솔·멀티사이트·감사 로그) |
| `app/api/mrv/**` | API 라우트 38개 — 원본 엔드포인트 41개 + 알림 배치 실행 창구 1개 |
| `lib/mrv/kpi/**` | **KPI/MRV 산식 엔진** — 가장 보호받는 코드 |
| `lib/mrv/*.ts` | 인증·테넌시·조립 서비스(kpi-service, mrv-report-service, ingestion, alert-jobs 등) |
| `vercel.json` | 알림 배치 Cron 일정(3.7) |
| `lib/mrv/ui/**`, `components/mrv/**` | 화면이 쓰는 훅·표시 메타·공통 컴포넌트 |
| `supabase/migrations/mrv_platform.sql` | DB 스키마 + RLS + 기본 데이터 |
| `scripts/mrv/**` | 검증 도구(아래 4절) |
| `mrv-platform/**` | **원본 소스 그대로** — 실행되지 않는 참조본. tsc·eslint 대상에서 제외돼 있다 |

원본을 지우지 않고 남긴 이유는 두 가지다. 이식이 원본과 어긋났는지 언제든 대조할 수 있어야
하고(4절의 차분 검증이 실제로 그렇게 한다), ADR·설계 문서가 그 자리에 함께 있어야 "왜 이렇게
만들었는가"를 나중에 읽을 수 있기 때문이다.

---

## 2. 절대 규칙

원본 `CLAUDE.md` 의 Hard Rules 를 그대로 승계한다. 고치기 전에 반드시 읽을 것.

1. **KPI/MRV 산식은 `lib/mrv/kpi` 에서만** 정의·수정한다. API 나 화면에 산식을 복제하지 않는다.
2. 산식이 바뀌면 **검증 기준값 갱신 + `mrv_kpi_config` 새 version 행 추가**를 함께 한다.
   기존 행을 고치면 과거 스냅샷이 어떤 파라미터로 산출됐는지 추적할 수 없게 된다.
3. **기준선은 잠금 후 불변.** 수정 코드 경로를 만들지 않는다(DB 트리거가 UPDATE/DELETE 를
   거부하므로 만들어도 동작하지 않는다).
4. **멀티테넌시 누수 금지.** 모든 질의를 `org_id` 로 좁힌다.
5. **전력 배출계수 하드코딩 금지.** `mrv_emission_factors` 테이블에 출처·연도·버전과 함께 둔다.
6. **결정론적.** 같은 입력 → 같은 출력. 산출 로직에 `now()`/난수를 넣지 않는다.
7. 모든 제어·설정 변경은 `mrv_audit_logs` 에 diff 를 남긴다.

---

## 3. 이식하며 달라진 것

원본과 다른 지점만 적는다. 나머지는 원본 그대로다.

### 3.1 산식 엔진: Python → TypeScript
`packages/kpi`(순수 함수 + pytest)를 `lib/mrv/kpi`로 옮겼다. 판정 규칙·경계 처리·오류 문구를
한 줄씩 대응시켰고, 두 구현이 실제로 같은 값을 내는지는 4절의 차분 검증이 매번 확인한다.

부동소수 반올림 한 곳만 손을 더 댔다. 리포트의 산식 전문(`formula_text`)은 증빙으로 박제되므로
문자 단위로 같아야 하는데, JS `toFixed` 는 half-away-from-zero, Python `round` 는 half-to-even
이라 결과가 갈린다. 그래서 double 을 BigInt 로 정확히 분해해 Python 과 같은 규칙으로 반올림한다
(`lib/mrv/kpi/internal.ts::roundHalfEven`).

### 3.2 DB: 자체 PostgreSQL+TimescaleDB → Supabase
- 모든 테이블에 **`mrv_` 접두사**를 붙였다. shrimp365 가 이미 `alerts`/`sites` 같은 이름을
  쓰고 있어 그대로 두면 운영 스키마를 오염시킨다.
- `readings` 는 **하이퍼테이블이 아니다.** Supabase 에 TimescaleDB 가 없다. 대신
  `(meter_id, time)` 복합 인덱스와 `time` BRIN 인덱스로 받는다. 파일럿 규모에서는 충분하고,
  연속집계가 필요해지면 머티리얼라이즈드 뷰로 올린다.
- **RLS 앵커가 세션 GUC(`app.current_org_id`) → `auth.uid()` 로 바뀌었다.** GUC 방식은 요청마다
  `SET LOCAL` 을 거는 직접 연결을 전제하는데(원본 ADR 0006 이 PgBouncer·PostgREST 와 궁합이
  나쁘다고 지적한 그 방식), Supabase 에서는 서명된 JWT 의 `auth.uid()` 가 그 자리를 대신한다.
  클라이언트가 값을 정할 수 있는 세션 변수가 아예 없으므로 격리는 같거나 더 세다.
- 시계열 집계(hourly/daily)는 DB 함수 `mrv_aggregate_readings` 로 옮겼다. PostgREST 질의
  빌더로는 `date_trunc` GROUP BY 를 표현할 수 없고, 앱에서 합치면 집계를 도입한 이유가 사라진다.

### 3.3 인증: 자체 JWT 검증 → shrimp365 세션
원본은 Bearer 토큰을 직접 검증했다. 이식본은 shrimp365 가 이미 쓰는 `@supabase/ssr` 쿠키
세션에 맡긴다 — 같은 Supabase 프로젝트이므로 계정이 그대로 공유된다(ADR 0006 이 말한 "계정
공유의 실체"). 그 뒤의 초대 연계 로직(`lazyLink`)과 403/409 상태 코드·문구는 원본 그대로다.

**초대 기반은 유지된다.** shrimp365 계정으로 인증에 성공해도 `mrv_users` 에 초대 행이 없으면
`/auth/me` 가 403 을 내고, 화면은 "이용 신청이 필요합니다" 안내로 대체된다.

### 3.4 데이터 접근: RLS 의존 → service-role + 앱 계층 스코프
shrimp365 의 기존 관제센터 라우트와 같은 방식이다: 라우트가 세션으로 호출자를 확인하고
(`authorizeMrv`), service-role 클라이언트로 질의하되 `org_id` 로 직접 좁힌다.

> ⚠ service-role 은 RLS 를 우회한다. 따라서 **라우트의 권한 확인이 그 경로의 유일한 방어선**이다.
> `authorizeMrv()` 없이 조기 반환하는 분기를 만들지 말 것. RLS 는 그래도 남겨 뒀다 — 다른
> 경로로 DB 에 닿았을 때의 2차 방어선이다.

### 3.5 MRV 리포트 PDF → 인쇄용 HTML
원본은 WeasyPrint 로 PDF 를 구워 디스크에 저장했다. 이 배포 형태에는 영속 디스크가 없고,
한글 글리프를 담은 폰트를 PDF 엔진에 붙이는 일도 배포 환경마다 갈린다 — 원본이
`pdf_is_available` 로 "PDF 실패 시 HTML 폴백"을 이미 계약에 넣어 둔 이유가 그것이다.
그래서 그 폴백을 정식 경로로 삼았다: `/api/mrv/mrv-reports/{id}/pdf` 가 A4 인쇄용 HTML 을
그려 주고, 브라우저 인쇄 → "PDF 로 저장"으로 파일이 만들어진다. 한글이 깨지지 않고,
문서 내용은 저장된 리포트 행에서만 만들어지므로 몇 번을 열어도 같은 문서가 나온다.

### 3.6 화면
- React Router → Next.js App Router (`/mrv/*`)
- TanStack Query → `lib/mrv/client.ts` 의 작은 조회 훅(원본 훅들이 전부 `apiFetch` 한 번을
  감싸는 얇은 층이라 잃는 것이 없다)
- ECharts → Recharts(shrimp365 가 이미 쓰는 것)
- 디자인 토큰은 `mrv-` 네임스페이스로 격리했다(`tailwind.config.ts` + `app/globals.css`).
  shrimp365 의 `muted`/`primary`/`border` 와 의미가 달라 그대로 두면 서로를 덮어쓴다.
- **데모 사이트 상수가 실제 사이트 선택으로 바뀌었다.** 원본은 화면마다
  `VITE_DEMO_SITE_ID` 를 박아 썼다("멀티사이트 선택 UI는 후속"). 여기서는 `GET /sites` 목록에서
  고르고 브라우저에 기억한다. 사이트가 하나면 자동으로 그것이 골라진다.
- 기본 조회 기간도 고정 날짜(2026-06) 대신 **최근 30일**이다.

### 3.7 알림 배치: 상주 워커 → 스케줄 라우트

원본에는 FastAPI 와 별개로 **상주 워커 프로세스**(`worker.py`)가 있었다. APScheduler 로
15분마다 `job_evaluate_alerts` 를 돌려 DO 저하·폐사 급증·KPI red 를 판정하고 `alerts` 행을
만드는 일을 했다. 알림을 **만들어 내는** 쪽은 라우터가 아니라 여기였다.

이 배포 형태에는 상주 프로세스가 없다. 같은 일을 스케줄러가 때려 주는 라우트로 옮겼다:

| | 원본 | 이식본 |
|---|---|---|
| 판정 로직 | `app/services/alert_jobs.py` | `lib/mrv/alert-jobs.ts` |
| 실행 주체 | 상주 워커 + APScheduler | Vercel Cron → `POST/GET /api/mrv/jobs/evaluate-alerts` |
| 주기 | 15분 (`ALERT_EVAL_INTERVAL_MINUTES`) | 15분 (`vercel.json` 의 `crons`) |
| 인증 | 없음(프로세스 내부 호출) | `CRON_SECRET` (Bearer) |

이 창구는 **전 조직의 사이트를 평가**하므로 어떤 사용자 세션으로도 열리지 않는다.
`CRON_SECRET` 이 설정돼 있지 않으면 열어 두지 않고 **503 으로 닫는다** — 설정을 깜빡한
배포에서 인증 없는 전 조직 접근 창구가 조용히 열려 있는 것이 가장 나쁜 결과이기 때문이다.

판정 로직에서 원본과 의도적으로 다른 세 가지는 `lib/mrv/alert-jobs.ts` 머리말에 적었다
(org 순회 생략 · DO 동시각 동점 처리 · 모르는 지표명 거부). 셋 다 `mrv:verify-alerts` 가
원본과 같은 판정을 내는지 확인한다.

> **Vercel 요금제 주의**: Hobby 플랜은 Cron 이 하루 1회로 제한된다. 15분 주기가 필요하면
> Pro 이상이어야 한다. 플랜을 올리지 않겠다면 `vercel.json` 의 `crons` 를 지우고 Supabase
> `pg_cron` + `pg_net` 이나 외부 스케줄러로 같은 URL 을 15분마다 때리면 된다 — 라우트는
> 어느 쪽에서 불려도 똑같이 동작한다.

### 3.8 이식하지 않은 것

- **MQTT 수집기** (`app/services/mqtt_consumer.py`) — 원본에서도 브로커가 없으면 안전하게
  no-op 하는 골격이었고, 같은 `process_batch` 를 부르는 얇은 층이라 HTTP 수집 경로
  (`POST /api/mrv/ingest/readings`)가 그대로 대체한다. 게이트웨이를 MQTT 로 붙일 일이
  생기면 브로커 배선과 함께 다시 판단할 문제다.
- **WeasyPrint PDF 렌더** — 3.5 참고(인쇄용 HTML 로 대체).

---

## 4. 검증

이식이 원본과 어긋나지 않았는지 **다섯 계층을 각각 원본과 대조**한다. 산식만 맞아서는
부족하다 — 설정을 잘못 읽거나, 계측값을 잘못 정규화하거나, 엔진에 엉뚱한 행을 넣거나,
알림을 잘못 판정하면 산식이 정확해도 결과가 틀리고, 그런 오류는 화면에 아무 표시도
남기지 않는다.

```bash
npm run mrv:verify        # 아래 여섯 가지를 한 번에
```

| 명령 | 무엇을 대조하나 | 규모 |
|---|---|---|
| `mrv:verify-kpi` | **산식 엔진** — EI·FCR·OEI·폐사율·Scope2·신호등·전후비교·추천 | 250 시나리오 |
| `mrv:verify-config` | **설정 해석** — `params_json` → 산출 파라미터(거부해야 할 문서까지) | 102 문서 |
| `mrv:verify-ingestion` | **계측값 정규화** — 적산/순시/구간/DO → 저장값 + quality_flag (ADR 0001) | 44 배치 / 372 계측값 |
| `mrv:verify-pipeline` | **조립 계층** — 같은 DB 행 → 같은 KPI (기간 자르기·폭기 구분·생체량 선택) | 25 시나리오 / 1,699 계측값 |
| `mrv:verify-alerts` | **알림 배치** — 트리거 3종 판정·구독 스위치·중복 억제·payload | 60 시나리오 / 113 사이트 / 알림 128건 |
| `mrv:verify-rls` | **스키마 방어선** — 테넌트 격리·기준선 불변성·승인 게이트·시계열 집계 | 21 항목 |

앞의 다섯 가지는 원본 Python 을 실제로 돌려 기준값을 만든 뒤 TypeScript 이식본과 값을
비교한다(`scripts/mrv/gen_*_fixtures.py` → `scripts/mrv/verify-*.mjs`). 원본 코드는
`mrv-platform/` 에 그대로 남아 있으므로 언제든 다시 대조할 수 있다.

`mrv:verify-rls` 는 임시 Postgres 16 을 띄워 마이그레이션을 실제로 적용한 뒤 시험한다.
운영 DB 에 접속하지 않으므로 아무 때나 돌려도 안전하다.

### 산식을 고쳤다면

1. 기준값을 다시 만든다:
   ```bash
   python3 scripts/mrv/gen_kpi_fixtures.py > scripts/mrv/kpi-fixtures.json
   ```
   (원본 Python 도 함께 고쳤을 때만. 이식본만 고쳤다면 기준값은 그대로 두고 통과시켜야 한다.)
2. `mrv_kpi_config` 에 새 version 행을 추가한다 — 기존 행을 고치면 과거 스냅샷이 어떤
   파라미터로 산출됐는지 추적할 수 없다.
3. `npm run mrv:verify` 를 통과시킨다.

기준값 생성에는 Python 패키지가 필요하다: `pip install sqlalchemy pydantic pydantic-settings`.
검증 자체(`verify-*.mjs`)는 이미 만들어진 JSON 만 읽으므로 Python 없이도 돌아간다.

### 그 외 공통 검사

```bash
npx tsc --noEmit    # 타입
npm run lint        # 린트
npm run build       # 빌드
```

### 재검증에서 찾아 고친 것

검증을 산식 한 계층에서 네 계층으로 넓히면서 아래를 찾아 고쳤다. 기록해 두는 이유는,
같은 종류의 실수가 다시 들어올 자리를 표시해 두기 위해서다.

1. **임계값 쌍을 반쪽만 받아들이던 문제** (`lib/mrv/kpi/config.ts`)
   `{"fcr": {"red_threshold": 2.0}}` 처럼 한쪽만 적힌 문서를 이식본이 나머지 기본값으로
   조용히 메웠다. 운영자가 설정한 적 없는 조합(red 만 2.0, amber 는 기본 1.5)으로 신호등이
   판정하게 된다. 원본과 같이 거부하도록 고쳤다(원본은 KeyError → 500, 여기서는 422).

2. **정렬 없는 페이지네이션** (`kpi-service` · `recommendation-service` · `ingestion` 등 9곳)
   Postgres 는 `ORDER BY` 없는 `LIMIT/OFFSET` 의 행 순서를 보장하지 않는다. 1,000행을
   넘는 조회에서 어떤 행은 빠지고 어떤 행은 두 번 읽힌다. 특히 추천 엔진 입력인
   폭기 전력 **합계**가 그렇게 계산되고 있었다(14일치면 수만 행이라 실제로 넘는다).
   모든 페이지 조회에 결정론적 정렬을 붙이고, 그 요구를 `fetchAll` 주석에 못박았다.

3. **수집 때마다 저장된 계측값을 전부 훑던 문제** (`lib/mrv/ingestion.ts`)
   중복 판정을 위해 해당 계측기의 **모든** 계측값을 읽고 있었다. 몇 달 운영한 사이트면
   수집 요청 한 번에 수십만 행이다. 중복은 배치가 담은 시각 구간에서만 생기므로 그
   범위로 좁혔다.

4. **리포트 생성 실패 시 남던 고아 스냅샷** (`lib/mrv/mrv-report-service.ts`)
   Scope2 산정이 거부되는 입력(예: After 기간 생산량 0)일 때 스냅샷만 저장된 뒤 422 가
   났다. 산정을 스냅샷 저장보다 앞으로 옮겨 그 구간을 없앴다.

5. **`/mrv` 가 미들웨어 보호 경로에 없던 문제** (`middleware.ts`)
   셸이 클라이언트에서 세션을 확인해 리다이렉트했으므로 데이터가 새지는 않았지만,
   비로그인 방문자에게 화면이 잠깐 그려졌다 사라졌다. 다른 인증 구역과 같이 미들웨어에서
   먼저 막는다.

6. **알림을 만들어 내는 쪽이 통째로 빠져 있던 문제** (`lib/mrv/alert-jobs.ts` 신설)
   화면·API·테이블은 다 이식됐는데 `mrv_alerts` 에 **행을 넣는 코드가 어디에도 없었다**.
   알림 목록이 영원히 비고, 그런데도 화면은 정상으로 보인다(빈 목록과 "알림 없음"은
   구별되지 않는다). 원인은 그 로직이 FastAPI 라우터가 아니라 별도 워커 프로세스에
   있었다는 것 — **라우트만 세면 놓치는 자리**다. 3.7 참고.

   같은 실수를 다시 하지 않으려면: 원본에서 옮길 것을 셀 때 `routers/` 만 보지 말고
   `worker.py` 처럼 프로세스 진입점이 따로 있는지 확인할 것.

---

## 5. 배포 전에 할 일 (사람 몫)

1. **스키마 적용** — Supabase SQL Editor 에서 `supabase/migrations/mrv_platform.sql` 전체를
   한 번 실행한다. 멱등이라 여러 번 실행해도 안전하다.
2. **전력 배출계수 확인** — 마이그레이션이 넣는 기본 행은 자리표시자다.
   환경부/온실가스종합정보센터(GIR)가 공표하는 최신 국가 전력 배출계수를 확인하고, 값이
   다르면 **기존 행을 고치지 말고** 새 version 행을 추가한다(과거 리포트가 참조한 값이 사후에
   바뀌면 증빙 무결성이 깨진다). `POST /api/mrv/emission-factors`(owner) 로도 추가할 수 있다.
3. **조직·사이트·사용자 만들기** — 셀프서비스 가입이 없다. 첫 조직·사이트·owner 행은 SQL 로
   직접 넣어야 하고, 그 뒤로는 owner 가 `POST /api/mrv/organizations/{orgId}/users` 로 초대한다.
   카카오처럼 JWT 에 이메일이 실리지 않는 계정은 `supabase_user_id` 를 함께 줘 미리 연결한다.
4. **수집 API 키 발급** — 게이트웨이용 `mrv_api_keys` 행은 화면에서 만들지 않는다.
   원문 키의 sha256 해시만 저장하므로, 키를 생성해 해시를 넣고 원문은 게이트웨이에만 준다.
5. **`CRON_SECRET` 설정** — 알림 배치 창구를 여는 유일한 열쇠다. 이 값이 없으면 창구가
   503 으로 닫힌 채이고 **알림이 하나도 만들어지지 않는다**(화면은 정상으로 보이므로
   빠뜨리면 알아채기 어렵다). `openssl rand -hex 32` 로 만들어 Vercel 환경변수에 넣으면
   Cron 이 알아서 `Authorization: Bearer` 로 붙여 준다. 요금제 주의는 3.7 참고.
   설정 뒤 한 번 손으로 확인:
   ```bash
   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
     https://<배포주소>/api/mrv/jobs/evaluate-alerts
   # → {"evaluated_sites":N,"created_count":...,"failed_sites":0,...}
   ```
6. **그 밖의 환경변수**(둘 다 선택) — `.env.example` 의 `NEXT_PUBLIC_MRV_PLATFORM_URL`,
   `NEXT_PUBLIC_MRV_SUPPORT_CONTACT` 참고.

---

## 6. 참고 문서 (원본)

- `mrv-platform/00_개발의뢰서_MASTER.md` — 도메인 모델·KPI 산식 정의·화면 인벤토리·3-Tier 패키지
- `mrv-platform/docs/adr/` — 아키텍처 결정 기록 7건
  (0001 전력값 저장 규약 / 0002 기준선 불변성 / 0003 OEI 산정 / 0004 PDF 엔진 /
  0005 Supabase Auth / 0006 shrimp365 계정 연계 / 0007 RLS 운영 정합성)
- `mrv-platform/docs/design/` — Phase 별 설계서
