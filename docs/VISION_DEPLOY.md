# 개체수 모니터링(카메라 비전) 배포

ShrimpVision 을 shrimp365 에 통합한 결과물입니다.
원본: [Ulrim/shrimp-vision](https://github.com/Ulrim/shrimp-vision) (`claude/trusting-cannon-uyvar9`)

---

## 1. 무엇이 어디에 있나

| 구성 | 위치 | 설명 |
|---|---|---|
| 추론 서비스 | `vision/` | Python·FastAPI. YOLOv8 + ByteTrack, 카메라 스트림, 경보 판정 |
| DB 스키마 | `supabase/migrations/vision_monitoring.sql` | `vision_cameras` · `count_records` · `vision_alert_configs` + 집계 함수 |
| 웹 API | `app/api/vision/*` | 로그인 확인 → 소유 확인 → 비전 서비스 중계 |
| 화면 | `app/(dashboard)/vision`, `components/vision/*` | 개요·실시간·이력·통합 분석·설정 |
| 데이터 계층 | `lib/vision.ts` | 읽기는 Supabase 직결, 쓰기·제어는 `/api/vision` |
| 서명 토큰 | `lib/vision-token.ts` ↔ `vision/app/core/security.py` | **짝을 이룹니다. 한쪽만 고치면 영상이 막힙니다.** |

## 2. 왜 백엔드를 따로 두었나

YOLO 추론과 영상 처리는 `ultralytics`·`opencv` 에 기대고, 이 둘은 Python
전용입니다. TypeScript 로 옮길 수 없으므로 **추론만 분리**하고 나머지는 전부
shrimp365 것을 씁니다 — 로그인은 Supabase Auth 하나, 양식장·수조는 `farms`·
`tanks` 하나, 알림은 `alerts` 하나입니다. 사용자에게는 한 플랫폼입니다.

개체수(`count_records`)와 수질(`water_quality_readings`)이 **같은 Supabase**에
쌓이므로 통합 분석이 조인 한 번으로 끝납니다.

## 3. 설치 순서

### 3-1. DB 마이그레이션 (사람이 실행)

Supabase Dashboard → SQL Editor 에서 실행합니다.

```
supabase/migrations/vision_monitoring.sql
```

> 이 저장소에는 service_role 키가 없으므로 에이전트가 실행할 수 없습니다.

### 3-2. 환경변수

`.env.local` 에 다음을 채웁니다(설명은 `.env.example` 참고).

```bash
# 두 값 모두 openssl rand -hex 32 로 만들고, 웹과 비전이 같은 값을 봐야 합니다.
VISION_SERVICE_KEY=...
VISION_STREAM_SECRET=...

# Supabase Postgres — 드라이버만 asyncpg 로 바꿉니다.
DATABASE_URL=postgresql+asyncpg://postgres.xxxx:비밀번호@aws-0-...pooler.supabase.com:5432/postgres
```

### 3-3. 컨테이너 기동

```bash
docker compose --profile vision up -d --build
```

`vision` 은 프로필로 감싸 두었습니다 — 카메라를 안 쓰는 농장에서는 뜨지
않습니다(CPU 추론이 무겁습니다).

### 3-4. 리버스 프록시 (실시간 연결)

영상(MJPEG)은 웹 컨테이너가 중계하므로 프록시 설정이 필요 없습니다.
**WebSocket 만** 따로 넘겨야 합니다 — Next.js 라우트 핸들러는 프로토콜
업그레이드를 처리하지 못하기 때문입니다.

```nginx
# 실시간 개체수 이벤트. 서명 토큰(?token=)이 자격 증명이므로
# 이 경로에 별도 인증을 걸지 않습니다.
location /vision-ws/ {
    proxy_pass http://vision:8000/ws/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host       $host;

    # 개체수는 1초에 한 번 오지만 카메라가 멈추면 조용해진다.
    # 기본 60초로는 정상 연결이 끊겨 화면이 계속 재접속한다.
    proxy_read_timeout  3600s;
    proxy_send_timeout  3600s;
}
```

`NEXT_PUBLIC_VISION_WS_PATH` 의 기본값이 `/vision-ws` 입니다. 다른 경로를 쓰면
두 곳을 함께 바꾸세요.

> **비전 서비스를 인터넷에 직접 노출하지 마세요.** 서비스 키를 가진 쪽은 모든
> 수조를 볼 수 있습니다. `docker-compose.yml` 이 포트를 호스트에 열지 않는 이유입니다.

## 4. 모델이 없어도 됩니다 — 시뮬레이션 모드

학습된 YOLO 가중치가 아직 없습니다. `MODEL_PATH` 에 파일이 없으면 **자동으로
시뮬레이션 모드**가 켜져, 카메라도 모델도 없이 전체 기능(영상·탐지 박스·개체수·
경보·통합 분석)이 그대로 돕니다. 시연과 개발은 이 모드로 합니다.

학습이 끝나면 가중치를 `vision-models` 볼륨에 넣고 컨테이너를 다시 띄우면
그대로 실제 추론으로 넘어갑니다. 코드 변경은 없습니다.

```bash
docker cp shrimp_yolov8n.pt shrimp365-vision:/app/ai/models/
docker compose --profile vision restart vision
```

학습·프레임 추출 CLI 는 `vision/ai/trainer/` 에 있습니다.

## 5. 인증이 어떻게 도는가

```
브라우저 ──(Supabase 세션 쿠키)──▶ Next.js /api/vision/*
                                      │ ① 로그인 확인
                                      │ ② RLS 로 카메라 소유 확인
                                      ▼
                             ──(X-Vision-Key)──▶ 비전 서비스
```

영상과 실시간 연결은 헤더를 실을 수 없어 따로 다룹니다.

- **MJPEG** — 같은 출처라 `<img>` 가 쿠키를 보냅니다. 웹이 중계하며 세션으로 판정합니다.
- **WebSocket** — 브라우저가 비전 서비스에 직접 붙습니다. `/api/vision/session` 이
  "이 사용자가 가진 카메라 id 목록"을 3분짜리 HMAC 서명으로 발급하고, 비전
  서비스가 그 집합을 벗어난 구독을 잘라 냅니다.

## 6. 경보가 어디로 가나

개체수 경보는 **shrimp365 알림함(`alerts`)에 그대로 적힙니다.** 수질 경보와
같은 표라 헤더 알림·웹푸시·관제센터가 종류를 가리지 않고 다룹니다.

복합 경보 — 개체수 급감과 용존산소 급락이 같은 시간대에 겹치면 두 건이 아니라
**긴급 한 건**으로 올립니다(`shrimp_count_do_critical`). 개체수만 줄면 먹이
시간이나 구석에 몰린 것일 수 있지만, 산소가 같이 떨어졌다면 폐사가 진행 중일
가능성이 높습니다. 두 데이터가 한 DB 에 모였기에 가능해진 판정입니다.

## 7. 확인 체크리스트

- [ ] shrimp365 계정으로 로그인 → `/vision` 접근 (별도 로그인 없음)
- [ ] `/farms` 에서 등록한 수조가 카메라 추가 목록에 그대로 나온다
- [ ] 카메라 시작 → 실시간 탭에 영상 + 탐지 박스 + 개체수가 뜬다
- [ ] 개체수 급감 경보 발생 → 헤더 알림함과 휴대폰 푸시에 뜬다
- [ ] 통합 분석 탭에서 개체수와 용존산소가 한 차트에 겹쳐 보인다
- [ ] 리포트 페이지에 개체수 항목이 포함된다
- [ ] 위 전체가 카메라·모델 없이 시뮬레이션 모드에서 동작한다

## 8. 문제가 생기면

| 증상 | 확인할 것 |
|---|---|
| 화면이 "실시간 꺼짐" | `VISION_SERVICE_KEY` 미설정, 또는 등록된 카메라 없음 |
| 영상 자리가 "연결할 수 없습니다" | 카메라를 시작했는지(설정 탭), `docker compose logs vision` |
| 실시간만 계속 재접속 | 프록시 `/vision-ws` 설정, `VISION_STREAM_SECRET` 이 양쪽 같은 값인지 |
| 개체수가 안 쌓임 | `DATABASE_URL` 이 asyncpg 인지, 마이그레이션을 실행했는지 |
| 경보가 안 옴 | 설정 탭에서 경보를 만들었는지(기본값 없음) |
