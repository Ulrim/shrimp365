# 스프린트 0 설계 노트 — 아키텍처 확정 및 첫 수직 슬라이스 계약

- 작성: architect
- 날짜: 2026-07-02
- 기준 문서: `00_개발의뢰서_MASTER.md`(SSOT), `CLAUDE.md`(운영 규칙)
- 대상 범위: MASTER 10장 "스프린트 0"
- 관련 ADR: `docs/adr/0001-power-reading-storage-convention.md`

> 이 문서의 목적: 스프린트 0의 **인터페이스/계약을 못 박는 것**. 대규모 구현은 하지 않는다.
> KPI 산식은 MASTER 3.2를 **그대로 인용**하며, 이 문서는 산식을 변경하지 않는다.
> `/packages/kpi`의 함수 **시그니처만 제안**하고, 산식 구현·수정 권한은 `data-kpi-engineer`에 있다.

---

## 0. 스프린트 0 범위 확정 (MASTER 10장 인용)

MASTER 10장 "스프린트 0(개발 착수 즉시)":
> 1. 모노레포 + Docker Compose 부팅 (web/api/db/mqtt/worker)
> 2. 데이터 모델 마이그레이션 + 시드 데이터(가상 양식장 1곳)
> 3. `kpi_engine` 순수 함수 4종 + 단위테스트(★ 최우선)
> 4. 인증 + 멀티테넌시 RLS 골격
> 5. 대시보드 셸 + 더미 시계열 차트 1개 (수직 슬라이스로 끝까지 관통)

본 슬라이스의 **끝까지 관통 목표**:
`가상 양식장 시드 → readings 더미 → EI 1개 산출 → 대시보드 카드 1개 표시`.
스프린트 0은 4종 KPI 전부가 아니라 **EI(ei_total·ei_aeration) 한 지표**를 DB→API→UI로
완주하는 것을 성공 기준으로 삼는다. 나머지 3종(OEI/FCR/폐사율)은 동일 계약 패턴을
재사용하도록 시그니처만 이 문서에서 예약한다(과설계 금지, 구현은 Phase 1).

---

## 1. 모노레포 디렉터리 구조 확정안

CLAUDE.md 권장 구조를 스프린트 0 수준으로 구체화한다. **이번 슬라이스에서 실제로 생성하는
파일은 굵게(★)** 표시한다. 나머지는 자리(placeholder)만 잡아 둔다.

```
culiver-mrv-platform/
├─ apps/
│  ├─ web/                         # React 18 + TS + Vite 프론트엔드
│  │  ├─ src/
│  │  │  ├─ main.tsx               ★ 앱 엔트리
│  │  │  ├─ App.tsx                ★ 라우터 셸
│  │  │  ├─ lib/
│  │  │  │  ├─ api-client.ts       ★ fetch 래퍼(JWT 주입, org 스코프)
│  │  │  │  └─ query-client.ts     ★ TanStack Query 설정
│  │  │  ├─ types/
│  │  │  │  └─ api.ts              ★ OpenAPI 생성 타입(백엔드 계약 미러)
│  │  │  ├─ features/
│  │  │  │  └─ dashboard/
│  │  │  │     ├─ hooks/useSiteKpi.ts     ★ GET /sites/{id}/kpi 훅
│  │  │  │     ├─ components/KpiCard.tsx  ★ KPI 카드(첫 슬라이스 산출물)
│  │  │  │     └─ OverviewPage.tsx        ★ 사이트 개요 셸
│  │  │  └─ store/                 # Zustand (UI 상태) — 이번엔 최소
│  │  ├─ index.html                ★
│  │  ├─ vite.config.ts            ★
│  │  ├─ tsconfig.json             ★
│  │  ├─ tailwind.config.ts        (ui-ux-designer가 토큰 관리)
│  │  └─ package.json              ★
│  │
│  └─ api/                         # FastAPI (Python 3.12)
│     ├─ app/
│     │  ├─ main.py                ★ FastAPI 앱 + OpenAPI
│     │  ├─ config.py              ★ 설정(.env 로드)
│     │  ├─ db/
│     │  │  ├─ session.py          ★ SQLAlchemy 2.0 세션 + org_id 컨텍스트
│     │  │  └─ base.py             ★ Declarative Base
│     │  ├─ models/                ★ ORM 모델(6장 스키마 서브셋)
│     │  │  ├─ organization.py     ★
│     │  │  ├─ site.py             ★
│     │  │  ├─ meter.py            ★
│     │  │  ├─ reading.py          ★ (hypertable 매핑)
│     │  │  ├─ harvest_log.py      ★
│     │  │  └─ kpi_config.py       ★
│     │  ├─ schemas/               ★ Pydantic 응답/요청 스키마
│     │  │  └─ kpi.py              ★ KpiResponse 등(2절 계약)
│     │  ├─ services/
│     │  │  ├─ kpi_service.py      ★ readings→kpi 입력 조립 + kpi 엔진 호출
│     │  │  └─ tenancy.py          ★ org_id 스코프 이중 방어
│     │  ├─ routers/
│     │  │  └─ kpi.py              ★ GET /sites/{site_id}/kpi
│     │  └─ deps.py                ★ 인증(JWT)·org_id 추출 의존성
│     ├─ tests/
│     │  ├─ test_kpi_endpoint.py   ★ 정상/권한/격리/경계
│     │  └─ test_tenancy.py        ★ 멀티테넌시 누수 테스트
│     ├─ pyproject.toml            ★
│     └─ Dockerfile                ★
│
├─ packages/
│  └─ kpi/                         # KPI/MRV 도메인 엔진(순수 함수) ★가장 보호받는 코드
│     ├─ culiver_kpi/
│     │  ├─ __init__.py            ★ 공개 API 재노출
│     │  ├─ types.py               ★ 입출력 dataclass(2.1절 계약)
│     │  ├─ energy.py              ★ ei_total / ei_aeration 구현(data-kpi-engineer)
│     │  ├─ feed.py                # fcr (Phase 1 예약)
│     │  ├─ oxygen.py              # oei (Phase 1 예약)
│     │  ├─ mortality.py           # mortality_rate (Phase 1 예약)
│     │  ├─ mrv.py                 # scope2 / 감축량 (Phase 1~3 예약)
│     │  └─ config.py              ★ KpiConfig 파싱 + 기본 파라미터
│     ├─ tests/
│     │  └─ test_energy.py         ★ EI 단위테스트(경계조건 포함)
│     └─ pyproject.toml            ★ (api가 로컬 의존성으로 설치)
│
├─ infra/
│  ├─ docker-compose.yml           ★ postgres+timescale, mqtt, api, web, worker
│  ├─ .env.example                 ★ (비밀값 예시, 커밋 대상)
│  ├─ db/
│  │  └─ init/                     ★ timescaledb extension·RLS 부트스트랩 SQL
│  ├─ migrations/                  ★ Alembic (env.py, versions/)
│  └─ seed/
│     └─ seed_demo_site.py         ★ 가상 양식장 1곳 + 더미 readings/harvest
│
├─ docs/
│  ├─ adr/
│  │  ├─ 0001-power-reading-storage-convention.md   ★
│  │  └─ NNNN-*.md                 # 이후 결정
│  └─ design/
│     └─ sprint-0.md               ★ (본 문서)
│
├─ .claude/agents/                 # 전담 팀(기존)
├─ Makefile                        ★ dev/test/e2e/lint/migrate
├─ CLAUDE.md                       (기존)
└─ 00_개발의뢰서_MASTER.md         (기존 SSOT)
```

배치 규칙(요약):
- **산식**은 오직 `packages/kpi/culiver_kpi/*` 에만. API/FE 어디에도 산식 중복 금지(Rule 1).
- **DB 스키마/마이그레이션**은 `infra/migrations`(Alembic) — ORM 모델은 `apps/api/app/models`.
- **비밀값**은 `infra/.env`(커밋 금지), 예시는 `infra/.env.example`.
- FE는 산식을 몰라야 한다. 백엔드가 계산해 준 값+근거만 소비(2.4절).

### 1.1 KPI 엔진 언어 = Python (별도 ADR 불요)
MASTER 5장이 "KPI 엔진/MRV 산정 로직과 동일 언어로 통일(Python)"을 명시하므로
`/packages/kpi`는 **Python 패키지**다. FE는 kpi 패키지를 직접 쓰지 않고 **OpenAPI로 생성한
TS 타입**(`apps/web/src/types/api.ts`)으로 계약을 소비한다. 확정 스택 내 결정이므로 ADR 불필요.

---

## 2. 첫 수직 슬라이스 계약 (★ 이 문서의 핵심)

슬라이스: `시드 → readings 더미 → EI 산출 → 대시보드 카드`.

### 2.1 `/packages/kpi` — EI 순수 함수 시그니처 (제안, 구현은 data-kpi-engineer)

산식(MASTER 3.2 ① 그대로 인용):
```
EI = 기간 내 총 전력사용량(kWh) / 기간 내 생산량(kg) = Σ(power_kWh) / Δbiomass_kg
단위: kWh/kg
세부: 총전력 EI, 폭기전력 EI(블로워 서브미터 분리) 둘 다 산출
```

입력 데이터 표현은 ADR 0001을 전제한다(readings.value = interval kWh, 이미 정규화됨).
따라서 엔진은 **정렬·차분·정규화 같은 부작용 없이 순수 합산**만 한다(Rule 6: 결정론).

```python
# packages/kpi/culiver_kpi/types.py  — 입출력 계약(dataclass, frozen=불변)
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Sequence

@dataclass(frozen=True)
class PowerReading:
    meter_id: str          # 근거 추적용 (readings→meters 역추적)
    ts: datetime           # 계측 시각 (UTC), 기간 필터/정렬 판단용
    kwh: float             # 계측 간격 증분 전력량(kWh). ADR 0001로 정규화된 값
    is_aeration: bool      # 폭기(블로워) 서브미터 여부 → ei_aeration 분자 구분
    quality_flag: str      # 'ok' | 'suspect' | 'bad'

@dataclass(frozen=True)
class BiomassPoint:
    ts: datetime
    biomass_kg: float      # 시점 생체량(kg)
    source_ref: str        # 근거 참조 ID (harvest_logs.id 등) — drill-down용

@dataclass(frozen=True)
class EiConfig:
    # kpi_config.params_json 에서 로드되는 산출 파라미터
    included_quality_flags: tuple[str, ...] = ("ok",)  # KPI에 포함할 quality_flag
    min_biomass_delta_kg: float = 0.0                  # 이하이면 EI=None (0 나눗셈 방지)

@dataclass(frozen=True)
class EiResult:
    # --- 산출 지표 (biomass_delta <= min 이면 None = 산출 불가) ---
    ei_total: Optional[float]          # kWh/kg
    ei_aeration: Optional[float]       # kWh/kg
    # --- 산출 근거/중간값 (검증 추적성; MASTER 7장) ---
    total_power_kwh: float             # 분자(총전력)
    aeration_power_kwh: float          # 분자(폭기전력)
    biomass_start_kg: float
    biomass_end_kg: float
    biomass_delta_kg: float            # 분모 Δbiomass
    period_start: datetime
    period_end: datetime
    included_reading_count: int        # 포함된 reading 수
    excluded_reading_count: int        # quality_flag/기간 밖으로 제외된 수
    source_meter_ids: tuple[str, ...]  # 근거 계측기 목록 (drill-down)
    source_biomass_refs: tuple[str, ...]  # 근거 생체량 참조 (drill-down)
    config_version: str                # 적용된 kpi_config.version

def compute_ei(
    power_readings: Sequence[PowerReading],
    biomass_start: BiomassPoint,
    biomass_end: BiomassPoint,
    period_start: datetime,
    period_end: datetime,
    config: EiConfig,
    config_version: str,
) -> EiResult:
    """총전력 EI와 폭기전력 EI를 동시에 산출(MASTER 3.2 ①).
    순수·결정론: 동일 입력 → 동일 출력. now()/난수 금지.
    규칙:
      - [period_start, period_end) 범위 밖 또는 quality_flag ∉ included 인 reading은 제외.
      - total_power_kwh = 포함된 모든 reading.kwh 합.
      - aeration_power_kwh = 포함된 reading 중 is_aeration=True 의 kwh 합.
      - biomass_delta_kg = biomass_end.biomass_kg - biomass_start.biomass_kg.
      - biomass_delta_kg <= config.min_biomass_delta_kg 이면 ei_total/ei_aeration = None.
    """
    ...  # 구현은 data-kpi-engineer 소관. architect는 산식을 작성/변경하지 않는다.
```

산식 변경 금지 원칙: 위 docstring의 "규칙"은 MASTER 3.2 ①의 재서술일 뿐이다.
파라미터화가 필요하면 `EiConfig`를 확장하고 `kpi_config.version`을 올린다(Rule 2).

향후 3종(예약 시그니처만, 구현 X):
```python
# feed.py     def compute_fcr(feed_kg: Sequence[FeedReading], b0, b1, ...) -> FcrResult
# oxygen.py   def compute_oei(do_series, aeration_readings, biomass, band, ...) -> OeiResult
# mortality.py def compute_mortality(logs, stocked_count, ...) -> MortalityResult
```

### 2.2 백엔드 API 계약 — `GET /sites/{site_id}/kpi?from&to`

MASTER 7장 원칙 준수: **산출 파라미터·기간·근거 참조 ID를 항상 함께 반환**.
스프린트 0 응답은 EI만 채운다(나머지 지표 키는 예약, `null`).

요청:
```
GET /sites/{site_id}/kpi?from=2026-06-01T00:00:00Z&to=2026-06-30T23:59:59Z
Authorization: Bearer <JWT>          # 클레임에 org_id 포함
# (granularity 파라미터는 예약; 스프린트 0은 'period' 단일 집계만)
```

응답 200 (Pydantic `KpiResponse`):
```jsonc
{
  "site_id": "d1f0...-site",
  "org_id": "a0b1...-org",
  "period": {
    "from": "2026-06-01T00:00:00Z",
    "to":   "2026-06-30T23:59:59Z",
    "granularity": "period"
  },
  "kpi_config": {
    "version": "2026.1.0",
    "params": {
      "included_quality_flags": ["ok"],
      "min_biomass_delta_kg": 0.0
    }
  },
  "metrics": {
    "ei_total":    { "value": 4.87, "unit": "kWh/kg", "status": "green" },
    "ei_aeration": { "value": 2.31, "unit": "kWh/kg", "status": "green" },
    "oei":            null,          // Phase 1 예약
    "fcr":            null,          // Phase 1 예약
    "mortality_rate": null           // Phase 1 예약
  },
  "inputs": {
    "total_power_kwh": 12480.0,
    "aeration_power_kwh": 5920.0,
    "biomass_start_kg": 0.0,
    "biomass_end_kg": 2560.0,
    "biomass_delta_kg": 2560.0,
    "included_reading_count": 720,
    "excluded_reading_count": 3
  },
  "provenance": {                    // 검증 drill-down (MASTER 3.3, 7장)
    "source_meter_ids": ["...-power-main", "...-power-blower"],
    "source_biomass_refs": ["...-harvest-open", "...-harvest-close"],
    "kpi_snapshot_id": null          // 스냅샷 영속화는 Phase 1(kpi_snapshots)
  },
  "generated_at": "2026-07-02T09:15:00Z"
}
```

계약 규정:
- `metrics.*.status`: 신호등(green/amber/red/na). 임계 파라미터는 향후 `kpi_config`로 이관.
  스프린트 0에서는 값 존재 시 `green`, `value=null`이면 `na`로 단순 처리(임계 로직 Phase 1).
- `value=null`은 "산출 불가"(예: biomass_delta<=min)를 의미하며 프론트는 이를 별도 표기.
- 응답의 모든 수치는 `inputs`/`provenance`로 근거 역추적 가능해야 한다(재현성 NFR).
- `generated_at`은 **메타데이터**일 뿐 산출 로직 입력이 아니다(결정론 유지).

에러:
- `401` 인증 실패, `403` 다른 org의 site 접근(테넌시), `404` site 없음, `422` 기간 파라미터 오류.

### 2.3 org_id 스코프 방식 (멀티테넌시 이중 방어)

CLAUDE Rule 4 + MASTER 7장 "RLS + 서비스 레이어 이중 방어":
1. **인증 계층(`deps.py`)**: JWT 검증 → `org_id`, `role`, `user_id` 추출해 요청 컨텍스트에 주입.
2. **DB 계층(RLS)**: 세션 시작 시 `SET app.current_org_id = <org_id>` → `sites`/`meters`/
   `readings`/`harvest_logs`의 RLS 정책이 `org_id = current_setting('app.current_org_id')`로 강제.
   - `readings`/`meters`는 `org_id` 컬럼을 비정규화로 함께 두어 조인 없이 RLS 적용(성능/격리).
3. **서비스 계층(`tenancy.py`)**: `site_id`가 컨텍스트 `org_id`에 속하는지 명시적 재검증
   (RLS를 신뢰하되 방어적으로 한번 더). 불일치 시 `403`.
- 스프린트 0 필수 산출물: **테넌시 누수 테스트**(다른 org 토큰으로 타 org site 조회 → 403/404).

### 2.4 프론트 KPI 카드가 소비하는 데이터 형태

FE는 산식을 모른다. 백엔드가 준 `metrics` + `inputs`만 렌더한다.
`useSiteKpi(siteId, from, to)` 훅이 `KpiResponse`를 반환하고, `KpiCard`는 그중 한 지표 슬롯을 소비.

```typescript
// apps/web/src/types/api.ts  (OpenAPI 생성 타입의 손수 미러; 스프린트 0)
export type KpiMetricStatus = "green" | "amber" | "red" | "na";

export interface KpiMetric {
  value: number | null;   // null = 산출 불가 → 카드에 "산출 불가" 표기
  unit: string;           // "kWh/kg"
  status: KpiMetricStatus;
}

export interface KpiResponse {
  site_id: string;
  org_id: string;
  period: { from: string; to: string; granularity: string };
  kpi_config: { version: string; params: Record<string, unknown> };
  metrics: {
    ei_total: KpiMetric | null;
    ei_aeration: KpiMetric | null;
    oei: KpiMetric | null;
    fcr: KpiMetric | null;
    mortality_rate: KpiMetric | null;
  };
  inputs: {
    total_power_kwh: number;
    aeration_power_kwh: number;
    biomass_start_kg: number;
    biomass_end_kg: number;
    biomass_delta_kg: number;
    included_reading_count: number;
    excluded_reading_count: number;
  };
  provenance: {
    source_meter_ids: string[];
    source_biomass_refs: string[];
    kpi_snapshot_id: string | null;
  };
  generated_at: string;
}

// KpiCard가 실제로 받는 최소 props (지표 1개 슬롯)
export interface KpiCardProps {
  title: string;              // "전력집약도(EI)"
  metricKey: "ei_total" | "ei_aeration" | "oei" | "fcr" | "mortality_rate";
  metric: KpiMetric | null;   // metrics[metricKey]
  configVersion: string;      // kpi_config.version (근거 표기)
  period: { from: string; to: string };
}
```
카드 표시 규칙: `metric===null || metric.value===null` → "산출 불가" 상태.
카드 하단에 `configVersion`과 기간을 작게 표기해 **어떤 산식 버전으로 산출됐는지** 증빙.

### 2.5 스프린트 0 최소 DB 테이블 집합

MASTER 6장 스키마의 **서브셋만** 생성(과설계 금지). 이번 슬라이스에 실제 필요한 것:

| 테이블 | 스프린트 0 컬럼(핵심) | 용도 |
|---|---|---|
| `organizations` | id, name, plan, created_at | 테넌트 루트 |
| `sites` | id, **org_id**, name, region, ras_type | 양식장. org 스코프 앵커 |
| `meters` | id, site_id, **org_id**, type, unit, sub_meter_of, is_aeration | 전력계(main/blower) 등록. `is_aeration`으로 폭기 서브미터 구분 |
| `readings` | time, meter_id, **org_id**, value, quality_flag | 시계열(hypertable). value=interval kWh(ADR 0001) |
| `harvest_logs` | id, batch_id?, **site_id**, **org_id**, ts, biomass_kg, count | EI 분모 Δbiomass의 시점(개시/마감) 근거 |
| `kpi_config` | id, version, params_json, effective_from | EI 산출 파라미터/버전 (Rule 2·5의 버전 추적) |

주석:
- `readings`/`meters`/`harvest_logs`에 **`org_id` 비정규화 컬럼**을 두어 RLS를 조인 없이 적용
  (2.3절, NFR 성능). MASTER 6장 원안 대비 격리·성능 목적의 보강이며 산식 영향 없음.
- `meters.is_aeration`(bool)는 MASTER 6장 `sub_meter_of` + type='power'로도 표현 가능하나,
  스프린트 0에서는 폭기 분리를 명시적 플래그로 단순화(EI aeration 분자 구분에 직접 사용).
- `tanks`, `batches`, `users`는 이번 슬라이스에 **불필요** → Phase 1로 미룸.
  (인증은 JWT 클레임의 org_id/role만 사용; users 테이블 없이 시드 토큰으로 진행 가능.)
- `harvest_logs.batch_id`는 nullable로 두고 스프린트 0 시드는 site 단위 개시/마감 2행만 생성.

시드(`infra/seed/seed_demo_site.py`)가 만들 것:
- org 1(plan=START) → site 1 → meters 2개(power main, power blower[is_aeration=true])
- 한 달치 시간단위 `readings`(interval kWh) 더미(결정론적 생성; 고정 시드값)
- `harvest_logs` 2행(기간 시작 biomass_kg=0, 기간 끝 biomass_kg=2560 등)
- `kpi_config` 1행(version='2026.1.0', 기본 params)

---

## 3. 스프린트 0 작업 분해 (수용 기준 + MASTER 11장 증빙 매핑)

각 작업은 **완료 정의(수용 기준)** 와 **어떤 평가 증빙(MASTER 11장)에 기여하는지** 한 줄을 갖는다.
구현은 아래 전담 에이전트에 위임하고, architect는 계약(2절)만 확정한다.

### 3.1 KPI — 위임: `data-kpi-engineer` (★최우선, Rule 1)
- **K1. `culiver_kpi.types` + `compute_ei` 구현**
  - 수용: 2.1절 시그니처 그대로 구현. 순수·결정론(같은 입력 2회 호출 → 동일 EiResult).
    ei_total·ei_aeration 동시 산출. now()/난수 미사용(정적 검사로 확인).
  - 증빙(11장): "탄소저감 성과 리포트(MRV)"의 산식 근간 — EI가 MRV 감축량 산정의 입력.
- **K2. EI 단위테스트(`tests/test_energy.py`)**
  - 수용: 경계조건 **전부** 통과 — biomass_delta=0 → None, quality_flag='bad' 제외,
    기간 밖 reading 제외, aeration 부분집합 합산 정확, source_ref 누적 정확.
    `make test`에서 green.
  - 증빙(11장): "현장 재현성" — 산식이 테스트로 고정되어 동일 입력→동일 출력 증명.
- **K3. `kpi_config` 기본 파라미터/버전 규약 정의(`config.py`)**
  - 수용: version='2026.1.0', params_json ↔ `EiConfig` 매핑 확정. 버전 증가 절차 문서화(Rule 2).
  - 증빙(11장): MRV "산식·가정 명시"의 버전 추적 근거.

### 3.2 BE — 위임: `backend-engineer`
- **B1. ORM 모델 + Alembic 마이그레이션(2.5 테이블 서브셋)**
  - 수용: `make migrate` 성공, `readings`는 TimescaleDB hypertable로 생성, downgrade 작성.
    RLS 정책 SQL 포함(org_id 스코프).
  - 증빙(11장): "통합 관리 대시보드"의 데이터 흐름도 근거(스키마=파이프라인 골격).
- **B2. 시드 스크립트(`infra/seed/seed_demo_site.py`)**
  - 수용: 결정론적 시드로 org1/site1/meters2/한달치 readings/harvest2/kpi_config1 생성.
    재실행 멱등(중복 생성 없음).
  - 증빙(11장): "현장 재현성" — 가상 양식장으로 데모/재현 가능.
- **B3. `GET /sites/{site_id}/kpi` 라우터 + `kpi_service`(2.2 계약)**
  - 수용: `KpiResponse` 스키마대로 응답, readings→`compute_ei` 입력 조립은 서비스가 담당
    (**산식은 kpi 패키지 호출만**, Rule 1). from/to·config version·provenance 항상 포함.
    OpenAPI `/docs`에 노출.
  - 증빙(11장): "통합 관리 대시보드" + MRV "검증 drill-down"(provenance 반환).
- **B4. 인증/테넌시(`deps.py`,`tenancy.py`) + 누수 테스트(`test_tenancy.py`)**
  - 수용: JWT에서 org_id 추출 → RLS `SET` → 서비스 재검증 3중. **타 org site 조회 시 403/404**.
    누수 테스트 통과 없이 머지 금지(Rule 4).
  - 증빙(11장): "도입 패키지" 신뢰성 기반 — 멀티테넌시 격리(NFR 강제).
- **B5. `pytest` 엔드포인트 테스트(정상/권한/격리/경계)**
  - 수용: 200 정상, 401/403/404/422 각각 검증, biomass_delta=0 시 value=null 응답.
  - 증빙(11장): "현장 재현성" — API 계약 회귀 방지.

### 3.3 FE — 위임: `frontend-engineer` (+ 토큰은 `ui-ux-designer`)
- **F1. 앱 셸 + 라우팅 + api-client(JWT 주입) + TanStack Query 설정**
  - 수용: `make dev`로 web 기동, `/overview` 라우트 진입, 401 시 처리 경로 존재.
  - 증빙(11장): "통합 관리 대시보드" 화면 URL 확보.
- **F2. `useSiteKpi` 훅 + `KpiCard`(EI) — 첫 카드**
  - 수용: `GET /sites/{id}/kpi` 소비, 2.4절 `KpiCardProps`대로 EI(ei_total 또는 ei_aeration)
    카드 1개 렌더. value=null → "산출 불가" 표기. 카드에 config version·기간 표기.
  - 증빙(11장): "통합 관리 대시보드" — 대시보드 화면 캡처(심사 증빙물).
- **F3. 더미 시계열 차트 1개(ECharts) — 슬라이스 관통 확인용**
  - 수용: readings 기반(또는 inputs 요약) 시계열 1개 렌더. 로딩/에러 상태 처리.
  - 증빙(11장): "통합 관리 대시보드" 데이터 흐름 시각 증빙.

### 3.4 QA — 위임: `qa-reviewer` (Rule 10: 모든 머지 전 검증)
- **Q1. 수용 기준 체크 + 슬라이스 관통 확인**
  - 수용: DB→API→UI가 하나의 시드 데이터로 EI 값이 **일관**되게 흐르는지 확인
    (시드 readings 합 / biomass_delta = 카드에 뜬 EI 값과 일치).
  - 증빙(11장): 전 항목의 "달성/미달성" 판정 가능성 담보.
- **Q2. 게이트 검증**: `make lint`(ruff+eslint+tsc), `make test`(pytest+vitest) green +
  테넌시 누수 테스트 통과 확인. 미통과 시 머지 차단.
  - 증빙(11장): "현장 재현성" + 격리 NFR.

### 3.5 인프라/오케스트레이션 (메인 세션)
- **I1. `infra/docker-compose.yml` + `Makefile`(dev/test/e2e/lint/migrate) + `.env.example`**
  - 수용: `make dev`로 web/api/db(timescale)/mqtt/worker 5개 컨테이너 기동, 헬스체크 green.
  - 증빙(11장): "현장 재현성" — 설치/운영 매뉴얼의 기동 근거.

---

## 4. 결정 기록(ADR) 현황

- **ADR 0001**(제안): 전력 readings 저장 규약 = interval kWh 정규화.
  → `data-kpi-engineer` 합의 후 확정(Accepted)로 전환. `compute_ei`의 입력 전제이므로 선행 합의 필수.
- 그 외 스택 변경 없음 → 추가 ADR 불요(과설계 금지). KPI 엔진 Python·FE OpenAPI 타입 소비는
  확정 스택 내 결정(1.1절)이라 ADR 대상 아님.

---

## 5. 위임 제안 요약 (오케스트레이터용)

1. **선행**: `data-kpi-engineer`가 ADR 0001 검토·합의 → K1~K3(EI 엔진+테스트). 최우선.
2. 동시 진행: `backend-engineer` B1~B2(스키마/시드), `frontend-engineer` F1(셸),
   메인 I1(compose/Makefile).
3. K1 계약 확정 후: B3~B5(API/테넌시/테스트) → F2~F3(카드/차트).
4. 통합 후 `qa-reviewer` Q1~Q2 게이트 → 통과 시에만 머지(Rule 10).
- 계약(2절)은 architect가 못 박았다. 구현자는 시그니처/스키마를 임의 변경하지 말고,
  변경 필요 시 architect·(산식이면)data-kpi-engineer에 되돌려 합의한다.
