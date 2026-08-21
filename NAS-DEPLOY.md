# Shrimp365 NAS 배포 가이드

## 사전 준비

### 필요한 것
- Windows: **PowerShell** 또는 **cmd** (Windows 10 이상에서 SSH 기본 내장)
- NAS IP 주소 (예: `192.168.0.100`)
- NAS 관리자 계정 (`culiver_admin`)
- GitHub PAT (Personal Access Token) — 최초 클론 시 1회 필요

---

## 1. NAS 접속

```
ssh culiver_admin@192.168.0.100
```

> NAS IP가 기억나지 않으면 Synology DSM 관리자 화면 우측 상단에서 확인

비밀번호 입력 후 접속됩니다.

---

## 2. 최초 1회 — 코드 클론

```bash
cd /volume1/docker/shrimp365

git clone -b claude/shrimp-water-quality-monitoring-aZ4EY \
  https://ulrim:ghp_여기에PAT붙여넣기@github.com/ulrim/shrimp365.git shrimp365

cd shrimp365

# .env.local 파일 복사 (상위 폴더에 있는 경우)
cp /volume1/docker/shrimp365/.env.local .env.local
```

### PAT 발급 방법
1. github.com → 프로필 → Settings
2. Developer settings → Personal access tokens → Tokens (classic)
3. Generate new token → **repo** 체크 → 생성
4. `ghp_` 로 시작하는 토큰 복사

---

## 3. 최초 1회 — 도커 이미지 빌드 및 실행

```bash
cd /volume1/docker/shrimp365/shrimp365

# 이미지 빌드 (5~10분 소요)
sudo docker compose build --no-cache

# 컨테이너 실행
sudo docker compose up -d

# 실행 확인
sudo docker logs shrimp365 --tail 20
```

`✓ Ready` 메시지 확인 후 브라우저에서 `http://NAS_IP:3000` 접속

---

## 4. 업데이트 배포 (코드 변경 후)

```bash
# NAS SSH 접속
ssh culiver_admin@192.168.0.100

# 프로젝트 폴더로 이동
cd /volume1/docker/shrimp365/shrimp365

# 최신 코드 받기
git pull origin claude/shrimp-water-quality-monitoring-aZ4EY

# 이미지 재빌드
sudo docker compose build --no-cache

# 컨테이너 재시작
sudo docker compose up -d

# 정상 작동 확인
sudo docker logs shrimp365 --tail 20
```

---

## 5. 자주 쓰는 명령어

| 상황 | 명령어 |
|------|--------|
| 컨테이너 상태 확인 | `sudo docker ps` |
| 실시간 로그 보기 | `sudo docker logs shrimp365 -f` |
| 컨테이너 재시작 | `sudo docker compose restart` |
| 컨테이너 중지 | `sudo docker compose down` |
| 컨테이너 시작 | `sudo docker compose up -d` |
| 디스크 정리 | `sudo docker system prune -f` |

---

## 6. 문제 해결

### 포트 3000 접속 안 될 때
```bash
sudo docker ps   # 컨테이너가 Up 상태인지 확인
sudo docker logs shrimp365 --tail 50   # 에러 메시지 확인
```

### "already in use" 에러
```bash
sudo docker rm -f shrimp365
sudo docker compose up -d
```

### 빌드 중 npm 에러
```bash
# package-lock.json 충돌 시
rm package-lock.json
npm install --legacy-peer-deps
sudo docker compose build --no-cache
```

### git pull 비밀번호 요청 시
PAT가 만료된 경우 — 새 PAT 발급 후:
```bash
git remote set-url origin https://ulrim:ghp_새PAT@github.com/ulrim/shrimp365.git
git pull origin claude/shrimp-water-quality-monitoring-aZ4EY
```

---

## 7. 환경변수 (.env.local)

위치: `/volume1/docker/shrimp365/shrimp365/.env.local`

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# 사이트 URL
NEXT_PUBLIC_SITE_URL=https://www.shrimp365.kr

# OpenAI (선택 — AI_BASE_URL 미설정 시 대안)
OPENAI_API_KEY=sk-...

# AI 어드바이저 오픈모델 (선택 — 9절 참조. 설정 시 OPENAI_API_KEY 보다 우선)
AI_BASE_URL=http://ollama:11434/v1
AI_MODEL=qwen3:4b-instruct-2507-q4_K_M

# DODO Payments
DODO_PAYMENTS_API_KEY=...
DODO_WEBHOOK_SECRET=...
DODO_PAYMENTS_ENVIRONMENT=live_mode
```

> `.env.local` 수정 후에는 반드시 `sudo docker compose build --no-cache` + `up -d` 재실행

---

## 8. 테스트 계정

| 이메일 | 용도 |
|--------|------|
| `admin@shrimp365.com` | 전체 기능 시연 (샘플 데이터) |
| `operator@shrimp365.com` | 운영자 시연 |

> Supabase → Authentication → Users 에서 생성 필요 (Auto Confirm User 체크)

---

## 9. AI 어드바이저 — 오픈모델(Ollama) 켜기

> 현재 운영 배포가 Vercel이면 이 섹션은 해당 없음 — Vercel에서는 .env에 Groq/OpenRouter 등
> 호스팅 API를 지정한다(`.env.example` 참조). 아래는 NAS 도커로 돌릴 때의 선택 구성이다.

AI 어드바이저를 외부 유료 API 없이 NAS에서 직접 추론한다. 옵트인 방식이라
켜지 않으면 기존 배포에 아무 영향이 없다.

### ① Ollama 컨테이너 기동

```bash
cd /volume1/docker/shrimp365/shrimp365
sudo docker compose --profile ai up -d
```

`--profile ai` 를 붙여야 `ollama` 서비스가 뜬다. 평소 `docker compose up -d` 에는 뜨지 않는다.

### ② 모델 내려받기 (최초 1회, 약 2.5GB)

```bash
sudo docker exec -it ollama ollama pull qwen3:4b-instruct-2507-q4_K_M
```

모델은 도커 볼륨(`ollama-models`)에 저장되어 재기동해도 유지된다.

### ③ 환경변수 연결

`.env.local` 에 추가:

```
AI_BASE_URL=http://ollama:11434/v1
AI_MODEL=qwen3:4b-instruct-2507-q4_K_M
```

이후 재빌드·재기동:

```bash
sudo docker compose build --no-cache
sudo docker compose --profile ai up -d
```

### ④ 주의 — 램·속도

- **램**: 모델 + KV 캐시 약 4GB. **8GB NAS면 빠듯하고 16GB 권장.** 다른 컨테이너와
  경합하면 스왑으로 더 느려진다.
- **속도**: CPU 추론 3~8 tok/s 수준(기종 의존 추정치 — **배포 후 실측 1회 권장**,
  추천 질문 하나로 체감 확인). 너무 느리면 `gemma3:1b` 로 다운그레이드 가능:
  `sudo docker exec -it ollama ollama pull gemma3:1b` 후 `.env.local` 의 `AI_MODEL=gemma3:1b`.

### ⑤ 안 켜면?

Ollama 를 켜지 않거나(모델 미pull 포함) 중간에 꺼져도 AI 어드바이저는 죽지 않는다 —
기존처럼 규칙 기반 답변으로 자동 폴백된다.
