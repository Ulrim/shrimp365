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

## 3. 어디에 무엇을 올리나 — 배포 형태 두 가지

**비전 서비스는 상시 구동되는 호스트가 필요합니다.** 서버리스(Vercel Functions)
에는 올릴 수 없습니다 — Python 컨테이너를 돌릴 수 없을뿐더러, 영상(MJPEG)과
실시간 연결(WebSocket)이 **끝나지 않는 연결**이라 함수 실행 시간 상한에 걸려
잘립니다. 원본 설계서(§2.5 인프라 제약)가 지적한 그 지점입니다.

그래서 배포 형태가 둘로 갈립니다. `NEXT_PUBLIC_VISION_PUBLIC_URL` 하나로
결정되고, 화면 코드는 세션 응답이 알려 주는 대로 따라갑니다.

### (A) 웹은 Vercel, 비전은 별도 호스트 — **현재 shrimp365 운영 형태**

```
브라우저 ──▶ Vercel (www.shrimp365.kr)   로그인·화면·토큰 발급·제어 API
    │
    └──────▶ 비전 호스트 (vision.shrimp365.kr)   영상 + 실시간 (서명 토큰)
                    │
                    ▼  Supabase
```

브라우저가 영상과 실시간 연결을 **비전 호스트에 직접** 붙습니다. Vercel 은
로그인 확인과 3분짜리 서명 토큰 발급, 그리고 제어용 JSON API(카메라 시작·정지
등) 중계만 맡습니다 — 이건 짧은 요청이라 서버리스로 충분합니다.

비전 호스트에는 **공개 https 주소와 인증서**가 필요합니다. 웹이 https 인데
영상이 http 면 브라우저가 혼합 콘텐츠로 막습니다.

> 비전 호스트를 인터넷에 두더라도 **`/api/v1` 은 절대 열지 마세요.** 서비스
> 키를 가진 쪽은 모든 수조를 볼 수 있습니다. 프록시에서 `/stream` 과 `/ws`
> 만 열고 나머지는 막습니다(§3-3 설정 참고).

### (B) 웹과 비전을 한 호스트에 — NAS·자체 서버

```
브라우저 ──▶ 한 호스트 : 웹이 영상을 중계, 실시간만 프록시가 넘김
```

`NEXT_PUBLIC_VISION_PUBLIC_URL` 을 비우면 이 방식입니다. 영상은 같은 출처라
`<img>` 가 세션 쿠키를 실어 보내므로 토큰이 필요 없습니다.

---

## 3-1. DB 마이그레이션 (사람이 실행 — 두 형태 공통)

Supabase Dashboard → SQL Editor 에서 실행합니다.

```
supabase/migrations/vision_monitoring.sql
```

> 이 저장소에는 service_role 키가 없으므로 에이전트가 실행할 수 없습니다.

## 3-2. 환경변수

### Vercel (A) — 대시보드 → Settings → Environment Variables

| 이름 | 값 | 비고 |
|---|---|---|
| `VISION_SERVICE_KEY` | `openssl rand -hex 32` | 비전 호스트와 **같은 값** |
| `VISION_STREAM_SECRET` | `openssl rand -hex 32` | 비전 호스트와 **같은 값** |
| `VISION_SERVICE_URL` | `https://vision.shrimp365.kr` | 제어 API 호출 주소 |
| `NEXT_PUBLIC_VISION_PUBLIC_URL` | `https://vision.shrimp365.kr` | 이 값이 (A) 방식을 켭니다 |

`NEXT_PUBLIC_*` 는 빌드 시점에 번들에 박히므로, 넣은 뒤 **재배포**해야 반영됩니다.

### 비전 호스트 (A) — 그 서버의 `.env`

```bash
VISION_SERVICE_KEY=...        # Vercel 과 같은 값
VISION_STREAM_SECRET=...      # Vercel 과 같은 값
DATABASE_URL=postgresql+asyncpg://postgres.xxxx:비밀번호@aws-0-....pooler.supabase.com:5432/postgres
SHRIMP365_INTERNAL_URL=https://www.shrimp365.kr   # 경보 웹푸시를 되부를 주소
CORS_ORIGINS=https://www.shrimp365.kr
```

### 한 호스트 (B) — `.env.local` 하나에 위 값을 모두 넣고

`NEXT_PUBLIC_VISION_PUBLIC_URL` 은 **비우고**, `VISION_SERVICE_URL=http://vision:8000`,
`NEXT_PUBLIC_VISION_WS_PATH=/vision-ws` 를 씁니다.

## 3-3. 비전 서비스 기동

한 호스트(B)에서는 저장소 루트에서:

```bash
docker compose --profile vision up -d --build
```

별도 호스트(A)에서는 `vision/` 만 있으면 됩니다:

```bash
docker build -t shrimp365-vision ./vision
docker run -d --name shrimp365-vision --restart unless-stopped \
  --env-file .env -p 127.0.0.1:8000:8000 \
  -v vision-models:/app/ai/models \
  shrimp365-vision
```

`127.0.0.1` 에만 묶어 두고 앞단에 nginx 를 세웁니다.

## 3-4. 리버스 프록시

### (A) 비전 호스트의 nginx — `/stream` 과 `/ws` 만 연다

```nginx
server {
    listen 443 ssl http2;
    server_name vision.shrimp365.kr;
    # ssl_certificate ... (certbot 등으로 발급)

    # 제어 API 는 외부에 열지 않는다. 서비스 키를 가진 쪽은 모든 수조를 본다.
    location /api/ { return 404; }

    # 영상 — 끝나지 않는 multipart 응답이라 버퍼링을 끄고 타임아웃을 길게 둔다.
    location /stream/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }

    # 실시간 이벤트. 서명 토큰(?token=)이 자격 증명이다.
    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location /health { proxy_pass http://127.0.0.1:8000; }
}
```

### (B) 한 호스트의 nginx — 실시간만 넘긴다

```nginx
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

영상과 실시간 연결은 인증 헤더를 실을 수 없어 따로 다룹니다. `/api/vision/session`
이 "이 사용자가 가진 카메라 id 목록"을 담은 **3분짜리 HMAC 서명**을 발급하고,
비전 서비스가 그 집합을 벗어난 요청을 잘라 냅니다.

| | (A) 별도 호스트 | (B) 한 호스트 |
|---|---|---|
| MJPEG | 비전 호스트에 직접, `?token=` | 웹이 중계, 세션 쿠키 |
| WebSocket | 비전 호스트에 직접, `?token=` | 프록시 경유, `?token=` |

토큰이 새어 나가도 **그 사용자의 카메라만**, 3분 동안만 볼 수 있습니다.
연결은 붙는 순간에만 검사하므로, 오래 열려 있는 영상이 3분마다 끊기지는
않습니다.

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
| 영상이 몇 초 뒤 끊김 (Vercel) | `NEXT_PUBLIC_VISION_PUBLIC_URL` 미설정 → 서버리스가 중계하다 시간 상한에 잘림 |
| 영상 자리가 비고 콘솔에 mixed content | 비전 호스트가 http — https 인증서를 붙여야 합니다 |
| `NEXT_PUBLIC_*` 을 넣었는데 그대로 | 빌드 시점에 박히는 값입니다. 재배포하세요 |
