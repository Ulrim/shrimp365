# AI 어드바이저 오픈웨이트 모델 전환 설계서 — 외부 유료 API 의존 제거

- 작성: 민준 (PM·아키텍트)
- 작성일: 2026-08-21
- 상태: 설계 확정 → 수아(채팅 UI) → 서연(API·compose·배포 문서) → 태양(검증)

**개정 이력**

- 2026-08-21 초판 — 모델 선정(지훈 리서치 완료)·아키텍처·UI·운영 한계 확정.

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

### 절대 원칙

- **기존 OpenAI 경로는 호환 유지한다.** `OPENAI_API_KEY`만 설정된 배포는 지금과
  똑같이 동작해야 한다. 회귀 0.
- **새 npm 의존성 0.** 기존 `openai` SDK에 `baseURL`만 지정하면 OpenAI 호환
  로컬 서버(Ollama/vLLM/LM Studio)에 그대로 붙는다.
- **폴백은 언제나 살아 있다.** 로컬 서버도 키도 없거나 호출이 실패하면 규칙 기반
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

## 3. 모델 선정 (지훈 리서치 결과 — 확정)

### 3-1. 채택: `qwen3:4b-instruct-2507-q4_K_M`

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

### 3-4. 서빙: Ollama

- `ollama/ollama` 도커 이미지의 **OpenAI 호환 엔드포인트(`/v1`)** 를 쓴다.
  기존 `openai` SDK가 `baseURL`만 바꿔 그대로 붙는다 — 1장 원칙(새 의존성 0)의 근거.
- NAS `docker-compose.yml`에 서비스 추가(6장). GPU 없이 **CPU 추론** —
  Synology급에서 **3~8 tok/s 예상이며 실측이 필요하다**(7장).

## 4. 아키텍처 — 서버 (`app/api/ai-advisor/route.ts`)

### 4-1. 백엔드 우선순위 체인

```
AI_BASE_URL 설정됨   →  OpenAI 호환 로컬 서버 (Ollama/vLLM/LM Studio)
  └ 없으면 OPENAI_API_KEY  →  OpenAI (기존 경로, 호환 유지)
      └ 둘 다 없음 · 호출 실패  →  규칙 기반 답변 (기존 buildAnswer)
```

새 환경변수 3개 (`.env.example`에 추가):

| 변수 | 의미 | 기본값 |
|---|---|---|
| `AI_BASE_URL` | OpenAI 호환 서버 주소. 설정 시 최우선 (예: `http://ollama:11434/v1`) | 없음 |
| `AI_MODEL` | 모델 이름 | `qwen3:4b-instruct-2507-q4_K_M` |
| `AI_API_KEY` | 로컬 서버용 키. Ollama는 검증하지 않지만 SDK가 값을 요구 | 더미 `"ollama"` |

- `AI_BASE_URL`이 있으면 `new OpenAI({ baseURL: AI_BASE_URL, apiKey: AI_API_KEY })`,
  없고 `OPENAI_API_KEY`가 있으면 지금처럼 `new OpenAI({ apiKey })` + `gpt-4o-mini`.
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

응답 규약:

| 상황 | 응답 |
|---|---|
| 인증 실패 / 레이트리밋 / 질문 없음 | 기존 그대로 JSON 401 / 429 / 400 (스트림 시작 전이므로 유지 가능) |
| 정상 | `200`, `Content-Type: text/plain; charset=utf-8`, 본문 = 답변 텍스트 스트림 |
| 규칙 기반 폴백 | **같은 규약** — 고정 답변을 통째로 한 청크로 스트림. UI 처리 경로가 하나로 유지된다 |
| 첫 토큰 수신 전 모델 호출 실패 | 규칙 기반 답변으로 폴백해 스트림 (1장 원칙) |
| 스트림 도중 끊김 | 그대로 종료 — 그때까지의 텍스트는 UI에 남는다. 재질문은 사용자 몫 |

- `openai` SDK의 `stream: true`가 반환하는 async iterator를 `ReadableStream`으로
  변환한다(route.md 404행 패턴 그대로).
- 기존 `{ answer, remaining }` JSON 규약은 폐기한다. 이 API를 부르는 UI가 아직
  없으므로(1장) **규약 변경의 영향 범위는 0이다.**

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

## 6. docker-compose — `ollama` 서비스 추가

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
- 모델은 **최초 1회 pull이 필요하다** (사람 몫, 8-D):

  ```
  sudo docker exec -it ollama ollama pull qwen3:4b-instruct-2507-q4_K_M
  ```

## 7. 운영·한계 — 반드시 알고 배포할 것

1. **램**: 모델 + KV 캐시 약 4GB. **NAS 램 8GB면 빠듯하고 16GB 권장.**
   8GB에서 다른 컨테이너와 경합하면 스왑으로 추론이 더 느려진다.
2. **속도**: CPU 추론 3~8 tok/s 예상은 기종 의존 추정치다 — **배포 후 실측 1회
   필요.** 너무 느리면 (a) `max_tokens` 축소, (b) `gemma3:1b` 다운그레이드 순으로
   대응한다.
3. **외부 호스팅 비호환**: Vercel 등에서는 NAS 내부 Ollama에 접근할 수 없다.
   `AI_BASE_URL`은 **같은 도커 네트워크(NAS 배포)에서만 유효**하다. 외부 호스팅
   배포는 기존 `OPENAI_API_KEY` 경로 또는 규칙 기반 폴백으로 동작한다 —
   4-1 체인이 이 경우를 그대로 흡수한다.
4. **최초 pull**: 6장의 pull 명령을 실행하기 전에는 Ollama가 모델을 모른다.
   이때 API 호출은 실패하고 규칙 기반 폴백이 나간다(사용자에게 500은 없다).

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
2. `.env.example` — `AI_BASE_URL`/`AI_MODEL`/`AI_API_KEY` 3줄 추가
   (기존 `OPENAI_API_KEY` 블록 아래, 우선순위 설명 주석 포함).
3. `docker-compose.yml` — 6장 그대로. **기존 `shrimp365` 서비스는 한 줄도
   건드리지 않는다.**
4. 배포 문서 — NAS 기동 절차(`--profile ai`, `.env.local` 설정, 모델 pull,
   실측 방법)를 `docs/` 아래 배포 문서에 추가. 없으면 `docs/deploy-ai.md` 신규.

**하지 말 것**

- 새 npm 의존성 추가 금지 (AI SDK 포함 — 4-2에서 기각).
- `buildAnswer` 이하 규칙 기반 답변 함수 수정·삭제 금지 — 폴백은 마지막 안전망이다.
- `shrimp365` 서비스에 `depends_on: ollama` 금지 (6장).
- Ollama 포트를 호스트에 노출하지 말 것.
- `AGRI_HIDDEN`에서 `/ai-advisor` 제거 금지 — 농업 모드 메뉴 구성은 별건이다.

### 8-D. 태양 (`taeyang-reviewer`) — 검증

1. **호환 3경로 전부**: (a) `AI_BASE_URL`만 → 로컬 모델 답변, (b) `OPENAI_API_KEY`만
   → 기존과 동일 동작, (c) 둘 다 없음 → 규칙 기반 답변. 셋 다 UI에 정상 표시.
2. 스트리밍: 첫 토큰이 완성 전에 도착하는지(네트워크 탭), 도중 끊겨도 UI가
   깨지지 않는지.
3. Ollama 미기동·모델 미pull 상태에서 폴백이 나가는지(500 금지).
4. 401/429/400이 기존과 동일한지, 분당 20회 상한이 사는지.
5. 4개 언어 화면에서 `aiAdvisor` 문안이 전부 채워지는지(빈 키 없음).
6. `/daumlabs/*`에서 AI 어드바이저가 여전히 메뉴에 없는지(회귀 확인).
7. `docker compose config`로 프로필 미지정 시 `ollama`가 뜨지 않는지.
8. `npm run build` 통과. 시크릿(`AI_API_KEY` 더미 포함)이 클라이언트 번들에
   섞이지 않는지(`NEXT_PUBLIC_` 아님 확인).

### 8-E. 민준 — 완료 보고 (사람 몫 안내 포함)

- NAS에서 `docker compose --profile ai up -d` → 모델 pull(6장 명령) →
  `.env.local`에 `AI_BASE_URL=http://ollama:11434/v1` 추가 → 웹 컨테이너 재기동.
- **속도 실측 1회** — 추천 질문 하나로 체감 확인. 느리면 7-2 순서로 대응.
- 램 8GB NAS면 증설(16GB) 검토.
- 외부 호스팅(Vercel 등) 배포본은 이 변경으로 달라지지 않는다 — 기존 키 경로
  또는 폴백 그대로.

## 9. 범위 밖 (로드맵)

- 대화 이력 저장(현재는 요청 단위 단발 — 멀티턴 히스토리 동봉은 컨텍스트 예산
  설계가 필요)
- 일 단위 사용량 한도·플랜 연동(`remaining` 키의 원래 용도)
- 농업 모드용 어드바이저(`/daumlabs` — 시스템 프롬프트가 수경재배용으로 달라야 함)
- 임베딩 기반 자사 문서 검색(RAG) — 도움말·게시판 콘텐츠 활용
- GPU 추론(NAS 외 별도 장비) 검토 — qwen3:8b 이상 상시 운용 시
