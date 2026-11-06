# OpenFieldDigitalFarming(OFDF) 병합 설계서 — 노지 재해위험 판단을 Farm365에

- 작성: 민준 (PM·아키텍트)
- 작성일: 2026-10-15
- 상위 문서: `mode-split.md`(양식장/스마트팜 모드 분리)
- 원본 저장소: `Ulrim/openfielddigitalfarming` (커밋 `ef4fedd`, 조사 시점 읽기 전용 clone `/home/user/ulrim/openfielddigitalfarming`)

## 1. 사용자 결정 (2026-10-15)

1. **저장소 흡수** — `vision/` 선례대로 `openfield/` 하위 프로젝트로 들여온다.
2. **판단 결과를 Farm365 웹에 표시** — OFDF 엣지가 서버로 올리고, Farm365 모니터링에 "노지 재해위험" 카드.
3. **노지는 Farm365 안의 베드 유형** — 별도 모드가 아니다. `tanks.tank_type === "노지"` 인 베드에만 재해위험 카드가 붙는다. Farm365 태그라인은 `SMART HYDROPONICS` → **`SMART FARMING`** 으로 넓힌다(장비 키오스크 부제도 같이).
4. 보류: 라즈베리파이 공존 배포 스크립트, OFDF 대시보드의 React 이식. 둘 다 2·3이 현장에서 검증된 뒤.

## 2. 조사에서 확인된 사실 (지훈/Explore 보고 요약)

| 사실 | 함의 |
|---|---|
| OFDF 엣지(`ofdf.cli edge`)는 5분마다 `data/field/*.csv` 를 읽어 판단하고 `logs/journal.jsonl`·`dashboard/data.json` 에 **기록만** 한다. 하드웨어 제어·서버 업로드 코드 없음 | 업로더는 새로 쓴다. 제어 명령은 "권고"로만 표시한다 |
| 패키징 파일(pyproject) 없음, 테스트는 `PYTHONPATH=src`. systemd 유닛에 PYTHONPATH 없음 → 설치하면 `ModuleNotFoundError` 가능성 | 흡수하면서 `pyproject.toml` 추가, 유닛에서 `python -m ofdf.cli` 가 venv 설치본을 찾게 |
| `load_config` 가 YAML `data.field_dir` 를 무시(argparse 기본값 우선) | 흡수하면서 고친다 |
| 엣지가 쓰는 `data.json` 은 `judgements`·`history`·`series` 가 빈 배열(오프라인 export 만 다 채움) | 업로더는 `data.json` 이 아니라 **판단 1건마다 `journal.jsonl` 레코드**를 올린다 |
| 시각은 시간대 없는 로컬(KST 추정) | 업로더가 `Asia/Seoul` 로 해석해 ISO(+09:00)로 보낸다. 서버는 timestamptz |
| `/api/sensors/data` 는 수질 12항목 화이트리스트, 기온을 `temperature` 로 넣으면 수온으로 저장돼 오탐 | **새 엔드포인트**. `route.ts`·`thresholds.ts` 는 건드리지 않는다(mode-split 9장) |
| RS-485 설정이 Shrimp365 수질 장비와 같다(같은 포트·ID) | 한 대에서 둘을 켜면 버스 경합 — 공존은 보류(1-4) |
| 농가 말(`plain.js`)은 한국어뿐 | 웹 카드 문구는 `lib/i18n/agri/openfield.ts` 에 4개 언어로 새로 쓴다 |

## 3. 디렉토리

```
openfield/                       ← OFDF 전체 (src/ofdf, configs, scripts, deploy, dashboard, tests, docs, reports)
  pyproject.toml                 ← 신규: hatchling, extras [vision]/[edge]/[dev], `ofdf` 콘솔 스크립트
  README.md                      ← 원본 유지 + 머리에 출처·흡수 날짜·Shrimp365 연동 절 추가
  .gitignore                     ← 루트 고정 경로(/data/, /artifacts/)를 openfield/ 기준으로 다시 씀
  src/ofdf/upload.py             ← 신규: 서버 업로더 (4장)
  deploy/ofdf-edge.service       ← PYTHONPATH 문제 해결, 환경변수 OFDF_UPLOAD_URL / OFDF_DEVICE_KEY_FILE
app/api/field/device/route.ts    ← 신규: 판단 수신 (4장)
supabase/migrations/field_risk.sql
components/agri/openfield/field-risk-card.tsx (+ 하위 조각)
lib/i18n/agri/openfield.ts
```

- 히스토리는 가져오지 않는다(얕은 clone, `vision/` 선례와 같음). README 머리에 원본 커밋 해시를 적는다.
- Next/ESLint/tsconfig 가 `openfield/` 를 무시하는지 확인(`vision/` 이 이미 그렇다).
- 모델 산출물(`artifacts/`)·데이터(`data/`)는 저장소에 넣지 않는다(원본 .gitignore 유지).

## 4. 서버 계약 — 판단 업로드

### 4-1. 인증·연결
- 기존 6자리 페어링(`/api/sensors/pair`)으로 **노지 베드에 기기를 연결**한다. 그러면 `sensor_devices` 행과 `api_key` 가 생긴다. OFDF 엣지는 그 키를 `/etc/default/ofdf` 의 `OFDF_DEVICE_KEY_FILE` 이 가리키는 파일에 둔다.
- 요청 헤더 `X-Device-Key: <api_key>` (비전 `/api/vision/device` 와 같은 방식). 서버는 키로 `sensor_devices` → `tank_id` 를 찾고, `last_seen_at`·`agent_version` 을 갱신한다(`sensor_devices.firmware` 가 아니라 `agent_version` — 기존 수질 장비와 같은 칸).

### 4-2. `POST /api/field/device/judgements`
```jsonc
{
  "agent_version": "ofdf-0.1.0",
  "judgements": [                       // 최대 200건, 시간순
    {
      "ts": "2026-10-15T06:00:00+09:00", // 판단 시각(필수, tz 포함)
      "risk": "frost",                   // heat_dry | rain_wet | disease | frost | compound
      "horizon_h": 3,                    // 1 | 3
      "level": 2,                        // 0 정상 … 3 긴급 (OFDF 등급 그대로)
      "level_name": "경보",              // OFDF 가 쓰는 한국어 등급명(참고용 저장)
      "confidence": 0.81,                // 0~1
      "model_version": "ofdf-weather-0.1.0",
      "expected_onset": "2026-10-15T09:00:00+09:00",   // 선택
      "evidence": [ { "feature": "t_air", "label": "기온", "value": 1.2, "contribution": -0.31 } ],  // 최대 5
      "actions": [ { "device": "cover", "command": "close", "layer": 1, "reason": "...", "executed": false, "rejected_by": null, "advisory": true } ],
      "environment": { "t_air": 1.2, "canopy_temp": 0.4, "rh": 93, "leaf_wetness": 1, "solar_w": 0, "rain": 0, "soil_moisture": 31.5, "soil_index": 0.6, "wind_speed": 1.1 }
    }
  ]
}
```
- 응답 `{ accepted: n, duplicates: m }`. **멱등**: `(device_id, ts, risk, horizon_h)` 유니크 → 중복은 무시(`ON CONFLICT DO NOTHING`).
- 검증: `risk`·`horizon_h`·`level` 열거값, `ts` 파싱, 배열 길이 ≤ 200, `evidence` ≤ 5, `environment` 는 숫자 키 9개만(그 외 버림). 어긋나면 422 와 어느 건이 왜인지.
- 알림 연동(1차 범위): `level >= 2` 이고 같은 `(tank_id, risk)` 의 미해결 `alerts` 가 없으면 `alerts` 1건 생성 — `type` 은 level 3 → `danger`, 2 → `warning`; `parameter` 는 `field:<risk>` (예 `field:frost`) **키**로 저장하고 화면에서 `openfield` 사전으로 번역; `message` 는 OFDF `level_name` + 농가 말. level 이 1 이하로 내려오면 그 알림을 `resolved` 처리. 이 로직은 `route.ts`(수질)를 건드리지 않고 **새 라우트 안에서만** 한다. 웹푸시는 기존 `sendAlertPush` 를 그대로 호출(함수 export 위치 확인).

### 4-3. 테이블 `supabase/migrations/field_risk.sql`
```sql
CREATE TABLE IF NOT EXISTS public.field_risk_judgements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tank_id       uuid NOT NULL REFERENCES public.tanks(id) ON DELETE CASCADE,
  device_id     uuid REFERENCES public.sensor_devices(id) ON DELETE SET NULL,
  ts            timestamptz NOT NULL,
  risk          text NOT NULL CHECK (risk IN ('heat_dry','rain_wet','disease','frost','compound')),
  horizon_h     smallint NOT NULL CHECK (horizon_h IN (1,3)),
  level         smallint NOT NULL CHECK (level BETWEEN 0 AND 3),
  level_name    text,
  confidence    double precision,
  model_version text,
  expected_onset timestamptz,
  evidence      jsonb NOT NULL DEFAULT '[]',
  actions       jsonb NOT NULL DEFAULT '[]',
  environment   jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, ts, risk, horizon_h)
);
CREATE INDEX IF NOT EXISTS idx_frj_tank_ts ON public.field_risk_judgements(tank_id, ts DESC);
ALTER TABLE public.field_risk_judgements ENABLE ROW LEVEL SECURITY;
-- 소유자 + farm_viewers(읽기) — water_quality_readings 정책과 같은 모양
```
- 쓰기는 service_role(새 라우트)만. 사람이 SQL Editor 에서 실행.

## 5. 엣지 업로더 `openfield/src/ofdf/upload.py`
- `cli edge` 의 `run_once` 끝에서 호출. 판단 레코드(journal 과 같은 내용)를 **로컬 큐**(`logs/upload_queue.jsonl` 또는 SQLite)에 넣고, 네트워크가 되면 200건씩 올린다. 실패하면 다음 주기에 재시도(지수 백오프 없이 5분 주기면 충분). 큐 상한 7일치.
- 설정: 환경변수 `OFDF_UPLOAD_URL`(예 `https://www.shrimp365.kr/api/field/device/judgements`), `OFDF_DEVICE_KEY_FILE`. 둘 중 하나가 없으면 업로드를 조용히 끈다(기존 오프라인 동작 100% 유지).
- 시각: 로컬 naive → `Asia/Seoul` 부착 → ISO. `ZoneInfo` 표준 라이브러리.
- 의존성 추가 없음(`requests` 는 이미 있음).
- `dashboard/data.json` 의 `forecastStatus` 옆에 `uploadStatus`(마지막 성공 시각·대기 건수) 한 줄 추가 — 키오스크 바닥줄에 표시(선택, 작게).

## 6. Farm365 웹 표시 — `components/agri/openfield/field-risk-card.tsx`
- 장착: `agri-dashboard-view.tsx` 의 선택 베드가 `tank_type === "노지"` 이고 `field_risk_judgements` 가 1건 이상이면 **양액 상태 카드 위**에 렌더. 조건 미충족이면 null(수경재배 베드에는 아무것도 안 보인다).
- 내용(OFDF kiosk 의 농가 화면을 React 로 — 운영자 수치는 접기):
  1. 알람 띠: 최신 판단 중 최고 level 의 risk — 색(0 emerald/1 amber/2 orange/3 red)+텍스트, "언제"(`expected_onset` 또는 horizon_h), 근거 한 줄(`evidence[0].label`).
  2. 위험 5종 × 1·3시간 미니 격자(level 색 칩).
  3. 할 일: 최신 `actions` 중 `advisory` 또는 `executed` 2건까지, `rejected_by` 가 있으면 회색.
  4. 환경 타일 4칸(기온·잎높이온도·흙수분·바람) — `environment` 최신값.
  5. 접기: 신뢰도·모델 버전·판단 시각·"n분 전".
- 데이터: `lib/db.ts` 에 `getFieldRiskLatest(tankId)`(risk×horizon 별 최신 1건, RLS) 추가. 1분 자동 갱신은 대시보드의 기존 `useAutoRefresh` 에 얹는다.
- 알림 표시: 기존 알림 목록이 `alertDisplayLabel` 로 `parameter` 를 번역하는데 `field:*` 키는 `openfield` 사전에서 찾도록 **농업 알림 목록(2A·2B 파일)**에 분기 한 줄.
- 사전 `lib/i18n/agri/openfield.ts`: 위험 유형 5·등급 4·조치 장치/명령 농가 말·환경 항목 9·카드 제목·빈 상태. ko 는 OFDF `plain.js` 의 농가 말을 옮기고, en/vi/id 새로.
- 태그라인: `lib/i18n/agri/nav.ts` `brandTagline` → `SMART FARMING`(4개 언어 공통), `raspberry-pi/webui.py` 의 Farm365 부제도 같은 값.

## 7. 단계·담당·소유 파일

| 단계 | 담당 | 소유 |
|---|---|---|
| **O1 흡수+업로더** (지금, 3단계와 병렬) | 서연-7 | `openfield/**` 전부(신규), `.gitignore`·`eslint`·`tsconfig` 의 무시 규칙 확인(필요 시 한 줄), `docs/plans/openfield-merge.md` 는 읽기만 |
| **O2 서버+웹** (3단계 완료 후) | 서연-8 | `app/api/field/**`, `supabase/migrations/field_risk.sql`, `lib/db.ts`(함수 추가만), `components/agri/openfield/**`, `components/agri/agri-dashboard-view.tsx`(카드 장착 + 알림 라벨 분기), `components/agri/agri-nutrient-view.tsx`(알림 라벨 분기만), `lib/i18n/agri/openfield.ts`, `lib/i18n/agri/nav.ts`(태그라인), `raspberry-pi/webui.py`(부제 문자열만), `types/index.ts`(FieldRiskJudgement) |
| **검수** | 태양 | mode-split 10장 + 8장 |

`lib/i18n/agri/index.ts` 의 `openfield` 섹션 import 는 민준이 미리 넣는다.

## 8. 하지 말 것
- `app/api/sensors/data/route.ts`, `lib/thresholds.ts` 수정 금지.
- OFDF 모델·피처·학습 코드 수정 금지(흡수 시 경로·패키징·설정 결함만).
- 환경 센서 값을 `water_quality_readings` 에 넣지 말 것 — `field_risk_judgements.environment` 에만.
- OFDF 의 `dashboard/` 는 그대로 둔다(현장 오프라인 화면). React 이식은 보류(1-4).
- 세 번째 모드를 만들지 말 것.

## 9. 검수 (태양)
1. `openfield/` 에서 `pip install -e .[dev]` 후 `pytest` 가 원본과 같은 건수로 통과(테스트 266건 함수).
2. `python -m ofdf.cli edge --help` 가 venv 설치본으로 동작(PYTHONPATH 없이).
3. 업로더: `OFDF_UPLOAD_URL` 미설정 시 동작 무변. 설정 시 모의 서버로 200건 분할·멱등·큐 재시도 확인(단위 테스트 추가).
4. `/api/field/device/judgements` — 잘못된 키 401, 열거값 오류 422, 중복 재전송 `duplicates` 집계, level≥2 알림 생성·해제.
5. Farm365 모니터링: 노지 베드에서만 카드. 수경재배 베드 무변. 4개 언어.
6. `npm run build`, `rg` 로 `openfield/` 가 Next 빌드에 섞이지 않는지.
7. 새우 화면·`route.ts`·`thresholds.ts` diff 0.

## 10. 사람 몫
- `field_risk.sql` 실행.
- 노지 베드에 OFDF 장비를 6자리 코드로 연결하고, 발급된 키를 Pi 의 `/etc/default/ofdf` 경로 파일에 저장. `OFDF_UPLOAD_URL` 설정.
- OFDF 엣지 유닛 재시작. 기존 `data/field` 수집 브리지는 그대로.
- 지식재산권: OFDF 는 정부 과제 결과물 — 저장소 통합이 협약과 어긋나지 않는지 확인. 학습 데이터(AI-Hub·AgERA5·AAOS) 약관의 출처 표시는 README 에 유지.
