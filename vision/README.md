# shrimp365 비전 서비스

카메라 영상에서 흰다리새우를 세는 Python 서비스입니다.
shrimp365(Next.js) 안에 통합되어 **내부 전용**으로 동작합니다.

원본: [Ulrim/shrimp-vision](https://github.com/Ulrim/shrimp-vision) (`claude/trusting-cannon-uyvar9`)

---

## 왜 TypeScript 로 합치지 않았나

YOLO 추론과 영상 처리는 `ultralytics`·`opencv` 에 기대고, 이 둘은 Python
생태계 전용입니다. 억지로 옮기는 대신 **추론만 Python 서비스로 분리**하고
나머지(로그인·양식장·수조·화면·알림)는 전부 shrimp365 것을 씁니다.

```
┌──────────────────────────────────────────────┐
│ shrimp365 (Next.js)  ← 사용자가 보는 단일 플랫폼 │
│  · Supabase 로그인 하나                        │
│  · 양식장·수조 등록 한 번                       │
│  · 수질 + 개체수 통합 화면·알림                  │
└───────────┬──────────────────────────────────┘
            │ 내부 네트워크 (X-Vision-Key / 서명 토큰)
            ▼
┌──────────────────────────────────────────────┐
│ 이 서비스 (Python·FastAPI)                     │
│  · YOLOv8 추론 + ByteTrack, 카메라 스트림        │
│  · 개체수를 Supabase 에 기록                    │
│  · 경보 판정 → shrimp365 alerts 에 기록          │
└──────────────────────────────────────────────┘
                    │
                    ▼  같은 Supabase Postgres
        count_records · water_quality_readings
```

개체수와 수질이 **한 DB** 에 쌓이므로 통합 분석이 조인 한 번으로 끝납니다.

## 원본에서 걷어낸 것

| 원본 | 통합판 |
|---|---|
| 자체 JWT 로그인 · `users` 표 | Supabase Auth (shrimp365) |
| 자체 `farms` · `cameras` 표 | shrimp365 `farms` · `tanks` + `vision_cameras` |
| `alert_history` 표 | shrimp365 `alerts` (알림함·웹푸시 공유) |
| TimescaleDB 하이퍼테이블 | Supabase 일반 테이블 + 인덱스 + 집계 함수 |
| Celery · WeasyPrint 리포트 | shrimp365 리포트 화면에 흡수 |
| Alembic 마이그레이션 | `supabase/migrations/vision_monitoring.sql` |

**그대로 가져온 것**: 추론(`services/detector.py`), 스트림 파이프라인,
카메라 재연결, 경보 판정 규칙, 시뮬레이션 모드, 학습 CLI(`ai/trainer/`).

## 시뮬레이션 모드

학습된 YOLO 모델이 아직 없습니다. `MODEL_PATH` 에 가중치 파일이 없으면
**자동으로 시뮬레이션 모드**가 켜져, 카메라도 모델도 없이 전체 기능(영상·
탐지 박스·개체수·경보·통합 분석)이 그대로 돕니다. 시연과 개발은 이 모드로
합니다. `SIMULATION_MODE=true|false` 로 강제할 수 있습니다.

## 인증

이 서비스는 **외부에 노출하지 않습니다**. 두 가지 관문만 있습니다.

- `X-Vision-Key` — shrimp365 서버가 부를 때 쓰는 공유 키. `/api/v1/*` 전체.
- 서명 스트림 토큰 — `<img>`(MJPEG)와 WebSocket 은 헤더를 못 싣습니다.
  shrimp365 가 로그인 세션을 확인한 뒤 "이 사용자가 이 카메라들을 3분간
  볼 수 있다"는 짧은 서명을 발급합니다(`lib/vision-token.ts` ↔
  `app/core/security.py`). 두 파일은 같은 형식을 구현하므로 **한쪽을 고치면
  반드시 다른 쪽도 고쳐야 합니다.**

## 실행

```bash
# 의존성 (개발)
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"

# 테스트 — SQLite 임시 DB + 시뮬레이션 모드
.venv/bin/python -m pytest -q
.venv/bin/python -m ruff check .

# 로컬 구동
uvicorn app.main:app --reload --port 8000
```

운영에서는 저장소 루트의 `docker-compose.yml` 이 `vision` 서비스로 띄웁니다.
호스트에 포트를 열지 않습니다 — 웹 컨테이너만 `http://vision:8000` 으로 붙습니다.

## 모델 파일

학습된 가중치(`ai/models/*.pt`)는 수백 MB라 저장소에 넣지 않습니다.
배포 때 볼륨으로 마운트하세요(`docker-compose.yml` 의 `vision-models`).
학습은 `ai/trainer/train.py`, 프레임 추출은 `ai/trainer/extract_frames.py`.

## 환경변수

저장소 루트 `.env.example` 의 "비전(개체수 모니터링)" 절을 보세요.
