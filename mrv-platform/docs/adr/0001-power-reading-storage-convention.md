# ADR 0001 — 전력 readings 저장 규약 (interval kWh 정규화)

- 상태(Status): 승인(Accepted)
- 합의: data-kpi-engineer, 2026-07-02
- 날짜: 2026-07-02
- 작성: architect
- 관련: MASTER 3.2(EI 산식), 3.3(Scope2), 6장(readings 스키마), 7장(API 원칙), CLAUDE Hard Rule 1/5/6

## 맥락 (Context)
MASTER 6장의 `readings(time, meter_id, value, quality_flag)` 스키마에서 `value`의
물리적 의미가 미정의다. 전력계(meter.type='power')의 값은 최소 3가지로 저장될 수 있다.

1. 순시 전력 `kW` (instantaneous power)
2. 누적 전력량 `kWh` (cumulative counter, 계량기 적산값)
3. 계측 간격 증분 전력량 `kWh` (interval energy = 두 적산값의 차)

EI 산식은 `Σ(power_kWh)`를 요구한다(MASTER 3.2). 어떤 표현을 저장하느냐에 따라
KPI 엔진의 합산 로직·결정론·재현성이 달라지므로, 산식을 건드리기 전에 **입력 데이터의
표현 규약**을 먼저 못 박아야 한다(CLAUDE Rule 6: 결정론).

## 결정 (Decision)
`readings.value`에는 **계측 간격당 증분 전력량(kWh)** 을 저장한다(위 3번).

- 게이트웨이/현장 계량기가 적산값(kWh, 2번)이나 순시전력(kW, 1번)을 보내면,
  **ingestion worker**가 저장 직전에 interval kWh로 정규화한다.
  - 적산값 → `Δ적산값`(직전 reading 대비 차), 카운터 롤오버/리셋은 `quality_flag='suspect'`.
  - 순시 kW → `kW × Δt(h)` (사다리꼴 적분), 결측 간격은 보간하지 않고 `bad`로 표기.
- 정규화 규약과 원단위(kWh)는 `meters.unit`에 기록한다(예: `'kWh_interval'`).
- 이 정규화는 **데이터 표현 계층의 책임**이며 KPI 산식이 아니다. KPI 엔진(`/packages/kpi`)은
  이미 interval kWh로 정규화된 값을 받아 **단순 합산**만 한다(순수 함수 유지).

## 대안 (Alternatives considered)
- **누적 kWh 저장 후 KPI 엔진에서 차분**: 엔진이 정렬·롤오버·결측 처리라는 부작용성
  로직을 떠안게 되어 순수 함수 원칙과 충돌. 기각.
- **순시 kW 저장 후 조회 시 적분**: 대시보드/KPI 쿼리마다 재적분 → 결정론은 유지되나
  비용·복잡도 증가, continuous aggregate 설계가 어려워짐. 기각.
- **원표현 그대로 저장(혼재)**: meter마다 의미가 달라져 멀티테넌시·검증 추적성 악화. 기각.

## 결과 (Consequences)
- (+) KPI 엔진은 `Σ value`만 하면 되어 순수·결정론·테스트 용이성 확보.
- (+) TimescaleDB continuous aggregate가 단순 `SUM(value)`로 성립(NFR: 대시보드 < 2초).
- (+) 근거 추적(drill-down): EI의 분자는 포함된 reading들의 `value` 합으로 그대로 역추적 가능.
- (−) ingestion worker에 정규화·롤오버 처리 부담. 스프린트 0에서는 시드 데이터를 이미
  interval kWh로 생성하므로 정규화 로직은 Phase 1(실제 MQTT 수집)에서 구현.
- 후속: 롤오버/결측 규칙의 정확한 `quality_flag` 판정 기준은 `data-kpi-engineer`가
  데이터 정합(QA) 규칙으로 확정(MASTER 3.2 하단 quality_flag 책임).

## 합의 메모 (data-kpi-engineer, 2026-07-02)
`compute_ei`의 입력 전제로서 본 규약을 **승인**한다. 근거:
- 산식 `EI = Σ(power_kWh) / Δbiomass_kg`의 분자는 `PowerReading.kwh`의 단순 합이면 충분해야
  순수·결정론(Rule 6)이 성립한다. interval kWh 정규화를 데이터 표현 계층으로 밀어내는 결정은
  엔진이 정렬/차분/롤오버/보간 같은 시각·순서 의존 부작용을 갖지 않게 하므로 산식 관점에서 타당.
- 근거 추적(drill-down): 분자가 포함 reading들의 `value` 합이므로 `source_meter_ids`로
  원천 reading까지 역추적 가능(MASTER 7장 재현성 NFR 충족).
- 이의 없음. 단, 정규화 계층이 만들어 내는 `quality_flag`('suspect'/'bad')는 엔진이
  `EiConfig.included_quality_flags`로 필터링해 오염 데이터를 KPI에서 배제한다(책임 분리 명확).
