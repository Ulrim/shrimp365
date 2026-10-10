# shrimp365 ↔ culiver-mrv-platform 계정 연계 — 구현 계약서

- 근거 ADR: **ADR 0006**(`docs/adr/0006-shrimp365-account-federation.md`) — 결정의 *이유*는
  ADR에, 구현의 *계약*은 이 문서에 있다. 충돌 시 ADR이 우선한다.
- 선행 ADR: ADR 0005(Supabase Auth 통합) — 본 문서는 그 계약을 **확장**하며 뒤집지 않는다.
- 범위 고정(사용자 결정): **계정(로그인)만 공유 / 데이터 완전 별건 / 결제·구독 제외**.
- 작성: architect (2026-08-29)

> **읽는 사람에게**: 이 문서는 6개의 독립 슬라이스(FED-1 ~ FED-6)로 구성된다. 각 슬라이스는
> 담당 에이전트·변경 파일·정확한 시그니처·수용 기준을 갖는다. 인터페이스(타입/스키마/문구)는
> architect가 여기서 못박았으므로 구현 에이전트는 **이 문서의 시그니처를 임의로 바꾸지 않는다**.
> 바꿔야 한다면 먼저 architect에게 되돌린다.

---

## 0. 전체 그림과 슬라이스 의존 관계

```
FED-0 (운영/설정)  ── 사용자·운영진 몫, 코드 아님 (ADR 0006 실행 전제)
   │
   ├─ FED-1  BE  초대 API 확장(supabase_user_id) + 403 메시지 분리      backend-engineer
   ├─ FED-2  FE  로그인 화면: Google/Kakao/매직링크 추가                frontend-engineer
   ├─ FED-3  FE  미초대(403) 안내 게이트 + 로그아웃                      frontend-engineer
   ├─ FED-4  FE  Supabase 데이터 평면 사용 금지 가드 테스트              frontend-engineer
   ├─ FED-5  ★shrimp365 저장소: 진입 버튼(순수 추가)                    frontend-engineer
   └─ FED-6  DOC .env.example 갱신 + 운영 체크리스트                    backend-engineer
```

- **FED-1과 FED-3은 짝**이다(백엔드 문구 변경 ↔ 프런트 안내 화면). 순서는 FED-1 먼저.
- **FED-2, FED-4, FED-5는 서로 독립**이며 병렬 가능하다.
- **FED-5만 다른 저장소**(`/workspace/shrimp365`)를 건드린다. 나머지는 전부
  `/home/user/culiver-mrv-platform`.
- 전 슬라이스 머지 전 `qa-reviewer` 검증(CLAUDE Rule 10).

**수직 슬라이스 관점의 최소 관통 경로**: FED-1 → FED-2 → FED-3 이 셋이면 "shrimp365 소셜
계정으로 culiver 로그인 → 초대돼 있으면 대시보드, 아니면 명확한 안내"라는 사용자 여정이
DB→API→UI로 끝까지 관통한다. FED-4/5/6은 그 여정을 지키고 알리는 보강이다.

---

## 1. 환경변수 계약 (전체)

### 1.1 culiver 백엔드 — `infra/.env.example` (신규 변수 없음, **주석만 갱신**)

```bash
# --- Auth (ADR 0005 / ADR 0006) ---
AUTH_MODE=test-local
# ★ADR 0006: shrimp365(www.shrimp365.kr)와 "동일한" Supabase 프로젝트의 JWT Secret 을 넣는다.
#   이 값이 같아야 shrimp365 로 발급된 토큰을 culiver 가 검증할 수 있다(= 계정 공유의 실체).
#   주의: 레거시 HS256 공유 비밀이어야 한다(비대칭 Signing Key 로 전환된 프로젝트라면
#   ADR 0005 1절 마이그레이션 트리거 발동 — 코드 착수 전 확인 필요).
SUPABASE_JWT_SECRET=
# 참고용(백엔드 코드는 사용하지 않음). ★ADR 0006 6절: 이 값이 있어도 백엔드는 Supabase
#   Postgres 에 접속하지 않는다 — culiver 업무 데이터는 DATABASE_URL(자체 TimescaleDB) 전용.
SUPABASE_URL=
```

**변경 금지**: `DATABASE_URL`은 계속 culiver 자체 Postgres/TimescaleDB를 가리킨다. Supabase의
DB 연결 문자열을 여기에 넣는 것은 ADR 0006 1절 위반이다.

### 1.2 culiver 프런트 — `apps/web/.env.example`

```bash
# --- Supabase Auth (ADR 0005 / ADR 0006) ---
# ★ADR 0006: shrimp365 와 동일한 Supabase 프로젝트 값을 넣는다.
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# --- 미초대 계정 안내 문의 경로 (ADR 0006 4절, FED-3) ---
# 이메일 주소 또는 https URL. 비워 두면 문의 링크를 렌더하지 않고 일반 안내 문구만 보여준다
# (값 없을 때 깨진 링크를 노출하지 않는다 — shrimp365 진입 버튼과 동일한 원칙).
VITE_SUPPORT_CONTACT=
```

### 1.3 shrimp365 — `.env.example` (FED-5)

```bash
# 컬리버 탄소 MRV 플랫폼 진입 주소(예: https://mrv.culiver.co.kr).
# 비워 두면 헤더/푸터에 진입 버튼을 렌더하지 않는다 — culiver 배포 전까지는 비워 두는 것이 정상.
NEXT_PUBLIC_MRV_PLATFORM_URL=
```

---

## FED-1 (BE) 초대 API 확장 + 403 메시지 분리

**담당**: `backend-engineer` · **저장소**: culiver · **마이그레이션**: **없음**(컬럼·인덱스 기존)

### 1) `apps/api/app/schemas/organization.py`

```python
# 기존 _EMAIL_PATTERN 아래에 추가.
# Supabase auth.users.id 는 UUID v4 문자열이다. 형식 검증만 하고(존재 검증은 불가 —
# 백엔드는 Supabase Admin API 를 호출하지 않는다, ADR 0006 1절) 나머지는 owner 책임.
_SUPABASE_UID_PATTERN = (
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


class UserInviteRequest(BaseModel):
    email: str = Field(..., pattern=_EMAIL_PATTERN, max_length=320)
    role: UserRole
    # ADR 0006 3절: 카카오처럼 JWT 에 email 클레임이 없는 계정을 위한 "선연계 초대".
    # 지정 시 users 행을 이 UID 로 채운 채 생성 → 첫 로그인이 _lazy_link 를 타지 않는다.
    # None(기본) 이면 기존 이메일 기반 lazy-link 초대와 완전히 동일하게 동작한다.
    supabase_user_id: str | None = Field(default=None, pattern=_SUPABASE_UID_PATTERN)


class UserInviteResponse(BaseModel):
    id: str
    org_id: str
    email: str
    role: UserRole
    linked: bool          # 선연계 초대면 True, 이메일 초대면 False
```

**하위호환 필수**: `supabase_user_id`를 보내지 않는 기존 요청은 **바이트 단위로 동일하게**
동작해야 한다(기존 테스트 무수정 통과가 수용 기준).

### 2) `apps/api/app/routers/organizations.py::invite_user`

계약(의사코드 — 기존 흐름에 2단계만 삽입):

```
경로 org_id != auth.org_id → 404                                  (기존 유지)

if payload.supabase_user_id is not None:                           (신규)
    이미 그 UID 를 가진 users 행이 있으면 → 409
      detail = "this supabase account is already linked to a user"
    # 부분 유니크 인덱스(ux_users_supabase_user_id)가 최종 방어선이나, 선조회로
    # 이메일 중복(409)과 UID 중복(409)의 메시지를 구분해 운영자가 원인을 알 수 있게 한다.

User(..., supabase_user_id=payload.supabase_user_id) 삽입          (기존 + 값 주입)
flush → IntegrityError → rollback → 409 "a user with this email already exists in this organization"
                                                                   (기존 문구 유지, 회귀 금지)

audit(entity='users', action='invite', diff.after = {              (신규 필드 2개)
    "email":…, "role":…, "linked": bool(payload.supabase_user_id),
    "supabase_user_id": payload.supabase_user_id,                  # None 이면 None
})

201 UserInviteResponse(..., linked=bool(payload.supabase_user_id))
```

- `action`은 **`'invite'` 그대로** 둔다(신규 action 값을 만들지 않는다 — 감사 로그 소비자의
  기존 필터가 깨지지 않도록. 구분은 `diff.after.linked`로 충분하다).
- 권한은 `require_owner` 그대로. **operator/viewer는 여전히 403**.

### 3) `apps/api/app/deps.py::_lazy_link` — 첫 분기 메시지만 교체

```python
if not email:
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        # ADR 0006 3절/4절: 카카오 등 email 클레임이 없는 계정이 여기 온다. 0건 매칭과
        # 원인이 다르므로 문구를 분리해 운영자가 UID 선연계 초대로 안내할 수 있게 한다.
        detail=(
            "account has no email claim; ask your administrator to link "
            "this account by supabase user id"
        ),
    )
```

- **0건 매칭 분기의 `"no invitation found for this account"`는 절대 바꾸지 않는다**
  (`tests/test_auth_supabase.py::test_supabase_no_invitation_returns_403`이 `"no invitation"`을
  단언한다).
- **상태 코드는 둘 다 403 유지**(신원은 확인됐고 권한이 없는 것 — 401 아님).

### 수용 기준 (FED-1)

- [ ] `supabase_user_id` 없이 보낸 기존 초대 요청의 응답이 이전과 동일(`linked: false`).
      **기존 organizations 테스트 전부 무수정 통과**.
- [ ] `supabase_user_id` 지정 초대 → 201 + `linked: true`, DB 행에 UID가 채워져 있음.
- [ ] 그 UID로 만든 **email 클레임 없는** 합성 Supabase JWT로 보호 API 호출 → **200**
      (`_lazy_link`를 타지 않고 직접 조회로 통과하는지 확인 — 이 테스트가 FED-1의 핵심이다).
- [ ] 동일 UID 재초대(다른 org 포함) → 409 `"already linked"`.
- [ ] 형식이 UUID가 아닌 `supabase_user_id` → 422(pydantic 자동).
- [ ] owner 아닌 role의 선연계 초대 시도 → 403.
- [ ] email 클레임 없는 **미초대** 계정 → 403이며 detail에 `"supabase user id"`가 포함.
- [ ] 0건 매칭 → 403 detail에 `"no invitation"` 포함(회귀 없음).
- [ ] audit_logs에 `action='invite'`, `diff.after.linked`/`supabase_user_id` 기록.
- [ ] 타 org로의 선연계 시도(경로 org_id ≠ auth.org_id) → 404(테넌시 방어 회귀 없음).

---

## FED-2 (FE) 로그인 화면 — Google / Kakao / 매직링크

**담당**: `frontend-engineer` · **저장소**: culiver · **신규 의존성 없음**

### 변경 파일

- `apps/web/src/lib/supabase-client.ts` — **변경 없음**(기존 싱글턴·세션 캐시 그대로 재사용).
  `detectSessionInUrl` 기본값(true)이 OAuth 콜백 해시를 처리하므로 **콜백 라우트 신설 불요**.
- `apps/web/src/features/auth/LoginPage.tsx` — 아래 계약대로 확장.
- `apps/web/src/features/auth/LoginPage.test.tsx` — 케이스 추가.

### 시그니처 계약

```ts
// LoginPage 내부. 라우팅 신설 없음 — 콜백도 /login 으로 돌아온다.
const OAUTH_REDIRECT_TO = `${window.location.origin}/login`;

// 1) 소셜 (Google / Kakao)
async function signInWithProvider(provider: "google" | "kakao"): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: OAUTH_REDIRECT_TO },
  });
  // 성공 시 브라우저가 Supabase 로 이동하므로 이 아래는 실패 경로에서만 실행된다.
}

// 2) 매직링크 (이메일 OTP) — Naver 가입자·비밀번호 분실자의 진입로 (ADR 0006 2절)
async function sendMagicLink(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // ★★ 절대 변경 금지 (ADR 0006 2절): true(기본값)면 존재하지 않는 이메일로도
      //     Supabase 계정이 신규 생성되어 초대 기반 정책을 우회하는 고아 계정이 생기고,
      //     shrimp365 의 handle_new_user 트리거가 profiles 행까지 만든다.
      shouldCreateUser: false,
      emailRedirectTo: OAUTH_REDIRECT_TO,
    },
  });
}
```

### UI 계약

- 기존 이메일+비밀번호 폼을 **그대로 유지**하고 그 아래에 구분선("또는") + 소셜 버튼 2개
  (Google, Kakao) + "이메일로 로그인 링크 받기" 액션을 배치한다.
- 매직링크는 **폼의 email 입력값을 재사용**한다(별도 입력 필드를 만들지 않는다 — 과설계 금지).
  email이 비어 있으면 "이메일을 먼저 입력하세요" 안내.
- 매직링크 발송 결과는 **성공/실패를 구분해 노출하지 않는다**: 성공이든 `shouldCreateUser:
  false`로 인한 미존재 실패든 **동일하게** "입력하신 이메일로 로그인 링크를 보냈습니다.
  메일함을 확인하세요."를 표시한다(사용자 열거 방지 — 기존 LoginPage의 일반화된 에러 문구
  정책과 동일한 원칙).
- 소셜 로그인 실패 시: "소셜 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요."
- 안내 문구 1줄 추가(ADR 0006 1절의 "세션 비공유"를 사용자 언어로): **"shrimp365 계정으로
  로그인할 수 있습니다."** — 사용자가 "가입해야 하나?"로 오해하지 않게 하는 것이 목적이다.
- 회원가입 링크는 **여전히 두지 않는다**(초대 기반 유지, ADR 0006 4절).

### 수용 기준 (FED-2)

- [ ] Google/Kakao 버튼 클릭 시 `signInWithOAuth`가 `{ provider, options.redirectTo }`로
      **정확히 1회** 호출된다(mock 단언).
- [ ] 매직링크 호출이 **`shouldCreateUser: false`를 포함**한다 — 이 단언은 삭제 금지 대상이다.
- [ ] 매직링크: 성공/실패 응답 모두 **동일 문구**를 렌더(열거 방지).
- [ ] email 미입력 상태로 매직링크 클릭 → 네트워크 호출 없이 검증 문구.
- [ ] 기존 이메일+비밀번호 로그인 테스트 **무수정 통과**.
- [ ] 접근성: 소셜 버튼에 접근 가능한 이름(`Google로 계속하기` 등), 에러는 `role="alert"`.

---

## FED-3 (FE) 미초대 계정 안내 게이트

**담당**: `frontend-engineer` · **저장소**: culiver · **의존**: FED-1(문구 분리) 선행

### 문제 정의

로그인은 성공했는데 초대가 없으면(ADR 0006 4절) 현재는 `RequireAuth`가 토큰 존재만 보고
통과시켜 `/overview`로 들어가고, 그 안의 모든 API가 403을 뱉어 **페이지마다 제각각 깨진
화면**이 나온다. 사용자에게는 "연동됐다더니 왜 안 되냐"로 보인다.

### 변경 파일

- `apps/web/src/features/auth/NotInvitedPage.tsx` (신규)
- `apps/web/src/App.tsx::RequireAuth` (변경 — **이 한 곳만** 고치면 보호 라우트 전체가 커버된다)
- 테스트: `apps/web/src/features/auth/NotInvitedPage.test.tsx`(신규), `App` 가드 테스트 보강

### `RequireAuth` 계약

```tsx
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, sessionReady } = useAuth();
  const me = useAuthMe();          // 이미 존재. 403 시 retry 하지 않는다(기존 설정).

  if (!sessionReady) return null;                       // 기존 동작 유지
  if (!isAuthenticated) return <Navigate to="/login" replace />;  // 기존 동작 유지

  // 신규: 인증은 됐으나 이 계정에 초대(=org 소속)가 없다 → 안내 화면으로 대체.
  // 401 은 여기서 다루지 않는다(토큰 만료는 세션 갱신/로그아웃 경로가 처리).
  if (me.error instanceof ApiError && me.error.status === 403) return <NotInvitedPage />;

  return <>{children}</>;
}
```

- **409(다중 org 초대 모호)도 같은 화면으로 보낼 것**: 사용자 입장에서 "관리자에게 문의"라는
  행동이 동일하고, 별도 화면을 만드는 것은 과설계다. 단 **본문 문구는 분기**한다(아래).
- `me.isLoading` 중에는 **기존 동작을 바꾸지 않는다**(children 렌더). 성급히 안내 화면을 띄우면
  정상 사용자에게 깜빡임이 생긴다.

### `NotInvitedPage` 문구 계약 (ko 고정 — culiver FE는 단일 로케일)

- 제목: **"이용 신청이 필요합니다"**
- 본문(403): **"shrimp365 계정으로 정상 인증되었습니다. 다만 컬리버 MRV 플랫폼은 조직 단위
  이용 신청(초대)이 완료된 계정만 이용할 수 있습니다."**
- 본문(409): **"이 계정이 둘 이상의 조직에 초대되어 있어 자동 연결이 중단되었습니다. 관리자에게
  문의해 주세요."**
- 부가 안내(작은 글씨): **"카카오 계정처럼 이메일이 제공되지 않는 경우에도 관리자가 직접 연결할
  수 있습니다. 문의 시 사용 중인 로그인 방식을 함께 알려 주세요."**
  → FED-1의 UID 선연계 경로로 사용자를 실제로 데려가는 문장이다. 생략하지 말 것.
- 문의 버튼: `VITE_SUPPORT_CONTACT` 값이
  - 이메일 형태 → `mailto:` 링크, URL 형태(`https://`) → 새 탭 링크, **비어 있으면 링크를 렌더하지
    않고** 문구만 표시(깨진 링크 금지 — shrimp365 버튼과 동일 원칙).
- **로그아웃 버튼(필수)**: `supabase.auth.signOut()` → `/login`. 없으면 잘못된 계정으로 들어온
  사용자가 다른 계정으로 재시도할 방법 없이 갇힌다.

### 수용 기준 (FED-3)

- [ ] `/auth/me` 403 → 보호 라우트 어디로 접근해도 `NotInvitedPage` 렌더, 앱 셸(네비) 노출 안 됨.
- [ ] `/auth/me` 409 → 동일 화면 + 다중 조직 문구.
- [ ] `/auth/me` 200 → 기존과 동일하게 children 렌더(회귀 없음).
- [ ] `isLoading` 중 안내 화면이 **뜨지 않는다**(깜빡임 회귀 방지).
- [ ] 로그아웃 버튼 → `signOut` 호출 + `/login` 이동.
- [ ] `VITE_SUPPORT_CONTACT` 미설정 시 링크 요소가 DOM에 없다.
- [ ] 미인증(토큰 없음) → 기존대로 `/login` 리다이렉트(회귀 없음).

---

## FED-4 (FE) Supabase 데이터 평면 사용 금지 가드

**담당**: `frontend-engineer` · **저장소**: culiver · **ADR 0006 6절의 물리적 강제 장치**

culiver FE는 shrimp365와 **동일한 anon key**를 갖는다. 즉 마음만 먹으면 PostgREST로 shrimp365
데이터를 읽을 수 있다. "데이터 별건"을 규율이 아니라 **CI 게이트**로 만든다.

### 계약

- 신규 파일: `apps/web/src/lib/supabase-client.guard.test.ts`
- 동작: `apps/web/src` 하위 `.ts`/`.tsx`를 스캔(자기 자신 제외)해 아래 패턴이 **하나도 없음**을
  단언한다.
  - `supabase.from(` / `supabase.rpc(` / `supabase.storage` / `supabase.functions` /
    `supabase.channel(` / `supabase.realtime`
- 위반 시 실패 메시지에 **ADR 0006 6절과 "데이터는 별건" 요구를 명시**해, 나중에 이 테스트를
  만난 개발자가 "왜 막혔는지"를 즉시 알게 한다.
- 신규 의존성 금지(Node `fs`/`path`만 사용). 결정론적이어야 한다(파일 순회 순서에 의존한
  단언 금지).
- **이 테스트는 삭제·비활성화 금지 대상**이다. 파일 상단 주석에 그 사실을 명시한다.

### 수용 기준 (FED-4)

- [ ] 현재 코드베이스에서 통과.
- [ ] 임시로 `supabase.from("farms")` 한 줄을 넣으면 **실패**함을 확인(역검증).
- [ ] `supabase.auth.*` 사용은 통과(오탐 없음).

---

## FED-5 (★shrimp365 저장소) 홈페이지 진입 버튼 — 순수 추가

**담당**: `frontend-engineer` · **저장소**: `/workspace/shrimp365` · **운영 중 서비스**

> **최우선 원칙**: 기존 동작을 1도 바꾸지 않는 **순수 추가**. `NEXT_PUBLIC_MRV_PLATFORM_URL`이
> 없으면 **DOM이 지금과 완전히 동일**해야 한다. 기존 `links` 배열·`isActive`·기존 버튼의
> className은 **손대지 않는다**.

### 1) `lib/features.ts` — 기존 스위치 관례에 편승

```ts
// 컬리버 탄소 MRV 플랫폼 진입 주소. 비어 있으면 진입 버튼을 렌더하지 않는다.
// NEXT_PUBLIC_* 는 빌드타임 정적 치환이라 반드시 리터럴로 직접 참조해야 한다(동적 인덱싱 금지).
export const MRV_PLATFORM_URL = process.env.NEXT_PUBLIC_MRV_PLATFORM_URL ?? ""
```

### 2) i18n — 키 **1개** 추가 (`nav.mrvPlatform`)

`Dict`는 전부 필수 타입이므로 **5개 파일을 모두** 고쳐야 한다(누락 시 타입 체크 실패 = 안전장치).
`lib/i18n/agri-ko.ts`는 `DictOverride`(부분 타입)이라 **수정 불요**.

| 파일 | 추가 내용 |
|---|---|
| `lib/i18n/types.ts` | `nav` 블록에 `/** 컬리버 탄소 MRV 플랫폼 진입 라벨(외부 서비스). */ mrvPlatform: string` |
| `lib/i18n/ko.ts` | `mrvPlatform: "탄소 MRV 플랫폼",` |
| `lib/i18n/en.ts` | `mrvPlatform: "Carbon MRV Platform",` |
| `lib/i18n/vi.ts` | `mrvPlatform: "Nền tảng MRV các-bon",` |
| `lib/i18n/id.ts` | `mrvPlatform: "Platform MRV Karbon",` |

- 위치는 각 파일 `nav` 블록의 **`brandTagline` 바로 앞**(구조 대칭 유지).

### 3) `components/layout/public-header.tsx` — 3곳에 조건부 추가

공통: 외부 도메인이므로 **`next/link`가 아닌 `<a>`**, `target="_blank" rel="noopener noreferrer"`.
**`links` 배열에 절대 넣지 않는다**(그 배열은 `stripLocalePrefix` 기반 `isActive`를 타므로
절대 URL이 들어가면 오작동한다).

**(a) 데스크톱 — 우측 액션 그룹의 맨 왼쪽(`LangSelect` 다음, `로그인` 앞)**

```tsx
{MRV_PLATFORM_URL && (
  <a
    href={MRV_PLATFORM_URL}
    target="_blank"
    rel="noopener noreferrer"
    className="hidden sm:inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg
               border border-[#1E40AF]/40 text-[#1E40AF] hover:bg-[#1E40AF]/5 transition-colors"
  >
    {t.nav.mrvPlatform}
    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
  </a>
)}
```

**(b) 모바일 패널 — 하단 액션 영역의 맨 위(`로그인` 위)**, 동일 색 규칙 + `min-h-[44px]`,
`onClick={() => setOpen(false)}` 포함. 아이콘은 생략 가능.

**(c) `PublicFooter` — 링크 목록 뒤, `©` 표기 앞**에 같은 조건부 `<a>`(푸터 톤에 맞춰
`text-[#1E40AF] hover:underline`, 테두리 없음).

**시각적 위계 규칙(고정)**: **채움(filled `bg-[#1E40AF]`) 스타일은 `회원가입`이 독점**한다.
MRV 진입 버튼은 **브랜드색 테두리+글자**, `로그인`은 **중립 테두리** — 즉 최상위 CTA 자리를
침범하지 않으면서 색으로만 구분한다. 기존 전환 동선(회원가입)의 우선순위를 흐리지 않는 것이
목적이다.

- `import { ExternalLink } from "lucide-react"` (기존 `lucide-react` import 라인에 추가),
  `import { MRV_PLATFORM_URL, SHOW_BOARD, SHOW_CARDNEWS } from "@/lib/features"`.

### 4) `.env.example` — 1.3절 블록 추가

### 수용 기준 (FED-5)

- [ ] `NEXT_PUBLIC_MRV_PLATFORM_URL` **미설정 시** 헤더·모바일 패널·푸터의 DOM이 변경 전과 동일
      (진입 버튼 요소가 존재하지 않음).
- [ ] 설정 시 3곳(데스크톱/모바일/푸터) 모두 노출, `target="_blank" rel="noopener noreferrer"`.
- [ ] 4개 로케일 전환 시 각 라벨이 올바르게 표시된다.
- [ ] `tsc --noEmit`(또는 `next build`) 통과 — i18n 키 누락이 없음이 타입으로 증명된다.
- [ ] 기존 `로그인`/`회원가입` 버튼의 위치·스타일·동작 **무변경**, `links`/`isActive` **무변경**.
- [ ] 채움 스타일 버튼은 여전히 `회원가입` **하나뿐**이다.
- [ ] `supabase/schema.sql`·인증 로직·결제 관련 파일 **변경 0건**(diff로 확인).

---

## FED-6 (DOC) 환경변수 예시 + 운영 체크리스트

**담당**: `backend-engineer` · **저장소**: culiver

- `infra/.env.example`, `apps/web/.env.example`를 1.1/1.2절대로 갱신(실값 커밋 금지 — Rule 7).
- ADR 0006 7절 "실행 전제" 체크리스트를 운영진이 실행할 수 있는 형태로 유지한다.
- **최우선 확인 1건**: shrimp365 Supabase 프로젝트가 **레거시 HS256 JWT Secret**을 제공하는가.
  비대칭 Signing Key 전용으로 전환된 프로젝트라면 **FED-1~4 착수 전에 ADR 0005 1절의
  마이그레이션 트리거(JWKS 전환 ADR)가 먼저 발동**한다. 이 확인이 전체 연계의 선행 조건이다.

### 수용 기준 (FED-6)

- [ ] 세 개의 `.env.example`에 위 변수·주석이 반영되고 실값은 들어 있지 않다.
- [ ] `AUTH_MODE=test-local` 기본값에서 기존 테스트 스위트가 전부 통과(회귀 없음).

---

## 2. 이 연계가 **하지 않는 것** (범위 밖, 명시)

혼동 방지를 위해 못박는다. 아래를 구현하려면 **새 ADR이 필요하다**.

1. **데이터 마이그레이션/동기화 없음** — shrimp365의 `farms`/`tanks`/`journal_entries`/
   `water_quality_readings`/`production_cycles`를 culiver로 옮기거나 읽지 않는다.
2. **결제·구독 연동 없음** — `profiles.plan`(free/basic/pro/enterprise, `stripe_*`)과
   `organizations.plan`(START/PRO/ENTERPRISE)은 서로를 모른다. 두 값이 다른 것은 정상이다.
3. **SSO 자동 로그인 없음** — 세션은 도메인별로 분리된다. culiver에서 한 번 더 로그인한다.
4. **Naver 소셜 버튼 없음** — 매직링크로 우회(ADR 0006 2절).
5. **culiver 셀프서비스 회원가입 없음** — 초대 기반 유지(ADR 0006 4절).
6. **shrimp365 인증/스키마/결제 코드 변경 없음** — FED-5의 UI 순수 추가가 전부다.

## 3. 통합 QA 시나리오 (`qa-reviewer`)

수동/E2E로 확인할 사용자 여정. `AUTH_MODE=supabase` + 실제 공유 프로젝트 연결 후 수행.

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | shrimp365 이메일 가입자(초대됨)가 culiver에서 이메일+비밀번호 로그인 | 대시보드 진입, `users.supabase_user_id`가 lazy-link로 채워짐 + audit `action='link'` |
| 2 | shrimp365 Google 가입자(초대됨)가 Google 버튼으로 로그인 | 동일하게 진입(email 클레임 존재 → lazy-link 성공) |
| 3 | shrimp365 Kakao 가입자(email 없음, **미초대**) | 403 → `NotInvitedPage` + "이메일이 제공되지 않는 경우…" 안내 노출 |
| 4 | 위 사용자를 owner가 **UID 선연계 초대** 후 재로그인 | 대시보드 진입(_lazy_link 미경유) |
| 5 | 초대 없는 임의 shrimp365 사용자 | 403 → `NotInvitedPage`, **어떤 org 데이터도 보이지 않음** |
| 6 | `NotInvitedPage`에서 로그아웃 후 다른 계정 로그인 | 갇히지 않고 정상 전환 |
| 7 | culiver 로그인 상태에서 shrimp365 방문 | **자동 로그인되지 않음**(세션 비공유 — 기대된 동작) |
| 8 | shrimp365 홈페이지에서 진입 버튼 클릭 | 새 탭으로 culiver `/login` 도달, shrimp365 세션 유지 |
| 9 | `NEXT_PUBLIC_MRV_PLATFORM_URL` 미설정 상태로 shrimp365 배포 | 화면 변화 0 |
| 10 | **멀티테넌시 누수 회귀**(Hard Rule 4) | org A 계정으로 org B 리소스 접근 시 404/403 — 기존 누수 테스트 전부 green |

## 4. 위임 제안 (오케스트레이터용)

| 슬라이스 | 담당 | 선행 | 비고 |
|---|---|---|---|
| FED-0 | **사용자/운영진** | — | ADR 0006 7절. **JWT Secret 방식 확인이 최우선** |
| FED-1 | `backend-engineer` | — | 마이그레이션 없음. 기존 문구 회귀 금지가 핵심 |
| FED-2 | `frontend-engineer` | — | `shouldCreateUser: false` 필수 |
| FED-3 | `frontend-engineer` | FED-1 | `RequireAuth` 한 곳만 수정 |
| FED-4 | `frontend-engineer` | — | 삭제 금지 가드 |
| FED-5 | `frontend-engineer` | — | **다른 저장소**. 순수 추가, diff 최소화 |
| FED-6 | `backend-engineer` | — | 문서/설정만 |
| 통합 검증 | `qa-reviewer` | 전체 | 3절 시나리오 + 누수 테스트 |

- `data-kpi-engineer` **관여 없음**: 본 작업은 KPI/MRV 산식에 어떤 영향도 주지 않는다
  (CLAUDE Rule 1 범위 밖). `/packages/kpi` 변경 0건이어야 한다.
- `ui-ux-designer`: FED-5의 시각적 위계(브랜드색 규칙)에 대한 선택적 자문. 파일럿 일정상
  필수 게이트로 두지 않는다.
