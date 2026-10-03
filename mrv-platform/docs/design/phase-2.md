# Phase 2 설계 노트 — 기술 구현·1차 실증 (대시보드 MVP·알림·추천 보드·A/B 비교)

- 작성: architect
- 날짜: 2026-07-07
- 기준 문서: `00_개발의뢰서_MASTER.md`(SSOT) 3장/4장/6장/10장, `CLAUDE.md`(운영 규칙)
- 선행 계약: `docs/design/sprint-0.md`, `docs/design/phase-1.md`(EI/FCR/OEI/mortality 엔진,
  `GET /sites/{id}/kpi`, baseline lock, ingestion 계약 — 이번 문서가 그대로 재사용)
- 선행 ADR: `0001`(전력 표현), `0002`(baseline 불변성), `0003`(OEI DO 유지율) — 모두 Accepted
- 신규 ADR: 없음(스택 변경 없음). 필요 시 하단 "결정 기록"에 사유 명시.

> **이 문서의 목적**: Phase 2의 **인터페이스/계약을 못 박는 것**. 대규모 구현은 하지 않는다.
> KPI/신호등/추천 로직의 **산식·판정 규칙**은 `data-kpi-engineer` 소관이다(Rule 1).
> architect는 API 시그니처·스키마·테이블 계약과 소유권 경계만 확정한다.

---

## 0. Phase 2 범위 확정 (MASTER 10장 인용)

> **Phase 2 (중기, 6~8월) — 기술 구현·1차 실증**: 대시보드·추천·비교실험
> 결과물: START 대시보드 MVP, 알림, 추천 보드(PRO), A/B 비교, 1차 실증 튜닝

현재 구현 상태(위 "선행 계약" 확인 완료): EI/FCR/OEI/mortality 4종 엔진 + `GET /sites/{id}/kpi`,
baseline 잠금/조회, ingestion(HTTP+MQTT), 대시보드 셸(카드 5개 + 더미 전력 시계열 1개), 급이/폐사
수기입력, 기준선 잠금 화면이 **이미 있다**. Phase 2는 이 위에 다음 4개 수직 슬라이스를 얹는다:

1. **알림(Alert)**: 임계치 배치 평가 → `alerts` 삽입 → 알림 센터 화면(START, 화면5).
2. **추천(Recipe) 보드**: 룰 기반 추천 산출(**data-kpi-engineer 소관**) → 추천 보드 화면(PRO, 화면7).
3. **전·후(A/B) 비교**: 잠긴 baseline vs 현재 기간 KPI 비교(PRO, 화면9 축소판 — 화면10 MRV는 Phase 3).
4. **대시보드 확장**: 더미 시계열 → 실 readings 조회 API로 교체(START, 화면3).

**과설계 금지 원칙(재확인)**:
- 알림은 **실시간 스트림 처리가 아니라 주기 배치**(Phase 1 kpi_snapshots 배치 패턴 재사용).
- 추천은 **표시까지만**(승인→적용→결과 로그의 `control_actions`/승인 게이트는 ENTERPRISE, Phase 3).
- A/B 비교는 **KPI 차이 비교까지만**(Scope2 감축량 환산은 Phase 3 MRV, `emission_factors` 미착수).
- continuous aggregate 등 TimescaleDB 고급 기능은 NFR(<2초) 미달이 실측으로 확인되기 전엔 손대지 않는다.

---

## 1. 알림(Alert) 계약

### 1.1 `alerts` 테이블 (MASTER 6장 그대로 + RLS 보강)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | String(64) PK | `alert-{uuid4}` |
| `site_id` | FK sites | RLS 앵커 |
| `org_id` | FK organizations | **RLS 비정규화**(Phase 1 패턴 그대로) |
| `type` | String(32) | `'do_low'`\|`'mortality_spike'`\|`'kpi_red'` (1.2절 3종. CHECK 제약) |
| `severity` | String(16) | `'info'`\|`'warning'`\|`'critical'`. CHECK 제약 |
| `payload_json` | JSON | 판정 근거(트리거값·임계값·source refs — drill-down) |
| `status` | String(16) | `'open'`\|`'ack'`. CHECK 제약. 기본 `'open'` |
| `created_at` | timestamptz | 배치 평가 시각(append-only, 결정론 무관 메타데이터) |
| `acked_by` | String(64) NULL | ack 처리자(user_id) |
| `acked_at` | timestamptz NULL | ack 처리 시각 |

`alerts`는 **append-only + status 전이(open→ack)만** 허용(baseline처럼 물리적 불변까지는 과설계 —
ack는 감사 대상 상태 변경일 뿐 "산출값" 수정이 아니므로 트리거 방어 불요). `status` 변경은
반드시 `audit_logs`에 diff 기록(Rule 9).

### 1.2 임계치 규칙 소스 — 최소안: `kpi_config`에 서브키 추가 (별도 `alert_rules` 테이블 불요)

**결정**: 과설계 금지 원칙에 따라 이번 Phase는 **별도 `alert_rules` 테이블을 만들지 않는다**.
Phase 1에서 이미 `kpi_config.params_json`이 지표별 서브키(`ei`/`fcr`/`oei`/`mortality`)를 갖는
**단일 버전 문서** 패턴을 확립했으므로, 알림 임계치도 같은 문서에 `alerting` 서브키로 추가한다.

이유:
- 알림 규칙은 site별로 다변화할 필요가 아직 없다(파일럿 1~2곳, 협약기간 우선).
- `kpi_config`는 이미 버전 관리·감사 가능한 파라미터 저장소이므로 재사용이 최소 변경.
- site별 커스터마이징이 실증에서 필요해지면 그때 `alert_rules(site_id, params_json)`로
  분리한다(그 시점 ADR 또는 설계 갱신 — 지금은 예약만 하고 만들지 않는다).

```jsonc
// kpi_config.params_json 확장(Phase 1 문서 구조에 서브키 추가)
{
  "ei": { ... }, "fcr": { ... }, "oei": { ... }, "mortality": { ... },
  "alerting": {
    "do_low_mg_l": 3.0,              // DO 순간값이 이 미만이면 'do_low' (tanks.target_do_min 미달과는 별개 즉시성 신호)
    "mortality_spike_ratio": 2.0,    // 당일 dead_count가 7일 이동평균의 N배 초과 시 'mortality_spike'
    "mortality_spike_min_count": 5,  // ratio 조건과 AND — 소량 변동의 과민 알림 방지(최소 개체수 하한)
    "kpi_red_metrics": ["ei_total", "fcr", "mortality_rate", "oei"]  // 신호등 red 감시 대상
  }
}
```
→ `AlertingConfig` dataclass(+ `alerting_config_from_params`/`_to_params`)는 **data-kpi-engineer**가
Phase 1 4종과 동일 패턴으로 `packages/kpi/culiver_kpi/config.py`에 추가한다(Rule 2: 버전 증가 필요).

### 1.3 대상 트리거 3종 (범위 제한, MASTER 화면5 인용)

| type | 판정 데이터 | 판정 규칙 소유권 | 배치 평가 방식 |
|---|---|---|---|
| `do_low` | `readings`(meter.type='do', 최신값) | **data-kpi-engineer**(임계 판정 함수) | 최근 평가 윈도 내 최신 유효 DO 샘플 < `alerting.do_low_mg_l` |
| `mortality_spike` | `mortality_logs`(당일) + 기존 `MortalityResult.moving_avg` | **data-kpi-engineer** | 당일 dead_count > `moving_avg_ratio` × 7일 MA **and** ≥ `min_count` |
| `kpi_red` | `GET /sites/{id}/kpi` 산출 결과(신호등) | **data-kpi-engineer**(★아래 1.4 신호등 판정 자체가 신규 산식) | `kpi_red_metrics` 중 하나라도 `status='red'`로 전환 시 |

이 표는 **"무엇을 감시하는가"의 범위만 architect가 확정**한 것이고, "언제 red인가/언제 급증인가"의
수치 판정 로직은 산식이므로 architect가 작성하지 않는다(Rule 1 경계, 아래 1.4).

### 1.4 ★ 신호등(status) red/amber 판정 로직 — 신규 산식, data-kpi-engineer 소관

Phase 1 `_metric()`(`apps/api/app/services/kpi_service.py`)은 현재 `value 있음→green`,
`value=null→na`만 처리하고 **red/amber 판정 로직이 아직 없다**(설계 문서 sprint-0/phase-1에
명시된 대로 "임계 로직은 Phase 2"로 예약되어 있었음). 알림의 `kpi_red` 트리거는 이 판정에
의존하므로, Phase 2는 이 갭을 메운다:

- **architect가 넘겨준 것**: 판정에 필요한 입력 계약뿐 — 지표값, 방향(낮을수록 좋음/높을수록
  좋음), `kpi_config.alerting`(또는 지표별 서브키)의 임계 파라미터 자리.
- **data-kpi-engineer가 결정할 것**: red/amber/green 경계값을 산식 결과에 얹는 함수
  (예: `packages/kpi/culiver_kpi/status.py`의 `classify_metric_status(value, direction, thresholds) ->
  KpiMetricStatus`, 시그니처는 제안일 뿐 확정 아님). 어느 지표에 무슨 절대/상대 임계를 쓸지
  (예: FCR > 1.6 → red, OEI < 50 → red 등)는 MASTER 3.2 도메인 근거(1.1절 평균값)를 참고해
  data-kpi-engineer가 `kpi_config` 버전을 올려 확정한다(Rule 2).
- **경계**: architect는 "판정 함수가 `kpi_service._metric()`에서 호출되어 `KpiMetric.status`를
  채운다"는 **통합 지점**만 못 박는다. 즉 `kpi_service._metric(value, unit, config)`로 시그니처가
  확장되고, status 계산은 여전히 `culiver_kpi`(Rule 1 위치) 안에서 이뤄진다.
- 이 판정 로직이 확정되어야 `kpi_red` 알림 배치가 의미를 갖는다 — **알림 슬라이스의 게이트**.

### 1.5 평가 방식 — 주기 배치(APScheduler), Phase 1 스냅샷 배치 패턴 재사용

Phase 1 문서(5절 슬라이스 F)가 예약해 둔 "일일 스냅샷 배치"와 같은 worker 프로세스에
알림 평가 잡을 추가한다(신규 워커 프로세스 도입 없음, 과설계 금지).

```
apps/api/app/worker/jobs.py
  - job_snapshot_daily_kpi()      (Phase 1 F, 이미 예약)
  - job_evaluate_alerts()         (Phase 2 신규)
      for site in sites:
          latest_do = load latest 'ok' DO reading per tank
          if classify_do_low(latest_do, cfg.alerting): insert alerts(type='do_low', ...)
          mortality_result = compute_mortality(...)  # 기존 엔진 재사용, 새 산식 아님
          if classify_mortality_spike(mortality_result, cfg.alerting): insert alerts(...)
          kpi = compute_site_kpi_results(...)          # 기존 엔진 재사용
          for m in cfg.alerting.kpi_red_metrics:
              if classify_metric_status(...) == 'red' and no-open-duplicate:
                  insert alerts(type='kpi_red', ...)
```
- 평가 주기: 배치 간격은 운영 파라미터(예: 15분)로 `worker` 설정에 둔다. 산식이 아니므로
  코드 상수/`.env`로 관리해도 무방(Rule 2 대상 아님).
- **중복 억제**: 같은 `(site_id, type)`에 대해 이미 `status='open'`인 alert가 있으면 재삽입하지
  않는다(알림 폭주 방지, 최소 규칙). 세분화된 dedup 정책(쿨다운 시간 등)은 실증 튜닝 대상으로
  예약하고 이번엔 "open 중복 금지"만 구현.

### 1.6 API 계약

```
GET /sites/{site_id}/alerts?status=open|ack|all&limit=&offset=
Authorization: Bearer <JWT>
```
응답 200:
```jsonc
{
  "site_id": "...-site",
  "org_id": "...-org",
  "items": [
    {
      "id": "alert-...",
      "type": "kpi_red",
      "severity": "critical",
      "payload": { "metric": "fcr", "value": 1.72, "threshold": 1.6, "config_version": "2026.2.0" },
      "status": "open",
      "created_at": "...",
      "acked_by": null,
      "acked_at": null
    }
  ],
  "total": 1
}
```
```
POST /alerts/{id}/ack
Authorization: Bearer <JWT>   # require_writer(owner/operator), Phase 1 deps.py 재사용
```
응답 200: ack 반영된 alert 1건(위와 동일 shape, status='ack'). 처리:
1. 3중 테넌시 방어(Phase 1 패턴) — alert가 auth.org_id 소속인지 확인, 아니면 404.
2. 이미 `ack`면 idempotent하게 200(변경 없음) 반환 — 에러 아님(재클릭 안전).
3. `status='ack'`, `acked_by`/`acked_at` 갱신 + `audit_logs`(`action='ack'`,
   `diff={before:{status:'open'}, after:{status:'ack'}}`, Rule 9).

에러: `401` 인증, `403` viewer가 ack 시도, `404` site/alert 없음 또는 타 org.

### 1.7 알림 구독 설정 (화면5 하단, 최소 계약)

채널(이메일/SMS 등)은 이번 범위 밖(MASTER 화면5 "구독 설정"의 채널 확장은 Phase 3 이후).
이번엔 **on/off 스위치만**:

```
organizations 또는 users 테이블에 alert_subscriptions_json 컬럼 추가는 과설계
→ 최소안: sites 테이블에 alert_enabled_types (예: {"do_low": true, "mortality_spike": true,
  "kpi_red": true}) 컬럼 하나만 추가(JSON). 채널 없음 = 앱 내 알림 센터 표시 여부 스위치.
```
```
PATCH /sites/{site_id}/alert-subscriptions
{ "do_low": true, "mortality_spike": false, "kpi_red": true }
```
응답 200: 갱신된 스위치 상태. `require_writer` 게이트, `audit_logs` 기록(Rule 9).
평가 배치(1.5절)는 이 스위치가 꺼진 type은 alert를 아예 생성하지 않는다(off된 항목은
알림센터에도 나타나지 않도록 생성 단계에서 차단 — 조회 필터링보다 단순).

---

## 2. 추천(운전 레시피) 계약

### 2.1 `recipes`/`recipe_versions` 테이블 (MASTER 6장 그대로)

| 테이블 | 컬럼 | 비고 |
|---|---|---|
| `recipes` | id, site_id, **org_id**(RLS), type[`feed`\|`oxygen`\|`circulation`], current_version, created_at | site당 type별 최대 1행(유니크 `(site_id, type)`) |
| `recipe_versions` | id, recipe_id, version(int, 1부터 증가), params_json, rationale(text), created_by, created_at | append-only. `current_version`은 recipes가 가리키는 최신 버전 번호 |

`recipe_versions`는 baseline과 달리 **버전이 늘어나는 것 자체가 정상 동작**(잠금 개념 없음,
매 추천 산출마다 새 버전). 과거 버전은 불변(append-only)이지만 "최신 추천"은 계속 바뀐다.

### 2.2 소유권 — ★ 추천 산출 로직은 `data-kpi-engineer` 소관

MASTER는 data-kpi-engineer의 책무로 "추천(운전 레시피) 로직"을 명시한다(에이전트 정의).
**architect는 추천 규칙(임계값·산식·근거 문구 생성 로직)을 작성하지 않는다.** 이 절은
data-kpi-engineer가 구현할 함수의 **입출력 계약(제안 시그니처)** 만 못 박는다 — Phase 1의
`compute_ei` 패턴(순수 함수, frozen dataclass, drill-down 근거 필드, config_version)을 그대로
따른다.

```python
# packages/kpi/culiver_kpi/recommend.py — 시그니처 제안(구현/세부 판정: data-kpi-engineer)

@dataclass(frozen=True)
class RecommendationInput:
    """추천 산출에 필요한 현재 상태(서비스가 조립; 산식은 여기 없음)."""
    do_latest: DoReading | None            # 현재 DO(최신 유효 샘플)
    do_band: DoBand                        # tanks.target_do_min/max
    water_temp_latest: float | None        # 현재 수온(meters.type='temp')
    biomass_latest_kg: float | None        # 최근 harvest_logs 기준 생체량
    feed_history: Sequence[FeedReading]    # 최근 N일 급이 이력(FCR 추세 참고)
    aeration_power_recent_kwh: float       # 최근 폭기 전력(OEI 추세 참고)
    period_start: datetime
    period_end: datetime

@dataclass(frozen=True)
class RecommendationOutput:
    feed_kg_per_day: float | None          # 급이 추천값(kg/일). None=추천 불가(근거 부족)
    oxygen_target_do_mg_l: float | None    # 산소(DO 목표) 추천값
    circulation_setting: str | None        # 순환 추천(예: 'normal'|'increase'|'reduce') — 열거형은 data-kpi-engineer 확정
    rationale: str                         # 근거 설명(사람이 읽는 텍스트, 감사용)
    source_refs: dict[str, tuple[str, ...]]  # 근거 drill-down(지표별 참조 ID)
    config_version: str

def compute_recommendation(
    inputs: RecommendationInput,
    config: RecommendConfig,     # 산식 파라미터(kpi_config 서브키 'recommend', data-kpi-engineer 확정)
    config_version: str,
) -> RecommendationOutput:
    """급이·산소·순환 룰 기반 추천(MASTER 3.2 하단 "추천 로직"). 순수·결정론.
    세부 규칙(어떤 조건에 어떤 값을 권장하는지)은 data-kpi-engineer가 확정한다.
    architect는 입출력 형태와 소유권만 못 박는다.
    """
    ...  # 구현: data-kpi-engineer
```

`RecommendConfig`는 `kpi_config.params_json`에 `recommend` 서브키로 추가(Phase 1 4종과 동일
패턴, Rule 2 버전 증가). architect는 이 서브키의 **존재와 위치**만 못 박고 내부 파라미터
설계는 data-kpi-engineer에 위임한다.

### 2.3 API 계약

```
GET /sites/{site_id}/recommendations
Authorization: Bearer <JWT>
```
권한: **PRO 이상만 접근**(2.4절 플랜 게이팅). 응답 200:
```jsonc
{
  "site_id": "...-site",
  "items": [
    {
      "type": "feed",
      "recipe_id": "recipe-...",
      "current_version": 12,
      "params": { "feed_kg_per_day": 48.5 },
      "rationale": "최근 7일 FCR 추세 및 생체량 기준 급이량 3% 상향 권장",
      "config_version": "2026.2.0",
      "generated_at": "..."
    },
    { "type": "oxygen", ... },
    { "type": "circulation", ... }
  ],
  "status": "recommend_only"   // 이번 Phase 고정값. 승인/적용 상태는 Phase 3(ENTERPRISE)
}
```
이 엔드포인트는 **read-only 라이브 계산**(Phase 1 `GET /kpi`와 동일 패턴) — 호출 시마다
`compute_recommendation`을 실행하고, 결과를 `recipe_versions`에 새 버전으로 **영속화**한다
(추천 이력 자체가 MASTER 11장 "룰셋/버전이력" 증빙이므로 append 필요; 매 GET마다 무한정
버전이 쌓이지 않도록 "동일 입력 파라미터 해시가 직전 버전과 같으면 새 버전 생성 생략" 규칙을
서비스 계층에 둔다 — 이건 저장 최적화이지 산식이 아니다).

```
POST /recipes/{id}/versions
Authorization: Bearer <JWT>   # require_writer
{ "params": {...}, "rationale": "..." }   # 수동으로 새 버전을 강제 생성(운영자 수기 조정)
```
응답 201: 새 `recipe_versions` 행. `current_version` 갱신 + `audit_logs` 기록(Rule 9).
**"적용" 개념 없음** — 이번 Phase는 추천값 생성·조회·수동 버전 추가까지만. 실제 설비 적용
(`control_actions`, 승인 게이트, 이중 확인)은 MASTER 화면11 "승인형 제어 콘솔"로 Phase 3
(ENTERPRISE) 범위임을 재확인.

### 2.4 PRO 플랜 게이팅

- **API**: 추천 라우터에 `require_plan("PRO")` 의존성 추가(신규, `deps.py`에 위치 —
  `organizations.plan`을 세션에서 조회해 `{"PRO","ENTERPRISE"}`가 아니면 403).
  START는 `GET /sites/{id}/recommendations`, `POST /recipes/{id}/versions` **양쪽 다 403**.
- **FE**: `useAuth`(또는 site/org 컨텍스트)에 `plan` 노출 → 추천 보드 라우트/네비게이션 항목을
  START 플랜에서 숨김(메뉴 비노출) + 직접 URL 접근 시에도 API 403을 받아 안내 화면 표시
  (백엔드가 최종 방어선, FE는 UX용 — Rule 4 원칙과 동일하게 이중 방어).
- 알림(1절)은 START/PRO 공통(화면5는 START에도 있음) — 게이팅 대상 아님.

---

## 3. 전·후(A/B) 비교 계약

### 3.1 경계: "산식"이 아니라 "표시 로직" — 명확화

비교 계산(`current - baseline`, `(baseline-current)/baseline*100`)은 **이미 확정된 두 값의
단순 산술**이며 새로운 도메인 지식/보정 계수를 도입하지 않는다. 따라서 이는:
- **산식 신규 정의 아님**(Rule 1의 "KPI/MRV 산식"에 해당 안 함) → `packages/kpi`에 새 산식
  함수를 만들 필요 없음.
- 그러나 **"차이/개선율을 어떻게 계산하는가"(지표별 방향성: 낮을수록 좋음 vs 높을수록 좋음에
  따라 부호를 다르게 표시)는 도메인 의미가 있으므로**, 계산 함수는 `packages/kpi`에 **얇은
  유틸리티**로 두어 향후 MRV 감축량 계산(Phase 3)과 일관된 위치에서 재사용 가능하게 한다.
  이 유틸리티는 산식이 아니라 "이미 산출된 두 값의 비교 표시 규칙"이므로 architect가
  시그니처를 못 박고, **data-kpi-engineer 확인만 받는다**(구현은 backend-engineer도 가능 —
  단순 산술이기 때문. 다만 위치는 `packages/kpi`로 고정해 중복 방지).

```python
# packages/kpi/culiver_kpi/comparison.py — 제안 (구현: backend-engineer, data-kpi-engineer 확인)

@dataclass(frozen=True)
class MetricComparison:
    baseline_value: float | None
    current_value: float | None
    delta: float | None              # current - baseline. 어느 한쪽 None이면 None
    improvement_pct: float | None    # 방향 보정 개선율(%). None 조건 동일
    direction: str                   # 'lower_is_better' | 'higher_is_better'

def compare_metric(
    baseline_value: float | None,
    current_value: float | None,
    direction: str,
) -> MetricComparison:
    """단순 산술 비교(산식 아님). None 전파, 결정론.
    lower_is_better: improvement_pct = (baseline-current)/baseline*100
    higher_is_better: improvement_pct = (current-baseline)/baseline*100
    baseline_value<=0 또는 둘 중 하나 None → improvement_pct=None(0 나눗셈 방지).
    """
```
지표별 `direction`은 MASTER 3.2에서 이미 확정(EI/FCR/mortality=lower_is_better,
OEI=higher_is_better) — 새 판단이 아니라 기존 산식 정의의 재인용이므로 이 상수 테이블은
architect가 명시해도 Rule 1 위반 아님:
```python
METRIC_DIRECTION = {
    "ei_total": "lower_is_better", "ei_aeration": "lower_is_better",
    "oei": "higher_is_better", "fcr": "lower_is_better",
    "mortality_rate": "lower_is_better",
}
```

### 3.2 API 계약

```
GET /sites/{site_id}/comparison?compare_from&compare_to
Authorization: Bearer <JWT>
```
권한: **PRO 이상**(화면9는 PRO). baseline은 이미 잠긴 것을 사용(`GET /sites/{id}/baseline` 404
이면 이 API도 `404 detail="baseline not locked"` — 비교 불가 상태 명시).

응답 200:
```jsonc
{
  "site_id": "...-site",
  "baseline": {
    "period": { "from": "...", "to": "..." },
    "config_version": "2026.1.0",
    "metrics": { "ei_total": 4.87, "ei_aeration": 2.31, "oei": 72.4, "fcr": 1.42, "mortality_rate": 6.10 }
  },
  "current": {
    "period": { "from": "2026-07-01T00:00:00Z", "to": "2026-07-31T23:59:59Z" },
    "config_version": "2026.2.0",
    "metrics": { "ei_total": 4.10, "ei_aeration": 1.95, "oei": 78.9, "fcr": 1.35, "mortality_rate": 4.80 }
  },
  "comparison": {
    "ei_total":       { "delta": -0.77, "improvement_pct": 15.8, "direction": "lower_is_better" },
    "ei_aeration":    { "delta": -0.36, "improvement_pct": 15.6, "direction": "lower_is_better" },
    "oei":            { "delta": 6.5,  "improvement_pct": 9.0,  "direction": "higher_is_better" },
    "fcr":            { "delta": -0.07, "improvement_pct": 4.9, "direction": "lower_is_better" },
    "mortality_rate": { "delta": -1.30, "improvement_pct": 21.3, "direction": "lower_is_better" }
  },
  "provenance": {
    "baseline_id": "bsl-...",
    "current_kpi_snapshot_id": null   // current 는 live 계산(Phase 1 GET /kpi와 동일 관례); 필요 시 스냅샷 조회로 대체 가능
  }
}
```
처리: baseline은 `baselines` 테이블에서 조회(config_version 포함 잠금 당시 값 그대로,
재계산 안 함 — ADR 0002 불변성), current는 `compute_site_kpi_results`를 **그대로 재사용**해
`[compare_from, compare_to)` 기간을 라이브 산출(신규 엔진 불요). `compare_metric()`으로 5개
지표를 매핑. `config_version`이 baseline과 current에서 다를 수 있음을 응답에 그대로 노출해
"동일 산식 버전 비교가 아닐 수 있음"을 투명하게 드러낸다(재현성 NFR — 버전 차이를 숨기지
않는 것이 신뢰성 유지).

에러: `401`, `403`(viewer 또는 START 플랜), `404`(baseline 없음 또는 site 없음),
`422`(compare_from>=compare_to).

### 3.3 FE 비교 화면 데이터 형태 (화면9)

```typescript
export interface ComparisonMetricRow {
  key: "ei_total" | "ei_aeration" | "oei" | "fcr" | "mortality_rate";
  label: string;                 // "전력집약도(EI)" 등, FE 로컬 사전(metric-meta.ts 재사용)
  baselineValue: number | null;
  currentValue: number | null;
  deltaValue: number | null;
  improvementPct: number | null;
  direction: "lower_is_better" | "higher_is_better";
}
export interface ComparisonViewModel {
  baselinePeriod: { from: string; to: string };
  currentPeriod: { from: string; to: string };
  rows: ComparisonMetricRow[];
  baselineConfigVersion: string;
  currentConfigVersion: string;
}
```
화면 구성: 5개 지표 행(막대/증감 화살표 + 개선율 %), 상단에 두 기간 표기, 하단에 두
`config_version`이 다르면 경고 배지("산식 버전 차이" — 표시만, 차단 아님). Phase 1
`metric-meta.ts`(라벨/단위 사전)를 그대로 재사용.

---

## 4. 대시보드 확장 (START MVP 완성, 화면3)

### 4.1 `GET /sites/{site_id}/readings` — 실 시계열 조회 (신규)

```
GET /sites/{site_id}/readings?meter_id=&tank_id=&type=&from=&to=&granularity=raw|hourly|daily
Authorization: Bearer <JWT>
```
- `meter_id` 단일 지정 또는 `tank_id`+`type`(예: tank1의 모든 DO 계측기) 중 하나 이상 필요(422).
- `granularity=raw`: `readings` 원본을 `[from, to)`로 페이지네이션 없이 반환하되 **상한
  캡(예: 5,000행)**을 두어 대량 조회를 방지(초과 시 422 "narrow the range or use granularity").
- `granularity=hourly|daily`: 서비스 레이어에서 **일반 SQL `date_trunc` GROUP BY 집계**(평균/합,
  타입별 규칙: power=합, DO/temp/pH=평균)로 응답. **continuous aggregate는 이번 Phase에 만들지
  않는다**(4.2절 근거).

응답 200:
```jsonc
{
  "site_id": "...-site",
  "meter_id": "mtr_power_main",
  "type": "power",
  "granularity": "hourly",
  "unit": "kWh",
  "points": [ { "ts": "2026-07-01T00:00:00Z", "value": 12.4, "quality_flag": "ok" }, ... ]
}
```
집계 시 `quality_flag`는 다수결 또는 "bad가 하나라도 있으면 bad" 같은 규칙이 필요한데, 이는
**표시 로직**(3.1절과 같은 경계) — architect가 "bad 포함 버킷은 quality_flag='bad'로 표시"를
최소 규칙으로 못 박고, 세분화가 필요해지면 후속 결정. `value`는 KPI 산식에 들어가지 않는
**차트 전용 표시값**이므로 이 집계가 Rule 1을 건드리지 않는다(KPI는 여전히 `compute_ei` 등이
원본 readings로 산출).

에러: `401`, `403`(타 org), `404`(site/meter/tank 없음), `422`(파라미터 조합 오류·기간 역전).

### 4.2 continuous aggregate 필요성 판단 — 이번 Phase는 보류(과설계 금지)

NFR(대시보드 쿼리 <2초, MASTER 8장)은 "readings 1년치 × 수조 수십 개 × 분단위"를 가정하나,
Phase 2 실증은 **파일럿 1~2곳, 사이트당 수조 소수**(협약기간 규모)다. 이 규모에서는 인덱스된
`(meter_id, time)` 원시 쿼리로 hourly/daily 집계가 2초 이내 가능할 개연성이 높다. 따라서:
- **이번 Phase는 원시 쿼리 + `GROUP BY date_trunc`로 충분**하다고 판단(과설계 금지).
- Timescale의 `time_bucket`/continuous aggregate 도입은 **실측(부하 테스트)에서 2초 NFR
  미달이 확인된 이후**로 유보 — 그 시점에 ADR로 도입 결정(성능 최적화이지 지금 확정할 계약은
  아님). 이 판단 근거는 qa-reviewer가 부하 테스트로 검증할 수 있게 4.3절 수용 기준에 포함.

### 4.3 수조별 비교, 기간 필터 UI 데이터 계약

```typescript
export interface ReadingSeries {
  meterId: string;
  tankId: string | null;
  type: "power" | "do" | "temp" | "ph" | "orp" | "ec";
  unit: string;
  granularity: "raw" | "hourly" | "daily";
  points: { ts: string; value: number; qualityFlag: "ok" | "suspect" | "bad" }[];
}
export interface DashboardFilterState {
  from: string;
  to: string;
  granularity: "hourly" | "daily";   // 대시보드 UI는 raw 미노출(차트 밀도 문제)
  tankIds: string[];                 // 다중 선택 → 수조별 비교(여러 series 겹쳐 그리기)
}
```
FE: 기존 `PowerTimeSeriesChart.tsx`가 더미 대신 `useSiteReadings(filters)`(신규 훅, `GET
/readings` 소비)로 교체된다. 수조별 비교는 `tankIds` 다중 선택 시 series를 여러 개 겹쳐
ECharts에 렌더(신규 컴포넌트 불요 — 기존 차트에 series 배열 확장).

---

## 5. 알림 vs KPI 신호등 소유권 경계 요약 (Rule 1 재확인)

| 결정 사항 | 소유 | 근거 |
|---|---|---|
| alerts 테이블 스키마, API 시그니처, 배치 잡 배선 | **architect/backend-engineer** | 표현·전달 계층 |
| `do_low` 임계값 숫자, `mortality_spike_ratio`, kpi red/amber 경계값 | **data-kpi-engineer** | 도메인 판정 = 산식 |
| 추천 룰(급이/산소/순환 값 산출 로직) | **data-kpi-engineer** | MASTER 명시 |
| A/B 비교의 delta/improvement_pct 산술 | **backend-engineer 구현 가능, data-kpi-engineer 확인** | 단순 산술이나 방향성 도메인 지식 포함 |
| readings 집계(hourly/daily) 표시값 | **backend-engineer** | 차트 전용, KPI 미투입 |

---

## 6. 수직 슬라이스 분해 + 위임 제안 + 우선순위

각 슬라이스는 DB→엔진/서비스→API→(UI)를 관통하는 최소 기능이며 **수용 기준**, **MASTER 11장
증빙**, **FE/BE/KPI/QA 위임**을 갖는다. **START·PRO 우선**(과설계 금지).

### 슬라이스 G — KPI 신호등 red/amber 판정 (P0, ★ 알림의 게이트)
- 내용: `classify_metric_status`(1.4절) + `kpi_config.alerting`/지표별 임계 서브키 확정 +
  단위테스트 + `kpi_service._metric()` 통합.
- 수용: 5개 지표 모두 green/amber/red/na 4단계 결정론적 분류, 경계값 테스트(정확히 임계값일 때
  포함/제외 방향 명시), `GET /kpi` 응답의 status가 값 유무뿐 아니라 임계 반영, config_version
  갱신(Rule 2).
- 증빙(11장): "통합 관리 대시보드"(신호등) / "탄소저감 성과 리포트" 산식 가정 명시의 선행조건.
- 위임: **data-kpi-engineer**(판정 함수+임계+테스트), **backend-engineer**(통합), **qa-reviewer**.

### 슬라이스 H — 알림 배치 + API + 알림 센터 (P0, START 헤드라인)
- 선행: G(kpi_red 판정), 스키마.
- 내용: `alerts` 마이그레이션+RLS, `alerting` config 서브키(G와 병행 가능한 do_low/mortality_spike
  부분), APScheduler `job_evaluate_alerts`, `GET /sites/{id}/alerts`, `POST /alerts/{id}/ack`,
  FE 알림 센터(화면5) + 구독 스위치(1.7절).
- 수용: 3종 트리거 각각 최소 1개 시나리오로 alert 생성 확인(시드/테스트 데이터), 중복 open 억제,
  ack idempotent, ack 시 audit_logs 1행, viewer ack 403, 누수 테스트(타 org alert 404) green.
- 증빙(11장): "통합 관리 대시보드"(알림 센터 화면) / "현장 재현성"(배치 결정론).
- 위임: **backend-engineer**(스키마·배치·API), **data-kpi-engineer**(임계 판정 함수, G와 공유),
  **frontend-engineer**(알림 센터·구독 UI), **qa-reviewer**.

### 슬라이스 I — 대시보드 실데이터 전환 (P0, START MVP 완성)
- 내용: `GET /sites/{id}/readings`(4.1절) + `useSiteReadings` 훅 + `PowerTimeSeriesChart` 실데이터
  전환 + 수조별 비교(다중 series) + 기간 필터 UI.
- 수용: hourly/daily 집계 값이 원본 readings 합/평균과 수기 검산 일치, 대량 조회 캡 동작(422),
  대시보드 쿼리 실측 <2초(4.2절 판단 근거 확인 — qa-reviewer가 부하 테스트), FE 로딩/에러 상태.
- 증빙(11장): "통합 관리 대시보드"(더미 제거, 실제 화면 캡처 가능) / NFR 성능 실측 증빙.
- 위임: **backend-engineer**(API+집계), **frontend-engineer**(차트/필터), **qa-reviewer**(성능 실측).

### 슬라이스 J — 전·후(A/B) 비교 (P1, PRO 헤드라인)
- 선행: baseline 잠금 완료(Phase 1), I 불요(readings 직접 의존 없음, kpi_service 재사용).
- 내용: `packages/kpi/culiver_kpi/comparison.py`(compare_metric+METRIC_DIRECTION) +
  `GET /sites/{id}/comparison` + FE 비교 화면(화면9).
- 수용: baseline 있음/없음(404) 케이스, 5개 지표 delta/improvement_pct 수기 검산 일치,
  config_version 차이 노출, PRO 게이팅(START 403), None 전파 경계 테스트.
- 증빙(11장): "탄소저감 성과 리포트(MRV)" 전신(Before/After 비교) / "도입 패키지" PRO 차별점.
- 위임: **backend-engineer**(API+compare_metric 초안), **data-kpi-engineer**(방향성/산술 확인),
  **frontend-engineer**(비교 화면), **qa-reviewer**.

### 슬라이스 K — 추천(운전 레시피) 보드 (P1, PRO 핵심 차별화)
- 선행: G 불요(독립), `kpi_config.recommend` 서브키 확정(data-kpi-engineer).
- 내용: `recipes`/`recipe_versions` 마이그레이션+RLS, `compute_recommendation`(2.2절, ★산식은
  data-kpi-engineer), `GET /sites/{id}/recommendations`(+ 버전 영속화 규칙), `POST
  /recipes/{id}/versions`, `require_plan("PRO")`, FE 추천 보드(화면7, "추천만" 배지 고정 표시).
- 수용: 3종(feed/oxygen/circulation) 추천 각각 근거(rationale)+source_refs 포함, 동일 입력 재호출
  시 버전 미증가(해시 비교), START 플랜 403(API+FE 메뉴 숨김), 수동 버전 추가 audit_logs 기록.
- 증빙(11장): "추천/부분제어 로직"(룰셋/버전이력, `recipe_versions`) — 11장 매핑 핵심 항목.
- 위임: **data-kpi-engineer**(★compute_recommendation+config+테스트, 최우선 병목),
  **backend-engineer**(스키마·API·게이팅), **frontend-engineer**(추천 보드), **qa-reviewer**.

### 6.1 우선순위 요약 (실행 순서)

```
P0 (START MVP 완성 + 알림 헤드라인):
  G(신호등 판정) → H(알림 배치/API/센터)   [G가 H의 kpi_red를 게이트]
  I(대시보드 실데이터)                      [G/H와 병행 가능, 독립]
P1 (PRO 헤드라인, 병행 가능):
  J(A/B 비교)  ∥  K(추천 보드)              [서로 독립, K는 data-kpi-engineer 병목 주의]
```
- G는 H(kpi_red 트리거)의 게이트이지만 H의 do_low/mortality_spike 트리거와 I(대시보드)는
  G 완료를 기다리지 않고 병행 가능 → 실행 순서를 P0 내에서 굳이 직렬화하지 않는다.
- J는 Phase 1 baseline/kpi_service를 그대로 재사용하므로 신규 엔진 없이 가장 빠르게 열 수
  있는 PRO 슬라이스 — data-kpi-engineer 병목(K)이 걸리는 동안 J를 먼저 마무리하는 편이 유리.
- K는 이번 Phase에서 **가장 큰 신규 산식 작업**(추천 로직 자체를 처음 정의)이므로
  data-kpi-engineer 일정 여유를 가장 크게 배정해야 한다(P1 내에서도 조기 착수 권장).

---

## 7. 결정 기록(ADR) 현황

- 신규 ADR 없음. 스택/데이터모델 근본 변경이 아니라 Phase 1 패턴(배치 워커, kpi_config 서브키,
  RLS+append-only 테이블)의 반복 적용이므로 확정 스택 내 결정으로 충분(sprint-0/phase-1 선례).
- 4.2절 continuous aggregate 보류 판단은 **결정이지 변경이 아니므로** ADR 대상이 아니나, 이후
  실측 결과 도입이 필요해지면 그때 ADR 작성(성능 최적화용 스키마/쿼리 전략 변경이 되므로).

## 8. 위임 요약 (오케스트레이터용)

1. **선행 게이트**: `data-kpi-engineer` — G(신호등 판정 함수+임계)를 최우선 착수. K(추천 로직)는
   G와 별개로 최대한 빨리 착수(가장 큰 신규 작업, 일정 리스크).
2. **P0 병행**: `backend-engineer` H(알림 스키마/배치/API), I(readings API/집계) 동시 진행.
   `frontend-engineer` 알림 센터·대시보드 실데이터 전환.
3. **P1 병행**: `backend-engineer`+`frontend-engineer`가 J(비교)를 먼저 닫고, K는
   `data-kpi-engineer` 산출 완료되는 대로 통합.
4. 각 슬라이스 통합 후 `qa-reviewer` 게이트(수용 기준 + 누수 테스트 + 플랜 게이팅 + 성능 실측 I)
   통과 시에만 머지(Rule 10).
5. 계약(1~4절 시그니처·스키마·API)은 architect가 못 박았다. 구현자는 임의 변경 금지 — 변경
   필요 시 architect·(산식이면) data-kpi-engineer에 되돌려 합의한다.
</content>
