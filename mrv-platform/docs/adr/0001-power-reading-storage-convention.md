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

## 예외 — `value`가 구간 kWh가 아닌 경우 (2026-10-19 보강)

위 결정문은 `value`를 "구간 kWh"로만 적고 있었다. 그런데 **구간값을 낼 수 없는 건이
있고, 그 건의 `value`는 구간 kWh가 아니다.** 이식본의 실제 동작(`lib/mrv/ingestion.ts`)은
다음과 같으며, 이 절이 그 예외를 결정문에 명시한다.

| 상황 | 저장되는 `value` | `quality_flag` |
|---|---|---|
| 구간값(`interval_kwh`), `value` ≥ 0 | 보낸 값 그대로 (구간 kWh) | `ok` |
| 구간값(`interval_kwh`), `value` < 0 | **음수 그대로** | `suspect` |
| 적산값(`cumulative_kwh`), 같은 배치에 직전 값 있음, Δ ≥ 0 | Δ적산값 (구간 kWh) | `ok` |
| 적산값, Δ < 0 (계량기 교체·카운터 롤오버) | **적산 원값 그대로** | `suspect` |
| 적산값, 배치에 직전 값 없음 · DB에 이력은 있음 (첫 적산 지침) | **적산 원값 그대로** | `suspect` |
| 적산값, 이력이 전혀 없음 | **0.0** | `bad` |
| 순시전력(`instant_kw`), 직전 값 있고 간격 정상 | kW × Δt(h) (구간 kWh) | `ok` |
| 순시전력, 직전 값 없음 또는 간격 비정상 | **0.0** | `bad` |
| DO(`do_mg_l`), 0 ≤ `value` ≤ 20 | 보낸 값 그대로 (mg/L) | `ok` |
| DO(`do_mg_l`), 0~20 mg/L 밖 (센서 이상) | **그 값 그대로** | `suspect` |

표의 마지막 네 줄은 2026-10-19 검수에서 빠진 것이 드러나 보강했다. 이 결정문을 읽고
코드를 쓰는 사람이 생기므로, 빠진 줄은 **없는 규약**과 같다.

`bad` 행의 `value`는 값을 낼 수 없어 앉힌 **0.0**이다. 원값을 버리지 않고 보존하는 것은
의도적이다 — 나중에 직전 값이 확보되면 사람이 보정할 수 있어야 하고, 증빙 시스템에서
수집된 숫자를 조용히 버리는 것은 해서는 안 되는 일이다.

**`suspect` 행의 `value`는 한 종류가 아니다.** 흔한 경우는 12,000 kWh 같은 적산 원값이지만,
음수 구간값과 범위를 벗어난 DO 값도 `suspect`로 들어오고 그 `value`는 **보낸 값 그대로**다.
표의 마지막 네 줄을 더하기 전에는 이 결정문이 "`suspect`의 `value`는 적산 원값" 이라고만
적고 있었고, 그 단정은 전부에 대해 참이 아니었다.

### 이 예외가 안전한 이유, 그리고 안전하지 않게 되는 조건

기본 설정 `included_quality_flags = ["ok"]`
(`supabase/migrations/mrv_platform.sql`의 `mrv_kpi_config` 시드 행)에서 `suspect`/`bad`
행은 KPI 산입에서 빠진다. **그래서 기본 설정에서는 이 예외가 수치를 오염시키지 않는다.**

오염은 그 목록을 넓히는 순간 시작된다.

- `"suspect"`를 산입하면 적산 원값이 **한 구간의 사용량**으로 EI 분자와 Scope2 배출량에
  통째로 더해진다. 두 수치가 실제보다 커지고, 화면·리포트에는 값이 커졌다는 것 말고
  아무 표시도 남지 않는다.
  - **단, 방향이 늘 그렇지는 않다.** 음수 구간값(위 표 2행)도 `suspect`이고, 그것을
    산입하면 EI 분자가 **줄어든다**. "`suspect`를 산입하면 수치가 커진다"는 단정은
    적산 원값 쪽에만 참이다. 그래서 경고 문구도 두 방향을 함께 적는다
    (`lib/mrv/quality-flags.ts::qualityFlagRiskText`).
- `"bad"`를 산입하면 실제로 쓴 전력이 빠진 채 '사용량 0 구간'이 합산되어, 포함 계측값
  수는 늘지만 EI는 실제보다 작아진다.
- **`suspect`/`bad`가 틀어뜨리는 수치는 어느 목록에 적었는지에 달려 있다.** 같은 플래그
  집합이 네 자리에 쓰이는데(`ei`·`fcr`·`oei`·`recommend`) 거르는 대상이 서로 다르다 —
  `oei.included_quality_flags`는 **DO 계측값과 폭기 전력**을 거르고(`lib/mrv/kpi/
  oxygen.ts`), `fcr`·`recommend`는 **급이 기록**을 거른다. EI를 주어로 적은 문장을 그
  목록들에 그대로 쓰면 틀린 수치 이름을 운영자에게 보여 주게 된다.
- **빈 목록(`[]`)은 "산출 불가(null)"가 아니다.** `lib/mrv/kpi/energy.ts`에서 null은
  Δbiomass가 임계 이하일 때만 나오고, 포함 건이 0건이면 분자는 `0.0`이다. 따라서 빈
  목록은 EI를 **0 kWh/kg**, Scope2 배출량을 **0 tCO2e**로 만들고 감축량을 기준선 전량으로
  잡는다. 조용한 null보다 나쁜 결과다.

### 그래서 어디서 막는가

KPI 엔진(`lib/mrv/kpi/`)은 원본 Python과 차분검증된 코드이므로
(`scripts/mrv/verify-config.mjs`) 거기에 화이트리스트를 넣지 않는다 — 넣으면 원본과
갈라져 차분검증이 깨진다. 막는 자리는 **설정을 저장하는 경계**다
(`app/api/mrv/kpi-config/route.ts`).

- 모르는 플래그 값(ok/suspect/bad 이외), 배열이 아닌 값, 문자열이 아닌 원소, 빈 배열,
  **최상위 블록 이름 오탈자**(`{"recomend": {...}}`처럼 블록 이름이 틀려 그 블록이 통째로
  무시되는 문서) → 422 거부. 모양 검사의 좌표 목록은
  `lib/mrv/kpi-params-shape.ts`(`STRING_LIST_PARAM_PATHS`) 한 곳에 있고, 엔진이
  `strList()`로 읽는 **다섯 자리 전부**가 같은 검사를 거친다
  (`alerting.kpi_red_metrics`가 그 다섯 번째다).
- `suspect`/`bad` 포함 → **거부하지 않는다**(계량기 교체 구간을 수기 보정해 두고 원값
  건까지 포함해 재산출하는 등 정당한 이유가 있을 수 있다). 대신 감사 로그에
  `quality_flag_risks`로 무엇을 포함했고 어느 수치가 어느 방향으로 틀어지는지를 남기고,
  설정 화면이 경고를 띄우며, 그 설정으로 만든 MRV 리포트의 「포함 품질 플래그」 줄이
  기본값이 아님을 인쇄물에 명시한다.

플래그의 의미와 경고 문구는 `lib/mrv/quality-flags.ts` 한 곳에 둔다(엔진 밖). 쓰기 경계·
설정 화면·인쇄 리포트가 같은 판정과 같은 문장을 쓰게 하려는 것이다.

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
