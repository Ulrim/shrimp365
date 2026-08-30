# AI 어드바이저 오픈웨이트 모델 전환 설계서 — 외부 유료 API 의존 제거

- 작성: 민준 (PM·아키텍트)
- 작성일: 2026-08-21
- 상태: 설계 확정(개정 2 반영) — 1차분 구현·검수 완료(태양, 치명 0건),
  개정 2 자동 전환 체인 구현·검증 완료

**개정 이력**

- 2026-08-21 초판 — 모델 선정(지훈 리서치 완료)·아키텍처·UI·운영 한계 확정.
- 2026-08-21 **개정 1** — 실제 운영 배포가 **NAS 도커가 아니라 Vercel**로
  확인됨. Vercel 서버리스는 NAS 내부 Ollama에 접근할 수 없으므로 **운영 권장
  백엔드를 호스팅 오픈모델 API(1순위 Groq, 2순위 OpenRouter)로 변경**. 코드
  구조(`AI_BASE_URL`/`AI_MODEL`/`AI_API_KEY`, OpenAI 호환)는 백엔드 중립이라
  **변경 없이 유효** — 3장(운영 백엔드 3-5 신설)·4장(Vercel 스트리밍 주석)·
  6장(Ollama는 옵트인 유지)·7장(호스팅 항목)·8-E(사람 몫)를 개정, 나머지는 유지.
- 2026-08-21 **개정 2 (이 문서)** — 사용자 질문 "Groq를 사용하다가 한도를 다
  사용하면 NAS로 전환 가능한가"에서 출발. 수동 전환(환경변수 교체·재배포)은
  비실용적이므로 **같은 요청 안에서 자동 전환하는 체인**으로 확정 — 모델 백엔드
  3단(1차 `AI_BASE_URL` → 2차 `AI_FALLBACK_BASE_URL`(선택) → `OPENAI_API_KEY`
  (있으면)) + 최종 규칙 기반 답변. 1장(개정 2 배경)·3-5(참고 항목 정정)·
  3-6(2차 백엔드 권장 구성 신설)·4-1(자동 전환 체인·환경변수 3개 추가)·
  4-2(스트리밍 전환 정책, JSON 규약 정정 — 태양 제안)·8-C(구현 항목)·
  8-D(1차분 검수 결과 기록·2차 검증 항목)·8-E(사람 몫)를 개정, 나머지는 유지.

## 1. 배경과 요구

사용자 요구:

> "AI 모델을 꼭 API로 써야 하나? GitHub에 공개된 좋은 AI 모델을 적용해달라."

즉 **외부 유료 API(OpenAI) 의존에서 벗어나, 공개 오픈웨이트 모델을 셀프호스팅**으로
돌린다. 비용이 계정당 호출량에 비례해서 새는 구조를 끊고, NAS 한 대에서 추론까지
자급하는 것이 목표다.

### 현재 상태 (`app/api/ai-advisor/route.ts`)

- `OPENAI_API_KEY`가 있으면 `gpt-4o-mini` 호출(54~57행, `callGPT`),
  없으면 규칙 기반 고정 답변(`buildAnswer`, 102행~ — 키워드 매칭 12종).
- 인증(Supabase 세션)·사용자당 분당 20회 상한(`aiRateOk`)·질문 500자·컨텍스트
  2,000자 제한·`max_tokens: 800`은 이미 갖춰져 있다.
- **화면(`/ai-advisor`)은 "준비중" 플레이스홀더다** — `app/(dashboard)/ai-advisor/page.tsx`는
  뱃지와 홈 버튼뿐이고, **API를 호출하는 UI가 없다.** 사이드바(`components/layout/sidebar.tsx`
  59행)·하단네비(`components/layout/bottom-nav.tsx` 50행)에도 "준비중" 뱃지가 붙어 있다.

### 개정 1 배경 — 운영 배포는 Vercel이다

- 초판은 NAS 도커 배포를 전제로 "NAS 한 대 자급"을 목표로 삼았으나, **실제 운영
  배포는 Vercel로 확인됐다.** Vercel 서버리스 함수는 NAS 내부 네트워크의 Ollama에
  접근할 수 없다 — 초판의 운영 시나리오(6장 compose + `http://ollama:11434/v1`)는
  **운영에서는 성립하지 않는다.**
- 다행히 4-1의 백엔드 체인은 **백엔드 중립**이다. `AI_BASE_URL`은 OpenAI 호환이면
  로컬 서버든 호스팅 API든 가리지 않는다. 따라서 **코드는 한 줄도 바꾸지 않고**,
  운영 환경변수만 오픈웨이트 모델을 서빙하는 무료 호스팅 API(3-5)로 향하게 한다.
  "외부 유료 API 의존 제거"라는 원래 요구는 **무료 티어 + 오픈웨이트 모델**로
  충족한다.
- Ollama/NAS 구성(3-1~3-4, 6장)은 폐기하지 않는다 — **NAS/로컬 배포 시 선택
  사용**하는 옵트인 구성으로 유지한다.

### 개정 2 배경 — 한도 소진 시 자동 전환 (사용자 요청)

- 사용자 질문: **"Groq를 사용하다가 한도를 다 사용하면 NAS로 전환 가능한가."**
- 수동 전환은 가능하다 — Vercel 환경변수(`AI_BASE_URL` 등)를 바꾸고 재배포하면
  된다. 그러나 한도 소진을 사람이 감지해서 손으로 바꿔야 하므로 **비실용적이다.**
- 따라서 **같은 요청 안에서 자동 전환하는 체인**으로 확정한다: 모델 백엔드 3단
  (① 1차 `AI_BASE_URL` → ② 2차 `AI_FALLBACK_BASE_URL`(선택) → ③ `OPENAI_API_KEY`
  (있으면)) + ④ 최종 규칙 기반 답변. 앞 단계가 **429(한도 소진)·연결 실패·
  타임아웃**으로 던지면 다음 단계로 넘어간다. 상세는 4-1, 스트리밍과의 경계는
  4-2, 2차 백엔드 권장 구성은 3-6.

### 절대 원칙

- **기존 OpenAI 경로는 호환 유지한다.** `OPENAI_API_KEY`만 설정된 배포는 지금과
  똑같이 동작해야 한다. 회귀 0.
- **새 npm 의존성 0.** 기존 `openai` SDK에 `baseURL`만 지정하면 OpenAI 호환
  서버(Groq/OpenRouter/Ollama/vLLM/LM Studio)에 그대로 붙는다.
- **폴백은 언제나 살아 있다.** 백엔드도 키도 없거나 호출이 실패하면 규칙 기반
  답변으로 내려간다. AI 어드바이저가 500을 뱉는 상황을 만들지 않는다.

## 2. 현황 — 이미 있는 것 (재활용 자산)

| 요구 | 이미 있는 구현 | 위치 |
|---|---|---|
| 인증·레이트리밋·입력 제한 | 세션 확인, 분당 20회, 500자/2,000자 상한 | `app/api/ai-advisor/route.ts` 6~43행 |
| 시스템 프롬프트 | 흰다리새우 수질 기준값 포함 전문가 프롬프트 | 같은 파일 69~82행 |
| 규칙 기반 폴백 | 키워드 12종 매칭 고정 답변 | 같은 파일 102~378행 |
| **채팅 UI 문안 — 4개 언어 완비** | `aiAdvisor` 사전 23키: 입력 플레이스홀더, 전송/전송 중, 추천 질문 4개(`suggestQ1~4`), 현황 컨텍스트 라벨(`contextTitle/Toggle/Farm/Tank/Alert/Diagnosis`), 환영 문구 | `lib/i18n/ko.ts` 345~367행 + `en.ts`/`vi.ts`/`id.ts`/`types.ts` |
| 헤더 제목·검색 패널 항목 | `/ai-advisor` 매핑 이미 존재 | `components/layout/header.tsx` 36행, `search-panel.tsx` 41행 |
| 대시보드 바로가기 | AI 어드바이저 링크(뱃지 없음) | `components/dashboard/dashboard-view.tsx` 235행 |
| 뷰 컴포넌트 패턴 | 페이지 = 얇은 래퍼, 본문 = `components/<기능>/<이름>-view.tsx` | `docs/plans/agriculture-mode.md` 4-1 |
| 배포 컨테이너 | `docker-compose.yml` 단일 `shrimp365` 서비스, `.env.local` 주입 | `docker-compose.yml` |

**핵심 관찰**: UI 문안이 4개 언어로 이미 완성되어 있다(위 표). 화면이 "준비중"이었을 뿐
채팅 UI에 필요한 키는 전부 있다 — **i18n 신규 키 없이 화면을 만든다.**

## 3. 모델 선정 (지훈 리서치 결과)

**개정 1**: 3-1~3-4는 **NAS/로컬 셀프호스팅용**으로 유지하되, **운영(Vercel)의
기본이 아니다.** 운영 백엔드는 신설한 **3-5**를 따른다.

### 3-1. NAS/로컬 채택: `qwen3:4b-instruct-2507-q4_K_M` (운영 기본 아님 — 개정 1)

| 기준 | 값 |
|---|---|
| 라이선스 | **Apache-2.0** — 상업 사용 무제한, 고지 의무 외 제약 없음 |
| 한국어 | 119개 언어 지원(한국어 포함) |
| 크기 | **2.5GB** (q4_K_M 양자화) |
| 모드 | **instruct 전용 — thinking 모드가 없어** 별도 설정(`/no_think` 등) 불필요 |

### 3-2. 대안 (조건부)

| 모델 | 조건 | 비고 |
|---|---|---|
| `gemma3:4b` | 3.3GB | Gemma Terms — 상업 가능하나 **금지용도 정책 승계 의무**가 붙는다 |
| `qwen3:8b` | **16GB 램 NAS 한정** | 품질↑ 속도↓ |

### 3-3. 탈락과 사유

| 모델 | 탈락 사유 |
|---|---|
| LG `exaone3.5` | 한국어 최상급이나 **EXAONE License 1.1-NC — 상업 사용 금지** |
| Kakao `kanana-nano-2.1b` | CC-BY-NC-4.0 — 비상업 |
| llama 계열 | 한국어 품질 열세 |

### 3-4. 서빙: Ollama (NAS/로컬 한정)

- `ollama/ollama` 도커 이미지의 **OpenAI 호환 엔드포인트(`/v1`)** 를 쓴다.
  기존 `openai` SDK가 `baseURL`만 바꿔 그대로 붙는다 — 1장 원칙(새 의존성 0)의 근거.
- NAS `docker-compose.yml`에 서비스 추가(6장). GPU 없이 **CPU 추론** —
  Synology급에서 **3~8 tok/s 예상이며 실측이 필요하다**(7장).

### 3-5. 운영(Vercel) 백엔드 — 호스팅 오픈모델 API (개정 1 신규)

Vercel에서는 NAS Ollama에 닿을 수 없으므로, **오픈웨이트 모델을 무료로 서빙하는
호스팅 API**를 `AI_BASE_URL`에 지정한다. 코드 변경 0 — 환경변수 3개가 전부다.

**1순위: Groq**

| 항목 | 값 |
|---|---|
| `AI_BASE_URL` | `https://api.groq.com/openai/v1` |
| 비용 | **가입만으로 무료(신용카드 불필요)** |
| 무료 한도 | 모델당 하루 약 1,000요청 — **모델별로 다르다. 가입 후 console.groq.com/docs/rate-limits 실측 확인 필요** |
| 모델 1안 | `moonshotai/kimi-k2-instruct-0905` — 오픈웨이트 Kimi K2. **구버전 `kimi-k2-instruct`는 폐기 예정이므로 쓰지 않는다** |
| 모델 2안 | `llama-3.3-70b-versatile` |
| 제외 | Groq의 `qwen/qwen3-32b` — **폐기 공지되어 제외** |

**2순위: OpenRouter**

| 항목 | 값 |
|---|---|
| `AI_BASE_URL` | `https://openrouter.ai/api/v1` |
| 모델 | `:free` 접미사 모델 — 예: `deepseek/deepseek-chat-v3.1:free`, `z-ai/glm-4.5-air:free` |
| 무료 한도 | 무과금 계정 **하루 50요청** |
| 리스크 | free 모델은 예고 없이 내려갈 수 있다. 다만 **환경변수만 바꾸면 되는 구조라 리스크 낮음** |

**참고 (운영 부적합)**

- Hugging Face 라우터 — 무료 크레딧이 **월 $0.1 수준**이라 운영에 못 쓴다. 참고만.
- NAS Ollama를 Vercel에서 쓰는 경로 — Cloudflare Tunnel로 외부 노출 + Access
  보호가 필요하다. 가능은 하나 **운영 기본은 Groq**이고, **1차 백엔드로는**
  권장하지 않는다. **(개정 2)** 단, **2차(폴백) 백엔드로는 선택지로 승격** —
  3-6 (b) 참고.

### 3-6. 2차(폴백) 백엔드 권장 구성 (개정 2 신규)

4-1 자동 전환 체인의 2차(`AI_FALLBACK_*`)는 **선택**이다 — 미설정이면 체인이
그 단계를 건너뛴다. 쓴다면 다음 2안 중 하나를 고른다.

**(a) OpenRouter `:free` — 설정이 간단한 쪽**

| 항목 | 값 |
|---|---|
| `AI_FALLBACK_BASE_URL` | `https://openrouter.ai/api/v1` |
| `AI_FALLBACK_MODEL` | `:free` 모델 (3-5 2순위 표의 예시 참고) |
| 비용·한도 | 가입만으로 무료, 무과금 계정 **하루 50요청** |
| 장점 | 가입 + 환경변수 3개 등록이 전부 |
| 한계 | 하루 50요청 — 1차(Groq) 소진 후의 **완충용**으로만 본다 |

**(b) NAS Ollama + Cloudflare Tunnel 공개 주소 — 자체 장비 쪽**

| 항목 | 값 |
|---|---|
| `AI_FALLBACK_BASE_URL` | Tunnel이 발급한 공개 주소 + `/v1` |
| `AI_FALLBACK_MODEL` | `qwen3:4b-instruct-2507-q4_K_M` (3-1) |
| 비용·한도 | 자체 장비 — **호출 한도 없음** |
| 전제 | Cloudflare Tunnel **1회 설정**, **NAS 상시 가동**, 6장 Ollama 프로필 기동 |
| 보안 | **Ollama는 무인증이다 — Cloudflare Access 보호 필수.** 공개 주소를 그대로 노출하지 말 것 |
| 속도 | CPU 추론 3~8 tok/s 추정(7장) — 폴백 상황의 품질로는 감수한다 |

## 4. 아키텍처 — 서버 (`app/api/ai-advisor/route.ts`)

### 4-1. 백엔드 자동 전환 체인 (개정 2 — '우선순위 선택'에서 '요청 내 자동 전환'으로)

**(개정 2)** 초판~개정 1의 체인은 "설정된 것 중 최우선 하나를 골라 호출"이었다.
개정 2부터는 **같은 요청 안에서, 앞 단계가 실패하면 다음 단계로 자동 전환**한다.
전환 조건은 **429(한도 소진)·연결 실패·타임아웃**이다. 미설정 단계는 건너뛴다.

```
① AI_BASE_URL             1차 — 운영 기본 Groq (3-5)
   │  429 · 연결 실패 · 타임아웃
   ▼
② AI_FALLBACK_BASE_URL    2차 — 선택. 미설정 시 건너뜀 (권장 구성 3-6)
   │  429 · 연결 실패 · 타임아웃
   ▼
③ OPENAI_API_KEY          OpenAI (있으면 — 기존 경로, 호환 유지)
   │  실패
   ▼
④ 규칙 기반 답변           buildAnswer — 최종, 항상 성공
```

환경변수 — 기존 3개(초판) + **개정 2 신규 3개**. 전부 `.env.example`에 추가:

| 변수 | 의미 | 기본값 |
|---|---|---|
| `AI_BASE_URL` | 1차 OpenAI 호환 서버 주소 (운영 예: `https://api.groq.com/openai/v1`, NAS 예: `http://ollama:11434/v1`) | 없음 |
| `AI_MODEL` | 1차 모델 이름 (운영 예: `moonshotai/kimi-k2-instruct-0905`) | `qwen3:4b-instruct-2507-q4_K_M` — Ollama용 기본값이므로 **운영(Groq)에서는 반드시 명시 설정** |
| `AI_API_KEY` | 1차 백엔드 API 키. Groq/OpenRouter는 실제 키, Ollama는 검증하지 않지만 SDK가 값을 요구 | 더미 `"ollama"` |
| **(개정 2)** `AI_FALLBACK_BASE_URL` | 2차 OpenAI 호환 서버 주소. **미설정 시 2차 단계는 건너뛴다** | 없음 |
| **(개정 2)** `AI_FALLBACK_MODEL` | 2차 모델 이름 (2차 사용 시 명시) | 없음 |
| **(개정 2)** `AI_FALLBACK_API_KEY` | 2차 백엔드 API 키 (Ollama Tunnel이면 더미 허용) | 더미 `"ollama"` |

- `AI_BASE_URL`이 있으면 `new OpenAI({ baseURL: AI_BASE_URL, apiKey: AI_API_KEY })`,
  없고 `OPENAI_API_KEY`가 있으면 지금처럼 `new OpenAI({ apiKey })` + `gpt-4o-mini`.
- **(개정 1) 백엔드 중립은 유지된다** — Groq도 Ollama도 같은 변수 규약으로 붙는다.
- **(개정 2)** 개정 1까지와 달리 **route.ts 코드 변경이 필요하다**(자동 전환 루프).
  구현은 8-C 5~6 — **반영 완료**.
- 시스템 프롬프트·컨텍스트 조립·`max_tokens: 800` 상한·인증·레이트리밋은 **변경 없음**.

### 4-2. 스트리밍 응답 — CPU 추론이 느리므로 필수

CPU 추론에서 800토큰 완성까지 수 분이 걸릴 수 있다. 완성을 기다렸다 JSON으로 주면
UI가 그동안 침묵한다. **route handler가 `text/plain` `ReadableStream`을 반환하고
UI가 토큰 단위로 실시간 표시한다.**

읽은 문서(Next.js 16.2.4, `node_modules/next/dist/docs/`):

- `01-app/03-api-reference/03-file-conventions/route.md#streaming` (367행~) —
  LLM 스트리밍 패턴을 명시. AI SDK 예시와 함께 **"underlying Web APIs directly"**
  즉 `ReadableStream` + `new Response(stream)` 직접 사용을 공식 지원(401~440행).
  새 의존성 0 원칙에 따라 **AI SDK를 추가하지 않고 Web API를 직접 쓴다.**
- 같은 문서 변경 이력 — 캐싱은 v15부터 GET조차 dynamic이 기본이고 POST는 캐시
  대상이 아니다. 스트리밍 POST에 캐시 관련 설정이 필요 없다.

**(개정 1) Vercel 스트리밍 시간 제한**: Fluid compute가 기본(2025-04 이후 생성
프로젝트)이고 Hobby 기본 함수 시간이 300초라 스트리밍에 여유가 있다. 그래도
안전장치로 route에 `export const maxDuration = 60`을 명시한다 — **구현 반영됨**
(`app/api/ai-advisor/route.ts` 6행, 셀프호스팅에서는 무해).

**(개정 2) 자동 전환과 스트리밍의 경계 — 첫 토큰이 기준이다**

- **첫 토큰 수신 전 실패만 전환 대상이다.** 429·연결 실패·타임아웃이 첫 토큰
  전에 나면 4-1 체인의 다음 단계로 넘어간다 — 사용자는 전환을 눈치채지 못한다.
- **첫 토큰 이후 끊김은 전환하지 않는다.** 반토막 답변 뒤에 다른 모델의 전체
  답변이 이어 붙는 중복을 막기 위해, **안내 문구를 덧붙이고 스트림을 종료**한다.
  그때까지의 텍스트는 UI에 남고, 재질문은 사용자 몫이다.

응답 규약:

| 상황 | 응답 |
|---|---|
| 인증 실패 / 레이트리밋 / 질문 없음 | 기존 그대로 JSON 401 / 429 / 400 (스트림 시작 전이므로 유지 가능) |
| 정상 | `200`, `Content-Type: text/plain; charset=utf-8`, 본문 = 답변 텍스트 스트림 |
| 규칙 기반 폴백 | **같은 규약** — 고정 답변을 통째로 한 청크로 스트림. UI 처리 경로가 하나로 유지된다 |
| 첫 토큰 수신 전 모델 호출 실패 | **(개정 2)** 4-1 체인의 다음 단계로 자동 전환. 전 단계 실패 시 규칙 기반 답변으로 폴백해 스트림 (1장 원칙) |
| 스트림 도중 끊김 | **(개정 2)** 다른 백엔드로 재시작하지 않는다 — 안내 문구 후 종료. 그때까지의 텍스트는 UI에 남는다 |

- `openai` SDK의 `stream: true`가 반환하는 async iterator를 `ReadableStream`으로
  변환한다(route.md 404행 패턴 그대로).
- **(개정 2 정정 — 태양 제안)** 초판의 "기존 `{ answer, remaining }` JSON 규약은
  폐기한다"를 정정한다: **요청에 `stream`을 지정하지 않으면 기존 JSON 규약을
  유지한다(하위 호환)** — 구현이 이를 올바르게 유지하고 있고, 문서가 구현을
  따른다. 스트리밍 규약은 `stream` 지정 시에만 적용된다.

## 5. 화면 — `components/ai-advisor/ai-advisor-view.tsx` 신규 (수아)

`ui-ux-pro-max` 스킬 사용. 저장소 컨벤션대로 본문은 뷰 컴포넌트,
`app/(dashboard)/ai-advisor/page.tsx`는 플레이스홀더를 걷어내고 3줄 래퍼로 교체.

구성 (전부 기존 `aiAdvisor` i18n 키 재사용 — **신규 키 금지**, 4개 언어 이미 존재):

1. **채팅 말풍선** — 사용자/AI 구분, 환영 메시지(`welcomeTitle`/`welcomeMsg`),
   AI 답변은 마크다운 렌더(시스템 프롬프트가 마크다운을 요구한다).
   스트림 수신 중 토큰이 도착하는 대로 말풍선에 이어 붙인다.
2. **추천 질문 4개** — `suggestQ1~4` 버튼. 누르면 그대로 전송.
3. **양식장 현황 컨텍스트 포함 토글** — `contextToggle`. 켜면 운영 양식장·수조·
   활성 알림·최근 진단 요약(`contextFarm/Tank/Alert/Diagnosis`)을 `context`로 동봉.
   서버의 기존 파서(`운영 수조: N`, `활성 알림 N건` 정규식)와 형식을 맞출 것.
4. **입력창·전송** — `inputPlaceholder`/`send`/`sending`. 질문 500자 제한을
   클라이언트에서도 표시. 429 응답 시 안내 문구.
5. `remaining`/`remainingUnit` 키는 **사용하지 않는다** — 서버가 일 한도를 관리하지
   않는다(분당 상한뿐). 키 삭제도 하지 않는다(타입 공유).

"준비중" 제거 3곳:

- `app/(dashboard)/ai-advisor/page.tsx` — 플레이스홀더 전체 교체.
- `components/layout/sidebar.tsx` 59행 — `badge: t.common.comingSoon` 제거.
- `components/layout/bottom-nav.tsx` 50행 — 동일.

건드리지 않는 곳: `header.tsx`·`search-panel.tsx`(이미 정상 항목),
`dashboard-view.tsx` 235행(뱃지 없는 링크), 각 파일의 `AGRI_HIDDEN`
(`/ai-advisor`는 농업 모드에 없다 — `docs/plans/agriculture-mode.md` 4-3 유지).

## 6. docker-compose — `ollama` 서비스 추가 (초판 유지 — NAS/로컬 배포 시 옵트인, 운영 기본 아님)

**(개정 1) 이 장은 폐기하지 않는다.** 운영(Vercel)에서는 쓰이지 않지만,
`profiles: ["ai"]` 옵트인이라 그대로 둬도 어떤 배포에도 영향이 없고,
NAS/로컬 배포 시 선택해서 쓴다. NAS Ollama를 Vercel에서 쓰려면 Cloudflare
Tunnel + Access 보호가 필요하나(3-5 참고) **운영 기본은 Groq**이다.
**(개정 2)** 이 Tunnel 경로는 2차(폴백) 백엔드 구성 (b)로 채택 가능 — 3-6 참고.

```yaml
  # AI 어드바이저 로컬 추론 서버 — `--profile ai`로 옵트인 (기존 배포 무영향)
  ollama:
    image: ollama/ollama:latest
    container_name: ollama
    restart: unless-stopped
    profiles: ["ai"]
    volumes:
      - ollama-models:/root/.ollama   # 모델 저장 (pull 1회면 재기동에도 유지)
    environment:
      OLLAMA_KEEP_ALIVE: 24h          # 요청마다 모델 재로드(수십 초) 방지
      OLLAMA_CONTEXT_LENGTH: 8192

volumes:
  ollama-models:
```

- **`profiles: ["ai"]`** — 평소 `docker compose up`에는 뜨지 않는다. NAS에서
  `docker compose --profile ai up -d`로 옵트인. **기존 배포에 영향 0.**
- `shrimp365` 서비스에 `depends_on`을 걸지 않는다 — 프로필 미활성 시 기동이
  깨진다. 연결은 `.env.local`의 `AI_BASE_URL=http://ollama:11434/v1`
  (같은 compose 네트워크의 서비스명 접근)로만 한다.
- 포트를 호스트에 노출하지 않는다 — 웹 컨테이너만 내부 네트워크로 접근하면 된다.
- 모델은 **최초 1회 pull이 필요하다** (사람 몫, 8-E):

  ```
  sudo docker exec -it ollama ollama pull qwen3:4b-instruct-2507-q4_K_M
  ```

### 개정 3 — 모델 ID 는 검증 없이 문서에 박지 않는다 (실배포에서 확인)

Groq 배포 후 AI 가 붙지 않아 `/api/admin/ai-diag` 로 확인한 결과:

```
❌ HTTP 404 — The model `moonshotai/kimi-k2-instruct-0905` does not exist
```

주소·키·재배포는 전부 정상이었고 **모델 ID 하나가 틀렸다.** 초판 리서치가
"프록시 차단으로 Groq 공식 페이지를 직접 열지 못했고 태그명은 pull 성공으로
최종 검증할 것"이라고 불확실성을 명시했는데, 그 미검증 값을 권장값으로 문서와
`.env.example` 에 그대로 실은 것이 원인이다.

**규칙**: 모델 ID 는 제공자가 수시로 바꾸고 폐기한다. 문서에는 "예시"로만 적고,
실제 값은 `/api/admin/ai-diag` 가 그 계정에서 조회한 목록에서 고른다. 진단 창구는
404 를 만나면 `models.list()` 로 사용 가능한 목록을 뽑아 추천까지 제시한다.

## 7. 운영·한계 — 반드시 알고 배포할 것

1. **램 (NAS/로컬 한정)**: 모델 + KV 캐시 약 4GB. **NAS 램 8GB면 빠듯하고 16GB 권장.**
   8GB에서 다른 컨테이너와 경합하면 스왑으로 추론이 더 느려진다.
2. **속도 (NAS/로컬 한정)**: CPU 추론 3~8 tok/s 예상은 기종 의존 추정치다 —
   **배포 후 실측 1회 필요.** 너무 느리면 (a) `max_tokens` 축소,
   (b) `gemma3:1b` 다운그레이드 순으로 대응한다.
3. **(개정 1) 운영은 Vercel — NAS Ollama에 접근 불가**: 초판은 이 항을 "외부
   호스팅 비호환" 예외 케이스로 다뤘으나, **실제 운영이 바로 이 경우다.**
   운영에서는 `AI_BASE_URL`을 3-5의 호스팅 API(Groq)로 향하게 한다 — 4-1 체인이
   코드 변경 없이 이 경우를 그대로 흡수한다. NAS 배포에서만
   `http://ollama:11434/v1`이 유효하다.
4. **(개정 1) 무료 한도는 유동적이다**: Groq의 모델별 한도와 모델 라인업(폐기
   공지 포함)은 바뀔 수 있다. 가입 후 console.groq.com/docs/rate-limits에서
   실측 확인하고, 모델이 폐기되면 **환경변수 `AI_MODEL`만 교체**하면 된다.
   OpenRouter `:free`도 마찬가지(하루 50요청, 모델 존속 비보장).
   **(개정 2)** 한도 **소진** 시의 서비스 공백은 4-1 자동 전환 체인이 흡수한다 —
   2차 백엔드(3-6)를 등록해 두면 사람 개입 없이 이어진다.
5. **최초 pull (NAS/로컬 한정)**: 6장의 pull 명령을 실행하기 전에는 Ollama가
   모델을 모른다. 이때 API 호출은 실패하고 규칙 기반 폴백이 나간다(사용자에게
   500은 없다).

## 8. 구현 단계와 담당

### 8-A. 지훈 (`jihun-researcher`) — 완료

모델·라이선스 조사(3장). 추가 조사 없음.

### 8-B. 수아 (`sua-designer`) — 채팅 UI

1. `components/ai-advisor/ai-advisor-view.tsx` 신규 — 5장 구성.
   기존 화면 결(카드·말풍선·색)은 `ui-ux-pro-max` 스킬과 기존 컴포넌트를 따른다.
2. `app/(dashboard)/ai-advisor/page.tsx` — 3줄 래퍼로 교체(`"use client"` 없이).
3. 사이드바 59행·하단네비 50행 뱃지 제거.
4. **i18n 키 신규 추가 금지** — 부족하면 민준에게 보고(4개 언어 동시 추가가
   필요해 별도 판단).

### 8-C. 서연 (`seoyeon-dev`) — API·compose·배포 문서

1. `app/api/ai-advisor/route.ts` — 4-1 체인 + 4-2 스트리밍.
   - 인증·레이트리밋·입력 제한·시스템 프롬프트·`buildAnswer` **변경 금지.**
   - `openai` SDK `stream: true` → async iterator → `ReadableStream`
     (route.md 404행 패턴). 한국어 주석.
   - **(개정 1)** `export const maxDuration = 60` 명시(4-2).
2. `.env.example` — `AI_BASE_URL`/`AI_MODEL`/`AI_API_KEY` 3줄 추가
   (기존 `OPENAI_API_KEY` 블록 아래, 우선순위 설명 주석 포함).
   **(개정 1)** Groq·OpenRouter·Ollama 세 예시를 주석으로 병기.
3. `docker-compose.yml` — 6장 그대로. **기존 `shrimp365` 서비스는 한 줄도
   건드리지 않는다.**
4. 배포 문서 — NAS 기동 절차(`--profile ai`, `.env.local` 설정, 모델 pull,
   실측 방법)를 `docs/` 아래 배포 문서에 추가. 없으면 `docs/deploy-ai.md` 신규.
5. **(개정 2)** `app/api/ai-advisor/route.ts` — 4-1 **자동 전환 체인** 구현
   (**반영 완료**).
   - 전환 조건은 **429·연결 실패·타임아웃**뿐. **첫 토큰 이후에는 전환 금지** —
     안내 문구 후 종료(4-2).
   - `stream` 미지정 요청은 기존 `{ answer, remaining }` JSON 응답 유지
     (4-2 정정 노트 — 하위 호환).
6. **(개정 2)** 태양 1차분 검수 권고 3건 반영(결과 기록은 8-D):
   - ① 클라이언트 `AbortController` — 전송 중 이탈·재전송 시 이전 스트림 중단
     (`components/ai-advisor/ai-advisor-view.tsx`).
   - ② 서버 `ReadableStream` **`cancel` 핸들러 + `enqueue` 가드** — 닫힌
     컨트롤러에 enqueue하지 않도록.
   - ③ SDK **`timeout` 명시(백엔드당 15초 상한 + 체인 전체 45초 예산)** —
     타임아웃이 전환 트리거이므로 기본값에 맡기지 않는다. `maxRetries`는
     체인 도입으로 **0으로 확정**(8-D 정정 참고).
7. **(개정 2)** `.env.example` — `AI_FALLBACK_BASE_URL`/`AI_FALLBACK_MODEL`/
   `AI_FALLBACK_API_KEY` 3줄 추가(3-6의 (a)·(b) 예시를 주석으로 병기).

**하지 말 것**

- 새 npm 의존성 추가 금지 (AI SDK 포함 — 4-2에서 기각).
- `buildAnswer` 이하 규칙 기반 답변 함수 수정·삭제 금지 — 폴백은 마지막 안전망이다.
- `shrimp365` 서비스에 `depends_on: ollama` 금지 (6장).
- Ollama 포트를 호스트에 노출하지 말 것.
- `AGRI_HIDDEN`에서 `/ai-advisor` 제거 금지 — 농업 모드 메뉴 구성은 별건이다.

### 8-D. 태양 (`taeyang-reviewer`) — 검증

1. **호환 3경로 전부**: (a) `AI_BASE_URL`만 → 지정 백엔드 답변(호스팅 API든
   로컬 서버든 같은 경로 — 개정 1), (b) `OPENAI_API_KEY`만 → 기존과 동일 동작,
   (c) 둘 다 없음 → 규칙 기반 답변. 셋 다 UI에 정상 표시.
2. 스트리밍: 첫 토큰이 완성 전에 도착하는지(네트워크 탭), 도중 끊겨도 UI가
   깨지지 않는지.
3. 백엔드 미기동·모델 미pull(NAS) 또는 잘못된 키/모델명(호스팅) 상태에서
   폴백이 나가는지(500 금지).
4. 401/429/400이 기존과 동일한지, 분당 20회 상한이 사는지.
5. 4개 언어 화면에서 `aiAdvisor` 문안이 전부 채워지는지(빈 키 없음).
6. `/daumlabs/*`에서 AI 어드바이저가 여전히 메뉴에 없는지(회귀 확인).
7. `docker compose config`로 프로필 미지정 시 `ollama`가 뜨지 않는지.
8. `npm run build` 통과. 시크릿(`AI_API_KEY` 포함)이 클라이언트 번들에
   섞이지 않는지(`NEXT_PUBLIC_` 아님 확인).

**(개정 2) 1차분 검수 결과 기록 (2026-08-21)**

- **치명 0건 — 출고 가능.**
- 권고 3건 — 개정 2 구현(8-C 6)에 함께 반영한다:
  ① 클라이언트 `AbortController`, ② 서버 스트림 `cancel` 핸들러 + `enqueue`
  가드, ③ SDK `timeout` 명시(백엔드당 15초).
- SDK `maxRetries`: 태양은 **단일 백엔드 전제**로 기본값(2) 유지를 판단했으나,
  개정 2 체인 도입으로 **`0`으로 정정** — 다음 백엔드로의 전환이 재시도를
  대체하고, 백엔드당 15초 × 최대 3단 = **45초 < `maxDuration` 60초**가
  어떤 실패 조합에서도 보장된다(규칙 기반 폴백이 함수 수명 안에 반드시 나간다).
- 문서 정정 제안 1건(4-2 JSON 규약) — 개정 2에 반영 완료(4-2 정정 노트).

**(개정 2) 2차 검증 항목 — 자동 전환 체인 구현분**

9. 1차 실패 모의(잘못된 키 또는 429) 시 2차로 자동 전환되는지, 2차도 실패하면
   `OPENAI_API_KEY` → 규칙 기반까지 내려가는지(어느 단계에서도 500 금지).
10. 첫 토큰 이후 끊김 시 다른 백엔드로 **재시작하지 않고** 안내 문구 후
    종료하는지(중복 답변 금지 — 4-2).
11. `stream` 미지정 요청이 기존 JSON `{ answer, remaining }`을 그대로 받는지
    (하위 호환 회귀 확인).
12. 권고 3건 반영 확인 — `AbortController`, `cancel` 핸들러 + `enqueue` 가드,
    `timeout` 15초.
13. `AI_FALLBACK_API_KEY` 등 신규 시크릿이 클라이언트 번들에 섞이지 않는지.

### 8-E. 민준 — 완료 보고 (사람 몫 안내 포함, 개정 1·개정 2)

**운영(Vercel) 셋업 — 기본 경로:**

1. console.groq.com 가입(무료, 신용카드 불필요) → API 키 발급.
2. Vercel 프로젝트 환경변수에 3개 등록:
   - `AI_BASE_URL=https://api.groq.com/openai/v1`
   - `AI_MODEL=moonshotai/kimi-k2-instruct-0905` (또는 `llama-3.3-70b-versatile`)
   - `AI_API_KEY=<발급받은 키>`
3. 재배포.
4. `/ai-advisor`에서 답변 품질 확인 — **Kimi K2 vs llama-3.3 한국어 품질 비교
   권장**, 나은 쪽으로 `AI_MODEL` 확정. 가입 후 console.groq.com/docs/rate-limits
   에서 모델별 실제 한도도 확인.
5. **(개정 2, 선택)** 2차 백엔드를 쓸 경우 Vercel 환경변수에 3개 추가 등록:
   `AI_FALLBACK_BASE_URL`/`AI_FALLBACK_MODEL`/`AI_FALLBACK_API_KEY`
   (구성은 3-6의 (a) 또는 (b)). (b) NAS Tunnel을 고르면 Cloudflare Tunnel
   1회 설정과 **Access 보호 적용**도 사람 몫이다.

**NAS/로컬 배포 시(조건부):**

- `docker compose --profile ai up -d` → 모델 pull(6장 명령) →
  `.env.local`에 `AI_BASE_URL=http://ollama:11434/v1` 추가 → 웹 컨테이너 재기동.
- **속도 실측 1회** — 추천 질문 하나로 체감 확인. 느리면 7-2 순서로 대응.
- 램 8GB NAS면 증설(16GB) 검토.

## 9. 범위 밖 (로드맵)

- 대화 이력 저장(현재는 요청 단위 단발 — 멀티턴 히스토리 동봉은 컨텍스트 예산
  설계가 필요)
- 일 단위 사용량 한도·플랜 연동(`remaining` 키의 원래 용도)
- 농업 모드용 어드바이저(`/daumlabs` — 시스템 프롬프트가 수경재배용으로 달라야 함)
- 임베딩 기반 자사 문서 검색(RAG) — 도움말·게시판 콘텐츠 활용
- GPU 추론(NAS 외 별도 장비) 검토 — qwen3:8b 이상 상시 운용 시
