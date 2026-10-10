# Phase 1 설계 노트 — Baseline 확보 (데이터 파이프라인·기준선 고정·KPI 엔진 v1)

- 작성: architect
- 날짜: 2026-07-03
- 기준 문서: `00_개발의뢰서_MASTER.md`(SSOT), `CLAUDE.md`(운영 규칙)
- 선행 계약: `docs/design/sprint-0.md`(EI 슬라이스 확정), `docs/adr/0001-*`(승인)
- 신규 ADR: `docs/adr/0002-baseline-lock-immutability.md`(제안),
  `docs/adr/0003-oei-do-in-band-computation.md`(제안, data-kpi-engineer 합의 필수)

> **이 문서의 목적**: Phase 1의 **인터페이스/계약을 못 박는 것**. 대규모 구현은 하지 않는다.
> KPI 산식은 MASTER 3.2를 **그대로 인용**하며 architect는 산식을 변경하지 않는다.
> `/packages/kpi` 함수는 **시그니처·입출력·경계 규약만 제안**하고, 산식 구현·수정 권한은
> `data-kpi-engineer`에 있다(Rule 1). 스프린트 0의 `EiResult`/`compute_ei` 패턴을 그대로 재사용한다.

---

## 0. Phase 1 범위 확정 (MASTER 10장 인용)

MASTER 10장:
> **Phase 1 (초기, 4~5월) — Baseline 확보**: 데이터 파이프라인·기준선 고정
> 결과물: DB/스키마, ingestion, 센서 매핑, **기준선 잠금**, KPI 엔진 v1 + 단위테스트

Phase 1의 **끝까지 관통 목표**:
`실데이터 수집(ingestion) → 4종 KPI 산출(엔진 v1) → 스냅샷 영속화 → 기준선 잠금(불변)`.
스프린트 0에서 EI 한 지표를 DB→API→UI로 완주했다. Phase 1은 (1) 나머지 3종(FCR/OEI/mortality)을
동일 패턴으로 완성하고, (2) 산출 결과를 `kpi_snapshots`로 영속화하며, (3) 그 스냅샷을
**기준선(baseline)으로 잠가 불변화**하고, (4) 실데이터 수집 파이프라인(ingestion)을 세운다.

**과설계 금지 원칙(협약기간 7개월, START·PRO 우선)**:
- MRV 리포트/Scope2 환산/추천 로직/제어 콘솔은 **Phase 2~3 범위** → 본 Phase에서 손대지 않는다.
- 이번 Phase의 KPI는 **기간 단위(period) 집계**만. continuous aggregate·granularity 세분화는
  대시보드가 필요로 하는 Phase 2로 미룬다.
- `emission_factors`, `recipes`, `control_actions`, `mrv_reports`는 스키마조차 이번엔 만들지 않는다.

---

## 1. KPI 엔진 v1 — 3종 함수 시그니처 확정 (구현: `data-kpi-engineer`)

배치: `packages/kpi/culiver_kpi/feed.py`(FCR), `oxygen.py`(OEI), `mortality.py`(mortality).
공통 패턴(스프린트 0 `EiResult`와 동일, ★ 협상 대상 아님):
- 입출력은 `@dataclass(frozen=True)` — 산출 중 상태 변형 원천 차단.
- 결과 dataclass는 **지표(Optional) + 산출 근거/중간값 + source_*_refs(drill-down) + config_version**.
- 순수·결정론(Rule 6): 동일 입력 → 동일 출력. `now()`/난수/외부상태 금지.
- 경계=None 규약: 분모가 0/음수/임계 미달이면 지표는 `None`("산출 불가"). 근거 필드는 항상 채움.
- 방어: 포함 입력이 비유한(NaN/inf)이거나 기간 역전이면 `ValueError`(EI와 동일).
- `config_version`은 산출 **입력이 아니라** 결과에 실려 추적되는 메타데이터(결정론 유지).

신규 공개 심볼은 `culiver_kpi/__init__.py` `__all__`에 추가한다(EI와 동일 재노출 규칙).

### 1.1 `compute_fcr` — MASTER 3.2 ③ (사료요구율)

산식(그대로 인용):
```
FCR = 기간 내 총 급이량(kg) / 기간 내 증체량(kg) = Σ(feed_kg) / Δbiomass_kg
```
`BiomassPoint`는 스프린트 0 타입을 **재사용**(EI 분모와 동일한 Δbiomass 개념).

```python
# packages/kpi/culiver_kpi/types.py 에 추가
@dataclass(frozen=True)
class FeedReading:
    source_ref: str        # 근거 추적 ID (feed_logs.id) — drill-down
    batch_id: str          # 급이 대상 배치
    ts: datetime           # 급이 시각(UTC)
    feed_kg: float         # 급이량(kg)
    quality_flag: str = "ok"   # 데이터 정합 플래그(수기 입력 검증 결과). 기본 'ok'

@dataclass(frozen=True)
class FcrConfig:
    included_quality_flags: tuple[str, ...] = ("ok",)  # 합산 포함 플래그
    min_biomass_delta_kg: float = 0.0                  # 이하이면 FCR=None(0 나눗셈 방지)

@dataclass(frozen=True)
class FcrResult:
    fcr: Optional[float]               # 무차원(kg/kg). None=산출 불가
    total_feed_kg: float               # 분자 Σ(feed_kg)
    biomass_start_kg: float
    biomass_end_kg: float
    biomass_delta_kg: float            # 분모 Δbiomass
    period_start: datetime
    period_end: datetime
    included_feed_count: int
    excluded_feed_count: int
    source_feed_refs: tuple[str, ...]  # 근거 feed_logs (정렬·중복제거, drill-down)
    source_biomass_refs: tuple[str, ...]
    config_version: str

def compute_fcr(
    feed_readings: Sequence[FeedReading],
    biomass_start: BiomassPoint,
    biomass_end: BiomassPoint,
    period_start: datetime,
    period_end: datetime,
    config: FcrConfig,
    config_version: str,
) -> FcrResult:
    """총 급이량 / Δ증체량(MASTER 3.2 ③). 순수·결정론.
    규칙:
      - [period_start, period_end) 밖 또는 quality_flag ∉ included 인 feed 는 제외.
      - total_feed_kg = 포함된 feed.feed_kg 합.
      - biomass_delta_kg = biomass_end - biomass_start.
      - biomass_delta_kg <= min_biomass_delta_kg → fcr = None.
    방어: 포함 feed_kg 가 비유한/음수 → ValueError. period 역전 → ValueError.
    """
    ...  # 구현: data-kpi-engineer
```

### 1.2 `compute_oei` — MASTER 3.2 ② (산소운전 효율지수) ★ ADR 0003 전제

산식(그대로 인용, MASTER가 "제안값"으로 명시):
```
OEI = (DO 목표대역 유지율) / (생산 kg당 폭기 전력)
    = (t_in_band / t_total) / (aeration_kWh / biomass_kg)   → 0~100 스케일
★ 본 산식은 제안값. 실증 1단계에서 현장 데이터로 계수 보정 → kpi_config version 증가로 기록.
```
DO 유지율의 결정론적 산정과 스케일 계수 외부화는 **ADR 0003**을 전제로 한다
(v1=샘플 개수 비율, 스케일 계수는 `OeiConfig.oei_scale_factor` = 제안값 → 보정 시 version↑).
폭기 전력은 스프린트 0 `PowerReading`(is_aeration=True)을 **재사용**, 생산량은 `BiomassPoint` 재사용.

```python
@dataclass(frozen=True)
class DoReading:
    meter_id: str          # DO 센서 계측기 (drill-down)
    ts: datetime           # 계측 시각(UTC)
    do_mg_l: float         # 용존산소(mg/L)
    quality_flag: str      # 'ok' | 'suspect' | 'bad'

@dataclass(frozen=True)
class DoBand:
    do_min: float          # 목표대역 하한(tanks.target_do_min)
    do_max: float          # 목표대역 상한(tanks.target_do_max)

@dataclass(frozen=True)
class OeiConfig:
    included_quality_flags: tuple[str, ...] = ("ok",)
    min_biomass_kg: float = 0.0            # Δbiomass 이하이면 OEI=None
    do_band_method: str = "sample_count"   # ADR 0003: v1 개수 비율. 'time_weighted' 예약
    oei_scale_factor: float = 1.0          # ★ 제안 스케일 계수(실증 보정 대상, version↑)
    clamp_max: float = 100.0               # 0~100 지수 상한

@dataclass(frozen=True)
class OeiResult:
    oei: Optional[float]                   # 0~100. None=산출 불가
    do_in_band_fraction: Optional[float]   # t_in_band/t_total (0~1)
    do_total_samples: int                  # 유효 DO 샘플 수(t_total 근거)
    do_in_band_samples: int                # 대역 내 유효 샘플 수(t_in_band 근거)
    do_excluded_samples: int               # 기간밖/불량 제외 수
    aeration_power_kwh: float              # 폭기 전력(분모 항)
    biomass_delta_kg: float                # 생산량(분모 정규화 항)
    band_min: float
    band_max: float
    oei_raw: Optional[float]               # 스케일 전 원값(검증 추적)
    scale_factor: float                    # 적용된 oei_scale_factor(보정 근거)
    method: str                            # 적용된 do_band_method
    period_start: datetime
    period_end: datetime
    source_do_meter_ids: tuple[str, ...]
    source_aeration_meter_ids: tuple[str, ...]
    source_biomass_refs: tuple[str, ...]
    config_version: str

def compute_oei(
    do_readings: Sequence[DoReading],
    aeration_readings: Sequence[PowerReading],   # is_aeration=True 만 분자에 유효
    biomass_start: BiomassPoint,
    biomass_end: BiomassPoint,
    band: DoBand,
    period_start: datetime,
    period_end: datetime,
    config: OeiConfig,
    config_version: str,
) -> OeiResult:
    """MASTER 3.2 ② (제안 산식). 순수·결정론. 상세 규약은 ADR 0003.
    경계(→ None): 유효 DO 샘플 0 / aeration_kwh=0 / biomass_delta<=min.
    방어(→ ValueError): band.do_min>=band.do_max / 비유한 입력 / period 역전.
    """
    ...  # 구현: data-kpi-engineer (ADR 0003 Accepted 이후 착수)
```

### 1.3 `compute_mortality` — MASTER 3.2 ④ (폐사율)

산식(그대로 인용):
```
폐사율(%) = (기간 내 폐사 개체수 / 기초 입식 개체수) × 100
누적 폐사율 / 일일 폐사율 / 7일 이동평균 모두 산출
```
입식수(`stocked_count`)는 `batches.stocked_count`에서 온다. 일/7일 시계열은 **UTC 일 경계**로
버킷팅한다(결정론; 서비스가 ts를 UTC로 정규화해 전달 — kpi_service `_as_utc` 패턴 재사용).

```python
@dataclass(frozen=True)
class MortalityReading:
    source_ref: str        # 근거 추적 ID (mortality_logs.id)
    batch_id: str
    ts: datetime           # 폐사 기록 시각(UTC)
    dead_count: int        # 폐사 개체수(음수 불가)

@dataclass(frozen=True)
class MortalityConfig:
    moving_avg_window_days: int = 7   # 이동평균 창(기본 7일, MASTER 명시)
    # day_boundary 는 UTC 고정(v1). tz 파라미터화는 필요 시 version↑ 로 도입(예약).

@dataclass(frozen=True)
class DailyMortality:
    date: date             # UTC 기준 일자
    dead_count: int
    daily_rate_pct: Optional[float]   # dead_count/stocked_count*100. stocked<=0 → None

@dataclass(frozen=True)
class MovingAvgPoint:
    date: date
    ma_rate_pct: Optional[float]      # 최근 window 일 daily_rate 평균

@dataclass(frozen=True)
class MortalityResult:
    cumulative_rate_pct: Optional[float]   # Σdead/stocked*100. None=산출 불가
    total_dead_count: int
    stocked_count: int
    daily: tuple[DailyMortality, ...]      # 일자 오름차순
    moving_avg: tuple[MovingAvgPoint, ...] # 7일 이동평균 시계열
    period_start: datetime
    period_end: datetime
    source_refs: tuple[str, ...]           # 근거 mortality_logs (정렬·중복제거)
    config_version: str

def compute_mortality(
    mortality_readings: Sequence[MortalityReading],
    stocked_count: int,
    period_start: datetime,
    period_end: datetime,
    config: MortalityConfig,
    config_version: str,
) -> MortalityResult:
    """MASTER 3.2 ④. 순수·결정론.
    규칙:
      - [period_start, period_end) 밖 record 는 제외.
      - cumulative_rate_pct = Σdead/stocked_count*100.
      - stocked_count <= 0 → 모든 rate(cumulative/daily/ma) = None(0 나눗셈 방지).
      - daily: UTC 일 버킷 dead_count 합 → daily_rate_pct.
      - moving_avg: daily_rate 의 최근 window_days 평균(결정론적).
    방어: dead_count 음수/비유한 → ValueError. stocked_count 음수 → ValueError. period 역전 → ValueError.
    """
    ...  # 구현: data-kpi-engineer
```

### 1.4 config 규약(Rule 2) 반영

`packages/kpi/culiver_kpi/config.py`에 `fcr_config_from_params`/`oei_config_from_params`/
`mortality_config_from_params`(+ `_to_params` 라운드트립)를 EI와 동일 패턴으로 추가한다.
`kpi_config.params_json`은 지표별 서브키를 갖는 **단일 버전 문서**로 확장한다(버전은 전 지표 공유):
```jsonc
{
  "ei":        { "included_quality_flags": ["ok"], "min_biomass_delta_kg": 0.0 },
  "fcr":       { "included_quality_flags": ["ok"], "min_biomass_delta_kg": 0.0 },
  "oei":       { "included_quality_flags": ["ok"], "min_biomass_kg": 0.0,
                 "do_band_method": "sample_count", "oei_scale_factor": 1.0, "clamp_max": 100.0 },
  "mortality": { "moving_avg_window_days": 7 }
}
```
스프린트 0의 평면 params(`included_quality_flags`/`min_biomass_delta_kg`)와의 호환은
`ei` 서브키 부재 시 평면 키로 폴백하도록 `ei_config_from_params`에서 흡수한다(마이그레이션 무중단).
산식/계수 보정 시 새 `version` 행 추가 + 단위테스트 갱신(Rule 2). OEI 스케일 보정은 특히 version↑ 필수.

---

## 2. 기준선 잠금(baseline lock) 흐름 계약 — ★ Rule 3 (ADR 0002)

### 2.1 `baselines` 테이블 (MASTER 6장 + 불변성 보강)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | String(64) PK | |
| `site_id` | FK sites | RLS 앵커 |
| `org_id` | FK organizations | **RLS 비정규화**(2.5절 패턴) |
| `period_start` / `period_end` | timestamptz | 기준선 산정 기간 |
| `ei_total` / `ei_aeration` | Float NULL | 잠금 스냅샷 값(None=산출불가 허용) |
| `oei` / `fcr` / `mortality_rate` | Float NULL | 잠금 스냅샷 값 |
| `config_version` | String(32) | ★ 잠금 시점 kpi_config version **고정** |
| `kpi_snapshot_id` | FK kpi_snapshots | 전체 근거(inputs/provenance) 영속 참조 |
| `status` | String(16) | `'draft'`\|`'locked'`. CHECK 제약. Phase 1 lock=locked 직행 |
| `locked_by` | String(64) | JWT user_id |
| `locked_at` | timestamptz | 잠금 시각 |
| `created_at` | timestamptz | |

불변성 강제(ADR 0002, Postgres):
- `BEFORE UPDATE OR DELETE` 트리거: `OLD.status='locked'` → `RAISE EXCEPTION`.
- 부분 유니크: `CREATE UNIQUE INDEX ux_baselines_one_locked ON baselines(site_id) WHERE status='locked'`.
- **수정/삭제 엔드포인트를 만들지 않는다**(API 계약 계층 방어).

### 2.2 상태 전이 (draft → locked)

```
[없음] --POST /baseline/lock--> [locked]   (Phase 1: 원자적 계산+잠금, draft 미영속화)
[locked] --(수정 경로 없음)--> [locked]     (불변; UPDATE/DELETE 는 트리거가 차단)
```
`draft`는 스키마 예약(향후 "미리보기→확정" UX). Phase 1은 lock이 유일한 writer이며 곧바로
`locked`로 삽입한다(가변 baseline 함정 회피). 미리보기가 필요하면 기존 `GET /sites/{id}/kpi`로
같은 기간을 조회해 값을 먼저 확인한다(잠금 없는 read-only).

### 2.3 `POST /sites/{site_id}/baseline/lock` API 계약

요청:
```
POST /sites/{site_id}/baseline/lock
Authorization: Bearer <JWT>          # org_id/role/user_id 클레임
Content-Type: application/json
{ "period": { "from": "2026-04-01T00:00:00Z", "to": "2026-05-01T00:00:00Z" } }
```
권한: `role ∈ {owner, operator}`만 잠금 가능(viewer는 403). deps에서 role 체크 헬퍼 추가.

처리(단일 트랜잭션):
1. 3중 테넌시 방어(deps→RLS→`resolve_site_for_org`) — 스프린트 0 패턴 그대로.
2. 기존 `status='locked'` baseline 조회 → 있으면 **409**(재잠금 금지, 선제 반환).
3. 기간에 대해 EI·OEI·FCR·mortality를 **한 번** 산출(`kpi_service`가 4종 엔진 호출).
4. 산출 결과를 `kpi_snapshots`에 **영속화**(2.4절) → `kpi_snapshot_id` 획득.
5. `baselines` 행 삽입(`status='locked'`, 스냅샷 스칼라값 + config_version + snapshot_id 복사).
6. `audit_logs` 삽입(`action='lock'`, `diff_json={before:null, after:<baseline 요약>}`, Rule 9).
7. 커밋. 경합으로 유니크 위반 발생 시 → 409로 변환.

응답 201 (`BaselineResponse`):
```jsonc
{
  "id": "bsl_...",
  "site_id": "...-site",
  "org_id": "...-org",
  "period": { "from": "...", "to": "...", "granularity": "period" },
  "status": "locked",
  "metrics": {
    "ei_total":       { "value": 4.87, "unit": "kWh/kg", "status": "green" },
    "ei_aeration":    { "value": 2.31, "unit": "kWh/kg", "status": "green" },
    "oei":            { "value": 72.4, "unit": "index",  "status": "green" },
    "fcr":            { "value": 1.42, "unit": "kg/kg",  "status": "green" },
    "mortality_rate": { "value": 6.10, "unit": "%",      "status": "green" }
  },
  "kpi_config": { "version": "2026.1.0" },
  "provenance": { "kpi_snapshot_id": "snap_..." },   // 전체 inputs 는 스냅샷에서 drill-down
  "locked_by": "user_...",
  "locked_at": "2026-07-03T09:00:00Z"
}
```
에러: `401` 인증, `403` viewer/타 org, `404` site 없음, `409` 이미 잠김, `422` 기간 오류.
조회: `GET /sites/{site_id}/baseline`(현재 locked baseline 반환, 없으면 404) — Phase 2 A/B 비교의 입력.

### 2.4 baseline이 담는 스냅샷 (data-kpi-engineer 확인 대상)

baseline은 **잠금 기간의 4종 KPI 스냅샷 스칼라값**(ei_total, ei_aeration, oei, fcr, mortality_rate)과
**그 산출에 쓰인 `config_version`을 고정**한다. 전체 근거(inputs/provenance/시계열)는
`kpi_snapshots`(FK)에 영속화하고 baseline은 요약 스칼라 + snapshot_id만 든다(중복 최소화, drill-down 유지).
→ 잠금 후 kpi_config가 바뀌어도 baseline은 **잠금 당시 version의 값을 영원히 보존**(MRV "Before" 무결성).

---

## 3. MQTT ingestion 파이프라인 계약

목표: `게이트웨이 → MQTT/HTTP → ingestion → 검증/정합/정규화(ADR 0001) → readings 저장`.
**at-least-once**(현장 단절 대비 버퍼링·재전송, MASTER NFR)를 전제로 **멱등** 저장.

### 3.1 표현 규약 소유권 경계 (ingestion vs data-kpi-engineer)

| 판정 | 소유 | 근거 | quality_flag |
|---|---|---|---|
| 스키마/타입 오류, 필수필드 결측 | **ingestion** | 로컬로 판정 가능 | 저장 거부 or `bad` |
| 적산 카운터 롤오버/리셋 | **ingestion** | 직전 reading state 필요 | `suspect`(ADR 0001) |
| 순시 kW 적분 시 결측 간격 | **ingestion** | Δt 판정 | `bad`(보간 금지, ADR 0001) |
| 단위 변환 실패 | **ingestion** | meters.unit 대조 | `bad` |
| 물리 불가능(음수 kWh 등) | **ingestion** | 변환 산출물 검사 | `suspect` |
| **통계적 이상치(분포·N-sigma, 도메인 상한)** | **data-kpi-engineer** | 분포·맥락 필요 | Phase 2 예약 |

경계 원칙: ingestion은 **표현(representation) 계층**의 로컬 판정만 담당해 초기 `quality_flag`를
찍는다. **도메인 통계 이상치**는 data-kpi-engineer의 데이터 정합(QA) 규칙 소관이며, Phase 1은
엔진이 `included_quality_flags`로 오염 데이터를 KPI에서 **배제**하는 것으로 충분(스프린트 0에서
이미 동작). 사후 이상치 스캔(ok→suspect 승격)은 **Phase 2 예약**(과설계 금지).

### 3.2 정규화(ADR 0001) — Phase 1 실제 구현 범위

스프린트 0 시드는 이미 interval kWh였으므로 정규화 로직이 없었다. Phase 1은 공유 서비스
`apps/api/app/services/ingestion.py`에 **표현 변환**을 구현한다(산식 아님, Rule 1 무관):
- `cumulative_kwh` → `Δ(직전 저장 reading)` = interval kWh. 롤오버/리셋 감지 → `suspect`.
- `instant_kw` → `kW × Δt(h)` (사다리꼴). 결측 간격 → `bad`.
- `interval_kwh` → 그대로(검증만).
- 직전 reading state는 `(meter_id)` 기준 최근 저장값 조회로 획득(결정론적: 입력 ts 순서 정렬 후 처리).
- DO/temp 등 비전력 계측은 원값 저장(변환 없음, quality 검증만).

### 3.3 `POST /ingest/readings` (HTTP, API Key) — Phase 1 주력 계약

MQTT 브로커 배선보다 **HTTP 수집을 Phase 1 수용 목표**로 삼는다(결정론적·테스트 용이). MQTT
워커는 동일 `ingestion` 서비스를 감싸는 얇은 소비자(sub-priority).

인증: `X-API-Key: <key>` → `api_keys` 조회 → `org_id`+`site_id` 스코프 확정(토픽/바디의 tenancy 불신).

요청(배치, at-least-once 재전송 안전):
```
POST /ingest/readings
X-API-Key: <gateway key>
{
  "gateway_id": "gw_...",
  "readings": [
    { "meter_id": "mtr_power_main", "ts": "2026-04-01T00:00:00Z",
      "value": 12.5, "reading_kind": "cumulative_kwh", "seq": 10241 },
    { "meter_id": "mtr_do_tank1",   "ts": "2026-04-01T00:00:00Z",
      "value": 6.8,  "reading_kind": "do_mg_l",       "seq": 10242 }
  ]
}
```
멱등 키: `(meter_id, ts)` — `readings` PK와 동일. `ON CONFLICT (meter_id, time) DO NOTHING`으로
재전송 중복을 흡수(at-least-once → 정확히 한 번 저장). `seq`는 롤오버/순서 판정 보조.

응답 200:
```jsonc
{ "accepted": 1, "deduped": 1, "rejected": [
    { "index": 1, "reason": "unknown meter_id or not in api key scope" } ] }
```
에러: `401` API Key 무효, `403` meter가 키 스코프 밖, `422` 배치 스키마 오류(부분 거부는 rejected[]).

### 3.4 MQTT 토픽 규약 (워커; sub-priority)

- 토픽: `culiver/v1/{site_id}/{meter_id}/telemetry` (QoS 1, at-least-once).
- 페이로드: 3.3의 `readings[]` 원소와 동일 JSON. **tenancy는 토픽이 아니라 게이트웨이 인증**으로 확정.
- 워커: 구독 → 3.3과 동일 `ingestion` 서비스 호출 → 멱등 저장. 브로커 미가동 시 HTTP 경로가 대체.

---

## 4. 스키마 확장 계약 (6장 기준, 이번 Phase 필요분만)

마이그레이션 `infra/migrations/versions/0002_phase1_schema.py`(단일 head 유지, downgrade 작성).
**모든 신규 테이블은 `org_id` 비정규화 + RLS 정책**(스프린트 0 `_RLS_TABLES` 확장, 2.3절 패턴).
RLS 정책 문자열·트리거는 Postgres 전용, sqlite는 서비스 재검증으로 격리(기존 관례).

| 테이블 | 핵심 컬럼 | org_id/RLS | 근거 FK | 용도 |
|---|---|---|---|---|
| `users` | id, **org_id**, email, role[owner\|operator\|viewer] | RLS | org_id→organizations | 실 사용자(스프린트0 JWT 클레임→FK 가능). locked_by 참조 |
| `tanks` | id, site_id, **org_id**, name, volume_m3, target_do_min, target_do_max | RLS | site_id→sites | 수조. DO 목표대역(OEI band 근거) |
| `batches` | id, tank_id, **org_id**, species, stocked_count, stocked_at, closed_at | RLS | tank_id→tanks | 입식 사이클. stocked_count(mortality 분모) |
| `feed_logs` | id, batch_id, **org_id**, ts, feed_kg, source[manual\|csv\|device], quality_flag | RLS | batch_id→batches | FCR 분자 |
| `mortality_logs` | id, batch_id, **org_id**, ts, dead_count, cause_note | RLS | batch_id→batches | mortality 분자 |
| `baselines` | (2.1절) | RLS + 트리거 + 부분유니크 | site_id→sites, kpi_snapshot_id→kpi_snapshots | 기준선(불변) |
| `kpi_snapshots` | id, site_id, tank_id?, **org_id**, period_start, period_end, ei_total, ei_aeration, oei, fcr, mortality_rate, config_version, inputs_json, provenance_json, generated_at | RLS | site_id→sites | 산출 결과 영속(불변 append-only) |
| `api_keys` | id, **org_id**, site_id, key_hash, label, revoked, created_at | RLS | site_id→sites | ingestion 인증(3.3). 원문 저장 금지(해시) |

주석:
- `harvest_logs.batch_id`(nullable, 스프린트0)는 이제 `batches.id` FK로 연결 가능(마이그레이션에서 FK 추가; 기존 site 단위 행은 nullable 유지).
- `readings`에 `do_mg_l`용 별도 컬럼을 만들지 않는다 — DO도 `value`(원값 mg/L) + `meters.type='do'`로 저장(스키마 단순 유지). KPI 서비스가 type으로 분기해 `DoReading`/`PowerReading` 조립.
- `kpi_snapshots.inputs_json`/`provenance_json`은 엔진 결과의 근거 필드(3종 각각)를 그대로 직렬화 → 리포트 drill-down(MASTER 3.3/7장) 재현성. **append-only**(수정 안 함).
- `api_keys`는 ingestion 슬라이스에서만 필요 → ingestion을 안 하는 슬라이스에서는 생성 유보 가능(마이그레이션은 함께 두되 사용은 슬라이스별).

### 4.1 `kpi_snapshots` 영속화 지점 (sprint-0의 null 채우기)

스프린트 0에서 `provenance.kpi_snapshot_id`가 항상 `null`이었다. Phase 1 writer:
- **baseline lock**(2.3절 4단계): 잠금 기간 스냅샷을 저장 → baseline이 참조.
- **worker 일일 배치**(APScheduler, 5절 슬라이스): 사이트별 전일 KPI를 스냅샷으로 적재.
- `GET /sites/{id}/kpi`는 **read-only live 계산 유지**(비용 낮은 조회). 영속 스냅샷 조회가 필요한
  화면은 별도 `GET /sites/{id}/kpi-snapshots?from&to`(Phase 2 대시보드)로 분리 — 이번엔 예약.
  → GET /kpi의 snapshot_id는 여전히 null 가능(live), 영속화가 필요한 경로(lock/worker)에서만 채운다.

---

## 5. 수직 슬라이스 분해 + 위임 + 우선순위

각 슬라이스는 **DB→엔진→API→(UI)를 관통**하는 최소 기능이며, **수용 기준**과 **MASTER 11장 증빙**,
**FE/BE/KPI/QA 위임 대상**을 갖는다. 우선순위는 **협약기간 내 START·PRO 우선**(과설계 금지)으로 매긴다.

> **Phase 1 정의 산출물 = 기준선 잠금**(MASTER 10). 잠금은 4종 KPI + 스냅샷 영속화에 의존한다.
> 따라서 임계 경로는 **엔진 v1 완성 → 스냅샷 영속화 → 잠금**. 수기입력 기반 지표(FCR/mortality)는
> ingestion 정규화에 의존하지 않아 잠금을 가장 빨리 여는 길이므로 먼저 둔다. OEI는 제안 산식
> 보정 리스크 + DO 데이터 의존이 있어 후순위, 실 ingestion 정규화(MQTT)는 그 다음이다.

### 슬라이스 S0 — 스키마 확장 (선행 전제, P0)
- 내용: `0002_phase1_schema` 마이그레이션(4절 8개 테이블) + ORM 모델 + RLS/트리거/부분유니크.
- 수용: `make migrate` up/down 성공, RLS 정책·baseline 트리거·부분유니크 생성 확인,
  신규 테이블 org 스코프 누수 테스트(타 org 접근 403/404) green(Rule 4).
- 증빙(11장): "통합 관리 대시보드" 데이터 흐름도 골격 / "도입 패키지" 격리 신뢰성.
- 위임: **backend-engineer**(모델·마이그레이션), **qa-reviewer**(누수 테스트 게이트).

### 슬라이스 A — FCR 끝까지 (P0)
- 내용: `compute_fcr`+테스트 → `kpi_service`가 feed_logs/harvest 조립·호출 → `GET /kpi` `metrics.fcr` 채움 → FE FCR 카드.
- 수용: 시드 feed_logs 합/Δbiomass = 카드 FCR 값 일치, biomass_delta<=0 → value=null("산출 불가"),
  경계 단위테스트 전부 green, provenance.source_feed_refs 역추적 가능.
- 증빙(11장): "통합 관리 대시보드"(카드) / "현장 재현성"(테스트 고정).
- 위임: **data-kpi-engineer**(A-KPI: compute_fcr+config+테스트), **backend-engineer**(A-BE: 서비스 조립+엔드포인트 테스트), **frontend-engineer**(A-FE: KpiCard 재사용), **qa-reviewer**(관통 일관성).

### 슬라이스 B — Mortality 끝까지 (P0)
- 내용: `compute_mortality`+테스트 → 서비스가 mortality_logs+batches.stocked_count 조립 → `metrics.mortality_rate` → FE 카드(+누적/일일/7일 MA는 응답 확장 필드로 반환, 카드는 누적률 표시).
- 수용: 누적률=Σdead/stocked*100 일치, stocked=0 → null, 7일 MA 결정론 확인, 경계 테스트 green.
- 증빙(11장): "통합 관리 대시보드" / 규제훅(MASTER 9장 폐사 조기경보 데이터 기반).
- 위임: **data-kpi-engineer**, **backend-engineer**, **frontend-engineer**, **qa-reviewer**.

### 슬라이스 C — 기준선 잠금 끝까지 (P0, ★ Phase 1 헤드라인)
- 선행: S0, A, B, D(4종 스냅샷 필요) + 스냅샷 영속화.
- 내용: `kpi_snapshots` 영속화 헬퍼 → `POST /baseline/lock`(2.3절) → 불변성(ADR 0002) → audit_logs → FE "기준선 확정/잠금" 설정 화면(MASTER 화면 15).
- 수용: 잠금 201 + 4종 값 + snapshot_id, 재잠금 409, 잠금 후 UPDATE/DELETE 트리거 차단(테스트),
  viewer 403, audit_logs 1행(diff before=null), config_version 고정 확인, 누수 테스트 green.
- 증빙(11장): "탄소저감 성과 리포트(MRV)"의 **Before 기준** 확보 / "현장 재현성"(불변·추적).
- 위임: **backend-engineer**(엔드포인트·트리거·감사), **data-kpi-engineer**(스냅샷 구성 확인, ADR 0002/2.4 합의), **frontend-engineer**(잠금 UI·확인 다이얼로그), **qa-reviewer**(불변성·409·권한 게이트).

### 슬라이스 D — OEI 끝까지 (P1)
- 선행: S0(tanks DO band) + **ADR 0003 Accepted**(data-kpi-engineer 합의).
- 내용: `compute_oei`+테스트 → 서비스가 DO readings(type='do')+aeration readings+tank band 조립 → `metrics.oei` → FE 카드.
- 수용: do_in_band_fraction·oei_raw·scale_factor 근거 노출, 경계(None) 전부 테스트, band 역전→ValueError, 스케일 계수 보정 시 version↑ 절차 문서화.
- 증빙(11장): "통합 관리 대시보드" / MRV 산식·가정 명시(제안 산식+버전 추적).
- 위임: **data-kpi-engineer**(★ADR 0003 확정 후 산식), **backend-engineer**, **frontend-engineer**, **qa-reviewer**.

### 슬라이스 E — Ingestion 파이프라인 (P1, "데이터 파이프라인" 산출물)
- 내용: `api_keys` + `ingestion.py`(정규화 3.2) + `POST /ingest/readings`(3.3) [+ MQTT 워커 3.4, sub].
- 수용: cumulative→interval/instant→interval 변환 단위테스트, 롤오버→suspect/결측→bad 판정,
  `(meter_id,ts)` 재전송 멱등(중복 삽입 0), API Key 스코프 밖 meter 403/rejected, 비전력 원값 저장.
- 증빙(11장): "통합 관리 대시보드" 데이터 흐름도 / "현장 재현성"(at-least-once NFR).
- 위임: **backend-engineer**(ingestion·엔드포인트·워커), **data-kpi-engineer**(quality_flag 판정 경계 확인, 3.1절), **qa-reviewer**(멱등·격리).

### 슬라이스 F — KPI 스냅샷 일일 배치 (P2, C 이후 여유 시)
- 내용: worker(APScheduler)에서 사이트별 전일 KPI를 `kpi_snapshots`로 적재(4.1절).
- 수용: 결정론적 재실행 멱등(같은 기간 중복 스냅샷 안 만듦 or 덮어쓰기 규칙), org 스코프 유지.
- 증빙(11장): "현장 재현성" / Phase 2 대시보드 시계열의 데이터 소스.
- 위임: **backend-engineer**, **qa-reviewer**. (여유 없으면 Phase 2 초로 이월 가능.)

### 5.1 우선순위 요약 (실행 순서)

```
P0 (임계 경로, 기준선 잠금까지): S0 → A(FCR) ∥ B(Mortality) → C 준비
P1 (Phase 1 필수, 병행):        D(OEI, ADR0003 후) → E(Ingestion HTTP; MQTT sub)
P0 마무리:                       C(Baseline Lock)  ← A·B·D·스냅샷영속화 완료 후
P2 (여유):                       F(일일 스냅샷 배치)
```
- 병행 가능: A와 B는 서로 독립(다른 테이블/엔진) → 동시 위임. D는 ADR 0003 합의가 게이트.
- **C(잠금)는 A·B·D 4종 스냅샷이 모두 산출 가능해야 의미**가 있으므로 P0이되 실행은 마지막.
  단, OEI 보정 리스크로 D가 지연되면 **잠금을 EI/FCR/mortality 3종으로 먼저 열고 OEI는 후속
  재잠금 없이 스냅샷에 추가**하는 것은 Rule 3 위반(재잠금 금지)이므로 **금지** → D를 C 이전에 완료한다.
  (부득이 OEI 미완이면 잠금 자체를 D 완료까지 보류. 사용자 합의 필요 시 에스컬레이션.)

---

## 6. 결정 기록(ADR) 현황

- **ADR 0001**(Accepted): 전력 readings = interval kWh 정규화. Phase 1 ingestion(3.2)이 이를 구현.
- **ADR 0002**(Proposed): 기준선 잠금 불변성 강제(엔드포인트 부재+트리거+부분유니크). C 착수 전
  data-kpi-engineer가 스냅샷 구성(2.4) 확인 후 Accepted 전환.
- **ADR 0003**(Proposed, ★합의 필수): OEI DO 유지율 산정 규약(개수 비율 v1, 스케일 계수 외부화).
  **data-kpi-engineer가 Accepted로 전환한 뒤에만** `compute_oei` 구현 착수(D 게이트).
- 스택 변경 없음 → 추가 ADR 불요. 두 ADR 모두 확정 스택 내 **규약/불변식** 결정(ADR 0001 선례와 동일 성격).

## 7. 위임 요약 (오케스트레이터용)

1. **선행**: `data-kpi-engineer` ADR 0002·0003 검토·합의. **ADR 0003 합의가 OEI(D)의 게이트**.
2. **P0 병행 착수**: `backend-engineer` S0(스키마) → 완료 후 A/B의 BE 조립. `data-kpi-engineer`
   A-KPI(compute_fcr)·B-KPI(compute_mortality) 동시. `frontend-engineer` A/B 카드(KpiCard 재사용).
3. **P1**: ADR 0003 Accepted 후 D(OEI) 착수. E(ingestion HTTP) 병행.
4. **P0 마무리**: A·B·D·스냅샷영속화 green → C(baseline lock) 통합.
5. 각 슬라이스 통합 후 `qa-reviewer` 게이트(수용 기준+누수+불변성) → 통과 시에만 머지(Rule 10).
- 계약(1~4절 시그니처·스키마·API)은 architect가 못 박았다. 구현자는 임의 변경 금지 —
  변경 필요 시 architect·(산식이면)data-kpi-engineer에 되돌려 합의한다.
</content>
