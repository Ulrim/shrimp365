# ADR 0006 — shrimp365 계정 연계(Account Federation), 데이터는 완전 별건

- 상태(Status): **제안(Proposed)** — 설계는 확정이나, 실제 Supabase 프로젝트 키 주입·OAuth
  Redirect URL 등록·JWT Secret 방식(레거시 HS256) 확인은 **사용자/컬리버 운영진 몫**이며 아직
  완료되지 않았다(7절 실행 전제). 해당 항목 완료 후 Accepted로 전이한다.
- 결정권자: 사용자(범위 확정) — 사용자가 **(a) 계정(로그인)만 공유**, **(b) 데이터는 완전 별건
  (마이그레이션/공유 없음)**, **(c) 결제·구독은 이번 범위 제외**를 명시적으로 선택했다. 본 ADR은
  그 세 가지를 전제로 설계를 확정한다.
- 산식 무관: 인증/연계 인프라 결정이므로 `data-kpi-engineer` 합의 게이트 대상 아님(CLAUDE
  Rule 1 범위 밖). KPI/MRV 산식에 어떤 영향도 주지 않는다.
- 날짜: 2026-08-29
- 작성: architect
- 관련: ADR 0005(Supabase Auth 통합 — 본 ADR이 그 계약을 **확장**하되 뒤집지 않는다),
  `docs/design/phase-3-auth.md`(초대/lazy-link 계약), `docs/design/shrimp365-integration.md`
  (본 ADR의 구현 계약서), `CLAUDE.md`(Hard Rule 4 멀티테넌시 격리 / Rule 7 비밀값 / Rule 9 감사),
  MASTER 5장(인증/RLS), MASTER 11장(평가 산출물 — 3절 기여 근거)

---

## 맥락 (Context)

컬리버는 이미 **운영 중인 B2C 서비스 `shrimp365`**(www.shrimp365.kr, Next.js 16 +
`@supabase/ssr`)를 보유하고 있다. 신규 `culiver-mrv-platform`은 별개의 B2B 구독 웹앱이며
Phase 3 P2까지 구현이 끝나 있다. 두 시스템의 현재 상태:

| | shrimp365 (운영 중) | culiver-mrv-platform (신규) |
|---|---|---|
| 프런트 | Next.js 16, `@supabase/ssr`(쿠키 세션) | React 18 + Vite SPA, `@supabase/supabase-js`(localStorage 세션) |
| 로그인 수단 | 이메일+비밀번호, Google, Kakao, **Naver(커스텀 OAuth 라우트)** | **이메일+비밀번호 전용** |
| 테넌시 모델 | 개인 소유(B2C) — `profiles`/`farms.user_id` 직접 소유, **org 개념 없음** | 조직(org) 기반 멀티테넌시 + Postgres RLS |
| 데이터 저장소 | Supabase Postgres(`public` 스키마) | **자체 PostgreSQL + TimescaleDB**(`DATABASE_URL`) |
| 프로비저닝 | 셀프서비스 회원가입 | **초대 기반**(초대 없으면 403, ADR 0005 4절) |

사용자의 요구는 "**두 서비스가 로그인을 공유**하되 **데이터는 섞지 않는다**"이다. 여기서
설계가 실제로 결정해야 하는 것은 다음 여섯 가지다.

1. Supabase 프로젝트를 어떻게 공유하는가(그리고 그때 데이터 격리가 구조적으로 보장되는가).
2. culiver 로그인이 이메일+비밀번호 전용인데, 소셜로 가입한 shrimp365 사용자는 어떻게 들어오는가.
3. **카카오 가입자는 Supabase JWT에 `email` 클레임이 없을 수 있다** — shrimp365 코드 주석에
   명시되어 있다(비즈앱 심사 전 `account_email` 요청 시 KOE205, 그래서 `profile_nickname`만
   요청 중). 그런데 culiver의 `_lazy_link`는 **email 클레임이 없으면 즉시 403**이다.
4. 계정이 연결되면 shrimp365 사용자가 culiver에 자동으로 들어와도 되는가(= 초대 기반 폐기?).
5. shrimp365 홈페이지에서 culiver로 가는 진입 동선.
6. "데이터 별건"이 관례가 아니라 **구조**로 지켜지는가.

**MASTER 11장 기여**: 본 ADR 자체는 평가 산출물을 직접 생산하지 않는다. 기여 경로는 간접적이며
정확히 하나다 — *파일럿 사이트 운영자가 기존에 쓰던 계정 그대로 MRV 플랫폼에 진입할 수 있게
해 실사용 로그(입력·제어·전후비교) 축적을 가속*한다. 즉 산출물 자체가 아니라 **산출물의 원재료인
실운영 데이터의 확보 속도**에 기여한다. 이 정당화가 성립하지 않는 범위(결제 통합, 데이터 통합,
B2C 기능 이식)는 본 ADR에서 전부 제외한다.

---

## 결정 (Decision)

### 1. Supabase 프로젝트 공유 방식 — **"인증 평면만 공유, 데이터 평면 완전 분리"**

**결정**: culiver는 shrimp365가 이미 쓰고 있는 **동일 Supabase 프로젝트**를 가리키되,
**`auth.users`(인증 평면)만** 사용한다. culiver의 **업무 데이터는 100% 자체 PostgreSQL +
TimescaleDB**(`DATABASE_URL`)에 남으며, culiver의 어떤 코드도 Supabase Postgres(PostgREST
포함)에 접근하지 않는다.

```
                      ┌──────────────────────────────┐
   shrimp365 (Next)   │  Supabase 프로젝트 (공유)      │   culiver (Vite SPA)
        │             │                              │        │
        │  세션 발급   │   auth.users  ← 인증 평면 공유  │  세션 발급
        ├────────────►│   (Google/Kakao/Naver/Email) │◄───────┤
        │             │                              │        │
        │  PostgREST  │   public.profiles/farms/...  │   ✗ 접근하지 않음
        └────────────►│   ← shrimp365 전용 데이터 평면 │        │
                      └──────────────────────────────┘        │
                                                              ▼
                                              culiver API(FastAPI) ──► 자체 PostgreSQL
                                                                        + TimescaleDB
                                                                        (org 스코프 RLS)
```

**근거**:

- **사용자 요구와 정합**: "데이터는 별건"이 설계 다이어그램 수준에서 그대로 성립한다.
  shrimp365의 `farms`/`tanks`/`journal_entries`/`water_quality_readings`는 culiver 백엔드의
  연결 문자열 범위 밖에 있어 **접근하려야 접근할 방법이 없다**(6절에서 재확인).
- **이미 그렇게 만들어져 있다**: ADR 0005는 Supabase를 인증 전용으로 도입했고,
  `SUPABASE_URL`은 백엔드에서 "참고용(현재 코드는 사용하지 않음)"으로 자리만 잡혀 있다. 즉 본
  결정은 **신규 구조를 만드는 것이 아니라 기존 구조를 재확인하고 값만 shrimp365 프로젝트로
  맞추는 것**이다 — 이 연계의 총 비용이 낮은 진짜 이유가 여기에 있다.
- **역방향(= Supabase Postgres를 culiver DB로도 사용)은 기술적으로 불가에 가깝다**:
  (i) Supabase 관리형 Postgres는 TimescaleDB 하이퍼테이블/연속집계를 제공하지 않아 Phase 1~3의
  시계열 설계를 통째로 갈아엎어야 한다. (ii) culiver의 RLS는 세션 GUC(`app.current_org_id`)를
  요청마다 세팅하는 방식인데, 이는 PgBouncer 트랜잭션 풀링·PostgREST 경유 접근과 궁합이 나쁘다.
  (iii) alembic 마이그레이션이 `users`/`organizations` 같은 일반 이름의 테이블을 shrimp365가
  운영 중인 `public` 스키마에 생성하게 되어 **운영 서비스의 스키마를 오염**시킨다.
  이 세 가지 중 어느 하나만으로도 기각 사유로 충분하다.
- **결과적으로 shrimp365 저장소·스키마 변경이 0이다**(5절 홈페이지 버튼 제외) — 운영 중인
  서비스를 건드리지 않는다는 원칙과 정합적이다.

**공유되는 것 / 공유되지 않는 것(계약)**:

| 항목 | 공유 | 비고 |
|---|---|---|
| `auth.users`(계정 식별자 `sub`, email, provider) | **O** | 연계의 유일한 접점 |
| OAuth Provider 설정(Google/Kakao 앱 키, 콜백 URI) | **O** | 프로젝트 단위 설정 — culiver가 그대로 재사용, provider 콘솔 변경 불요 |
| JWT Secret(HS256) | **O** | culiver `SUPABASE_JWT_SECRET` = shrimp365 프로젝트 값 |
| 로그인 **세션**(쿠키/토큰) | **X** | 도메인·저장소가 달라 자동 공유되지 않음 — 2절 말미 참고 |
| 업무 데이터(farms/tanks/sites/readings 등) | **X** | 6절 |
| 결제·구독(`profiles.plan`, `stripe_*` ↔ `organizations.plan`) | **X** | 이번 범위 명시 제외 |

**세션은 공유되지 않는다(명시적 한계)**: shrimp365는 `@supabase/ssr` 쿠키 세션을
`www.shrimp365.kr` 도메인에, culiver는 `localStorage` 세션을 자기 도메인에 둔다. 브라우저
동일 출처 정책상 한쪽 로그인이 다른 쪽에 자동 반영되지 않는다. **"계정 공유"≠"SSO 자동
로그인"**이며, 사용자는 culiver에서 한 번 더 로그인한다(같은 자격증명·같은 소셜 계정으로).
크로스도메인 토큰 전달로 SSO를 구현하는 것은 새로운 공격 표면(토큰 URL 노출 등)을 여는 일이라
파일럿 규모에서 기각한다 — 후속 ADR 트리거로만 남긴다(8절).

### 2. culiver FE 소셜 로그인 — **Google + Kakao 추가, Naver 제외, 매직링크를 보편 폴백으로 추가**

**문제**: culiver 로그인은 `signInWithPassword` 전용이다. 소셜로 가입한 shrimp365 사용자에게는
**비밀번호가 존재하지 않는다**. 이대로면 계정을 공유해도 실질적으로 못 들어오므로 사용자 요구가
깨진다. 따라서 FE 확장은 선택이 아니라 필수다.

**결정**:

- **Google, Kakao**: `supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })`로
  추가한다. 같은 프로젝트이므로 **Provider 설정이 그대로 상속**되어 culiver 쪽 신규 설정은
  `redirectTo` 허용 목록 등록(7절) 하나뿐이다. Vite SPA는 `detectSessionInUrl` 기본값(true)으로
  콜백 해시를 자동 처리하므로 **콜백 라우트를 새로 만들 필요가 없다**.
- **Naver는 이번 범위에서 제외**한다. Naver는 Supabase 네이티브 provider가 아니라 shrimp365가
  **Next.js 서버 라우트(`app/auth/naver/callback/route.ts`)에서 직접 구현**한 커스텀 OAuth다.
  culiver(Vite SPA)에서 이를 재현하려면 (i) `NAVER_CLIENT_SECRET`과 (ii) Supabase
  **service_role 키**를 보관할 신규 서버 엔드포인트를 FastAPI에 만들어야 한다. 이는 지금까지
  culiver가 한 번도 갖지 않았던 **최고 권한 비밀(service_role)의 신규 보관 표면**을 여는 일이며,
  얻는 이익(파일럿 규모의 소수 Naver 가입자)에 비해 리스크·비용이 명백히 크다(과설계 금지).
  - shrimp365의 콜백 라우트를 재사용하는 경로(culiver → shrimp365 콜백 → culiver 리다이렉트)도
    검토했으나, **운영 중인 서비스의 인증 라우트에 리다이렉트 파라미터를 추가하는 변경**이
    필요해 "shrimp365는 건드리지 않는다" 원칙과 정면 충돌한다. 기각.
- **매직링크(이메일 OTP)를 폴백으로 추가**한다: `signInWithOtp({ email, options: {
  shouldCreateUser: false, emailRedirectTo } })`. 이유는 하나가 아니라 셋이다.
  1. **Naver 가입자의 유일한 진입로**가 된다(Naver는 이메일을 제공하므로 `auth.users.email`이
     채워져 있다). Naver를 제외하되 Naver 사용자를 버리지는 않는 것이 이 조합의 핵심이다.
  2. culiver에는 **비밀번호 재설정 UI가 없다**(ADR 0005 6절에서 범위 밖). 비밀번호를 잊은
     이메일 가입자도 같은 버튼 하나로 해결된다.
  3. 비용이 함수 호출 1개 + UI 상태 1개다. 별도 화면·라우트·백엔드 변경이 없다.
  - **★`shouldCreateUser: false`는 협상 대상이 아니다.** 기본값(true)이면 존재하지 않는
    이메일 입력 시 **Supabase에 신규 계정이 생성**되어, 초대 기반 정책을 우회하는 고아 계정이
    쌓이고 shrimp365의 `handle_new_user` 트리거가 `profiles` 행까지 만든다. 반드시 false.

**결과적으로 culiver 로그인 화면의 수단은 4개**: 이메일+비밀번호(기존) / Google / Kakao /
매직링크. 회원가입 버튼은 여전히 없다(초대 기반 유지 — 4절).

### 3. ★카카오 email 부재 대응 — **(b) 초대 시 `supabase_user_id` 직접 지정 경로를 연다**

카카오 가입자는 JWT에 `email` 클레임이 없을 수 있고, `_lazy_link`는 그 경우 **403으로 즉시
거절**한다(`apps/api/app/deps.py::_lazy_link` 첫 분기). 이메일이 없으면 "누구의 초대장인가"를
매칭할 키가 없기 때문이며, 이 방어 자체는 옳다(임의 매칭은 멀티테넌시 사고와 동급).

**결정**: 초대 API가 **이메일 대신 Supabase UID로 미리 연계된 행을 생성**할 수 있게 확장한다.

```
POST /organizations/{org_id}/users        # owner 전용(require_owner), 기존 그대로
{
  "email": "contact@example.com",         # (기존) 필수 유지 — 아래 주석 참고
  "role": "owner" | "operator" | "viewer",
  "supabase_user_id": "8f3c…-uuid" | null # (신규, 선택) 지정 시 "선연계(pre-linked)" 초대
}
```

- `supabase_user_id`가 **주어지면**: `users` 행을 그 값으로 **채운 채** 생성한다. 그 사용자의
  첫 로그인은 `users.supabase_user_id == sub` 직접 조회에 성공하므로 **`_lazy_link`를 아예 타지
  않는다** → email 클레임 유무와 무관하게 통과한다. 이것이 카카오 문제를 푸는 정확한 지점이다.
- `email`은 계속 필수다. UID 연계 시에도 **연락 가능한 사람 식별 라벨**(감사 로그·운영 문의·
  `GET /auth/me` 표시)이 필요하고, `ux_users_org_email` 유니크 제약과 NOT NULL 컬럼을
  건드리지 않아야 마이그레이션이 불필요하기 때문이다. **UID 초대에서 email은 JWT의 email과
  일치할 필요가 없다**(매칭에 쓰이지 않는다) — 운영자가 오프라인으로 아는 연락처를 넣는다.
- **스키마 변경 없음**: `supabase_user_id` 컬럼과 부분 유니크 인덱스는 ADR 0005 3절에서 이미
  존재한다. 마이그레이션 0건 — 이 안을 고른 실질적 이유 중 하나다.

**기각한 대안**:

- **(a) 그대로 둔다(카카오 사용자는 다른 수단으로 재가입)**: 재가입은 곧 **Supabase 계정이 하나
  더 생긴다**는 뜻이고, 그러면 그 사람은 shrimp365 계정과 culiver 계정이 분리된다 — **"계정만
  공유"라는 요구를 카카오 사용자에 한해 정면으로 위반**한다. 안내 문구만으로 덮을 수 있는
  성질의 문제가 아니라고 판단해 기각.
- **(c) shrimp365 카카오 스코프를 `account_email`로 확장**: 이것이 **근본 해결책이 맞다**. 그러나
  카카오 **비즈앱 심사 승인**이라는 코드 밖 의존성이 있어 이번 작업으로 해결할 수 없고, 승인 전
  요청 시 KOE205로 **로그인 자체가 깨진다**(운영 중 서비스의 회귀). 따라서 이번 범위에서
  코드로는 채택하지 않고, **운영 액션 아이템으로 병행 추진**할 것을 권고한다(7절). 승인 완료 시
  (b) 경로는 자연스럽게 사용 빈도가 0으로 수렴하며, 코드를 제거할 필요도 없다(해가 없다).

**잔여 리스크(수용)**: owner가 임의의 UUID를 입력해 타인의 Supabase 계정을 자기 org에 선연계할
수 있다. 다만 (i) 이미 다른 org에 연계된 UID는 부분 유니크 인덱스가 물리적으로 막고, (ii)
피해 범위는 "**owner 자신의 org 데이터가 그 사람에게 열린다**"로 한정되며(타 org 유출 아님 —
Hard Rule 4 위반 아님), (iii) owner가 임의 이메일로 초대할 수 있는 기존 권한과 **동급의 신뢰
모델**이다. owner 전용 + `audit_logs` 기록으로 충분하다고 판단한다.

### 4. 초대 기반 유지 — **자동 프로비저닝 없음. 대신 403 안내를 shrimp365 맥락으로 개선**

**결정**: ADR 0005 4절의 초대 기반 정책을 **그대로 유지**한다. shrimp365 계정으로 인증에
성공했다는 사실은 **신원 확인**일 뿐, "어느 org의 구성원인가"에 대한 답이 아니다. 자동
프로비저닝을 열면 shrimp365의 전체 가입자가 임의로 어떤 org에든 들어오는 경로가 생기며, 이는
Hard Rule 4(멀티테넌시 누수 금지) 정신에 정면으로 반한다. shrimp365가 **B2C 셀프서비스**이고
culiver가 **B2B 계약 기반**이라는 사업 모델 차이가 그대로 인증 정책 차이로 나타나는 것이며,
이 비대칭은 버그가 아니라 설계다.

**단, 그 대가로 UX 함정이 생긴다**: 사용자는 "연동됐다는데 로그인은 되고 화면은 안 나온다"를
겪는다. 현재 구현에서는 로그인 성공 → `RequireAuth`가 토큰 존재만 보고 통과 → `/overview`
진입 → 모든 API가 403 → **각 페이지가 제각각 깨진 화면**을 보여준다. 이를 다음 계약으로 막는다.

- **BE**: `_lazy_link`의 **"email 클레임 없음"** 분기 메시지를 0건 매칭과 **분리**한다.
  - email 클레임 없음 → `403 "account has no email claim; ask your administrator to link this
    account by supabase user id"` (= 3절 (b) 경로로 안내하는 문구 — 카카오 사용자가 여기 온다)
  - 0건 매칭 → `403 "no invitation found for this account"` (**기존 문구 유지** —
    `tests/test_auth_supabase.py`가 `"no invitation"`을 단언한다, 회귀 금지)
- **FE**: `RequireAuth` **한 곳에서** `useAuthMe()`의 403을 잡아 전용 안내 화면을 렌더한다
  (페이지마다 흩뿌리지 않는다 — 보호 라우트 전체가 한 번에 커버된다). 문구는 "**shrimp365
  계정으로 정상 인증되었으나, 컬리버 MRV 플랫폼 이용 신청이 아직 완료되지 않았습니다**" 계열로
  **인증 성공과 권한 부재를 분리해** 설명하고, 문의 경로와 **로그아웃 버튼**을 함께 둔다.
  - 로그아웃 버튼은 장식이 아니다. 세션이 localStorage에 남으므로, 버튼이 없으면 잘못된 계정으로
    들어온 사용자가 **다른 계정으로 재시도할 방법 없이 갇힌다**.

### 5. shrimp365 홈페이지 진입 버튼 — **순수 추가, 환경변수 게이트, 4개 로케일**

운영 중인 서비스에 가하는 **유일한** 변경이다. 원칙은 "**설정하지 않으면 아무것도 바뀌지
않는다**".

- **주소는 `NEXT_PUBLIC_MRV_PLATFORM_URL` 환경변수**로 뺀다. culiver 배포 도메인이 미확정이므로
  하드코딩 금지. **값이 없으면 버튼을 아예 렌더하지 않는다**(깨진 링크 노출 방지). 이는
  `lib/features.ts`의 `SHOW_CARDNEWS`/`SHOW_BOARD` 스위치와 **동일한 기존 관례**이므로 그 파일에
  상수를 추가한다(신규 패턴을 만들지 않는다).
  - Next.js 제약: `NEXT_PUBLIC_*`는 빌드타임 정적 치환이므로 `process.env.NEXT_PUBLIC_MRV_PLATFORM_URL`을
    **문자열 리터럴로 직접** 참조해야 한다(동적 인덱싱 금지).
- **i18n 키 1개 추가**: `nav.mrvPlatform`. `Dict`는 전체 필수 타입이므로 `types.ts` + `ko/en/vi/id`
  **4개 사전 모두**에 넣지 않으면 타입 체크가 깨진다(= 누락 시 CI가 잡아준다, 좋은 성질).
  `agri-ko.ts`는 `DictOverride`(부분 타입)이므로 **수정 불요**.
- **배치와 시각적 위계**: 데스크톱 우측 액션 그룹의 **맨 왼쪽**(로그인 왼편), 모바일 패널
  하단 액션 영역의 **맨 위**, 그리고 `PublicFooter` 말미. 스타일은 **브랜드색 테두리+글자
  (`#1E40AF`)**로 하고 **채움(filled) 스타일은 쓰지 않는다** — 채움은 `회원가입`이 독점하는
  최상위 CTA 표기이며, 이를 침범하면 기존 전환 동선의 우선순위가 흐려진다. 위계는
  `회원가입`(채움) > `MRV 플랫폼`(브랜드색 테두리) > `로그인`(중립 테두리) 순의 시각 강도가 아니라,
  **`회원가입`(채움) 단독 최상위, 나머지 둘은 동급 테두리이되 색으로만 구분**되도록 한다.
- 외부 도메인이므로 `target="_blank" rel="noopener noreferrer"`. `next/link`가 아닌 순수
  `<a>`를 쓰고, **기존 `links` 배열에 넣지 않는다**(그 배열은 `stripLocalePrefix` 기반
  `isActive` 계산을 타므로 절대 URL이 들어가면 오작동한다).

### 6. 데이터 분리 보장 — 구조적 보장 1개 + 규율 보장 1개(테스트로 강제)

- **구조적 보장(백엔드)**: culiver API는 `DATABASE_URL`(자체 Postgres/TimescaleDB)로만 연결하며
  Supabase Postgres에 대한 **연결 문자열도, 클라이언트 라이브러리도, 자격증명도 없다**.
  `SUPABASE_URL`은 코드에서 사용되지 않고 `SUPABASE_JWT_SECRET`은 **서명 검증용 대칭키일 뿐
  DB 접근 수단이 아니다**. 따라서 shrimp365의 `profiles`/`farms`/`tanks`/`journal_entries`/
  `water_quality_readings` 등은 culiver 백엔드에서 **접근 자체가 불가능**하다. 역방향도 동일 —
  shrimp365는 culiver DB의 존재를 모르며, culiver 데이터에 닿는 유일한 경로인 culiver API는
  org 초대와 JWT를 요구한다.
- **★규율 보장(프런트, 정직하게 기록한다)**: culiver FE는 shrimp365와 **동일한 Supabase 프로젝트의
  anon key**를 들고 있다. 따라서 코드가 마음먹으면 `supabase.from("farms").select()`로
  **PostgREST를 통해 shrimp365 데이터에 접근할 수 있다**(그 사용자의 RLS 범위 내에서). 이것은
  구조가 아니라 규율이 막고 있는 경계이므로, **규율을 테스트로 물리화**한다.
  - 계약: `apps/web/src`에서 `supabase` 클라이언트의 **`auth` 이외 표면 사용 금지**
    (`.from(` / `.rpc(` / `.storage` / `.functions` / `.channel(`).
  - 강제: 소스 트리를 스캔해 위 패턴 부재를 단언하는 **단위 테스트 1개**를 둔다(신규 의존성 없음,
    결정론적). 위반 시 CI 실패. ADR 0002의 "관례가 아닌 물리적 강제" 철학을 그대로 적용한다.
- **결제·구독 비연동 재확인**: `profiles.plan`(free/basic/pro/enterprise, `stripe_*`)과
  `organizations.plan`(START/PRO/ENTERPRISE)은 **서로 읽지도 쓰지도 않는다**. 두 값이 어긋나는
  것은 버그가 아니라 이번 범위의 정의다.

---

## 대안 (Alternatives considered)

- **Supabase Postgres를 culiver의 DB로도 사용(단일 DB 통합)**: 1절에서 기각 — TimescaleDB 부재,
  세션 GUC 기반 RLS와의 부적합, 운영 중 `public` 스키마 오염. 무엇보다 "데이터는 완전 별건"이라는
  사용자 결정과 충돌한다.
- **culiver 전용 Supabase 프로젝트를 새로 만들고 계정을 복제/동기화**: 계정 공유가 아니라 계정
  **복제**가 되어 비밀번호 해시·소셜 연결·이메일 인증 상태를 지속 동기화해야 한다(양방향
  일관성 문제). 요구는 "공유"이지 "복제"가 아니므로 기각.
- **크로스도메인 SSO 핸드오프(shrimp365 → culiver 토큰 전달)**: 1절 말미에서 기각 — URL/포스트
  메시지를 통한 토큰 전달은 신규 공격 표면이며, 이득은 "로그인 한 번 덜 하기"에 그친다.
- **Naver 커스텀 OAuth를 culiver에 이식**: 2절에서 기각(service_role 키 보관 표면 신설).
- **shrimp365의 Naver 콜백 라우트를 재사용**: 2절에서 기각(운영 서비스 인증 라우트 변경 필요).
- **자동 프로비저닝(shrimp365 로그인 = culiver 자동 가입)**: 4절에서 기각(Hard Rule 4).
- **카카오 email 부재를 (a) 안내만으로 처리**: 3절에서 기각(그 사용자에 한해 계정이 분리되어
  요구 자체가 깨진다).
- **초대 전용 `invitations` 테이블 신설 + UID 초대 별도 엔드포인트**: 기존 초대 API에 선택
  필드 1개를 더하는 것으로 충분하므로 기각(과설계 금지, ADR 0005가 "users 행이 초대장을 겸한다"로
  이미 결정).

---

## 결과 (Consequences)

- (+) **마이그레이션 0건, 백엔드 스키마 변경 0건**. 연계 비용의 대부분이 "설정값 주입"으로
  끝난다(1절 — 기존 구조가 이미 인증 전용이었던 덕분).
- (+) shrimp365 저장소 변경이 **UI 순수 추가 1건**(헤더/푸터 버튼 + i18n 키 1개 + 상수 1개)으로
  한정된다. 환경변수 미설정 시 렌더 자체가 없으므로 **배포해도 현행 화면이 그대로**다.
- (+) 소셜 4수단(비밀번호/Google/Kakao/매직링크)으로 shrimp365 가입자 대다수가 재가입 없이
  진입한다.
- (+) 데이터 격리가 백엔드에서 **구조적으로**, 프런트에서 **테스트로** 보장된다(6절).
- (−) **세션은 공유되지 않는다** — 사용자는 culiver에서 한 번 더 로그인한다(1절, 알려진 제약).
- (−) **Naver 가입자는 소셜 버튼으로 못 들어온다** — 매직링크로 우회한다(2절). 매직링크는
  Supabase 메일 발송에 의존하므로 **기본 SMTP의 발송 한도**가 파일럿을 넘어서면 커스텀 SMTP
  설정이 필요하다(운영 항목).
- (−) 카카오 사용자는 운영자가 **Supabase UID를 대시보드에서 찾아 입력**하는 수작업 초대가
  필요하다(3절). 카카오 비즈앱 승인 시 자연 소멸하는 부채임을 명시한다.
- (−) owner가 임의 UID를 선연계할 수 있는 잔여 리스크를 감사 로그로만 방어한다(3절, 수용).
- (−) culiver FE가 shrimp365와 **같은 anon key**를 갖게 되므로, 6절 규율 테스트가 이 연계의
  **상시 게이트**가 된다(제거하면 격리 주장이 무너진다 — 삭제 금지 대상으로 표시).
- 후속 ADR 트리거: (a) 결제·구독을 실제로 연동하기로 결정하는 시점, (b) 두 서비스를 동일
  등록가능 도메인(`mrv.shrimp365.kr` 등)에 두고 SSO를 요구하는 시점, (c) Supabase가 레거시
  HS256 JWT Secret 발급을 중단해 ADR 0005 1절 전제가 깨지는 시점, (d) culiver가 shrimp365
  데이터를 **읽어야 하는** 요구가 실제로 생기는 시점(그때는 본 ADR의 격리 결정을 명시적으로
  뒤집는 ADR이 필요하다 — 조용히 `.from()`을 추가하는 것은 금지).

---

## 실행 전제 (사용자/운영진 확인 필요 — Proposed 상태 사유)

코드로 해결할 수 없고 **사용자·컬리버 운영진만 수행 가능한** 항목이다. 전부 완료되기 전에는
`AUTH_MODE=supabase` 경로의 운영 배포가 불가하다.

> ### ⚠ 개발 선행 조건 (2026-08-29 추가, ADR 0007)
>
> - [ ] **ADR 0007(`docs/adr/0007-rls-operational-correctness.md`) 구현 완료 + `qa-reviewer` 승인**
>       — 마이그레이션 0013(`users`/`api_keys` 명령 분할 RLS 정책), `deps.py::_lazy_link` 의
>       org 컨텍스트 바인딩, `db/session.py` 의 트랜잭션 컨텍스트 재적용.
>       **이것이 없으면 아래 항목을 전부 채워도 실 Postgres 에서 모든 로그인이 403 으로 실패한다**
>       (실 Postgres 16 비 superuser 역할에서 재현 확인: `users` 는 RLS 대상이라 org 컨텍스트
>       없는 인증 조회가 0행을 반환 — ADR 0005 상단 정정 고지 참조).
>       본 항목은 사용자 확인 사항이 아니라 **backend-engineer 작업**이며, 아래 운영진 항목과
>       **병행 진행 가능**하다.
> - [ ] 위와 함께 `make test-rls`(ADR 0007 4절, Postgres 전용 11건)가 **비 superuser 역할**에서
>       전건 통과함을 확인. 특히 `test_supabase_login_end_to_end_on_postgres` 가 본 ADR 의
>       카카오 선연계 초대(3절) 경로까지 커버하는지 확인할 것.

- [ ] **shrimp365 Supabase 프로젝트의 JWT Secret 방식 확인**: ADR 0005는 **레거시 HS256 공유
      비밀**을 전제한다. 해당 프로젝트가 이미 비대칭 JWT Signing Keys로 전환되었다면 본 연계
      전에 **ADR 0005 1절의 마이그레이션 트리거가 발동**한다(JWKS 전환 ADR 선행 필요).
      → **가장 먼저 확인해야 할 단 하나의 항목이다.**
- [ ] culiver `infra/.env`에 `SUPABASE_JWT_SECRET` = shrimp365 프로젝트 JWT Secret 주입(커밋 금지).
- [ ] culiver `apps/web/.env`에 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` = shrimp365 프로젝트 값 주입.
- [ ] **Supabase Dashboard > Authentication > URL Configuration > Redirect URLs**에 culiver
      도메인 추가: `https://<culiver-domain>/login`, 개발용 `http://localhost:5173/login`.
      **Site URL은 `https://www.shrimp365.kr` 그대로 둔다**(변경 시 shrimp365의 인증 메일
      링크가 깨진다 — 운영 서비스 회귀).
- [ ] Google/Kakao Provider는 프로젝트 단위 설정이므로 **provider 콘솔(구글/카카오 개발자센터)
      변경은 불요**함을 확인(콜백은 여전히 `https://<project>.supabase.co/auth/v1/callback`).
- [ ] shrimp365 배포 환경에 `NEXT_PUBLIC_MRV_PLATFORM_URL` 설정(값이 없으면 버튼 미노출 —
      **culiver 배포 전까지는 의도적으로 비워 두는 것이 정상**이다).
- [ ] (병행 권고, 이번 범위 밖) **카카오 비즈앱 심사 신청** → 승인 후 `account_email` 스코프
      확대. 3절 (b)의 수작업 초대를 근본적으로 없애는 유일한 길이다.
- [ ] (조건부) 매직링크 사용량이 Supabase 기본 SMTP 한도를 넘으면 커스텀 SMTP 설정.
