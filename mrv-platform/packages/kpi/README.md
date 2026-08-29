# culiver-kpi — KPI/MRV 도메인 엔진

컬리버 통합관리 + 탄소 MRV 플랫폼의 **산식 단일 진실 공급원(SSOT)**.
KPI/MRV/추천 산식은 오직 이 패키지에서만 정의한다(CLAUDE Rule 1). API/FE 어디에도 산식을 중복하지 않는다.

- 배포명(distribution): `culiver-kpi` · import 이름: `culiver_kpi`
- Python 3.12 (프로젝트 표준). 런타임 의존성 없음(표준 라이브러리만) → 순수·결정론 강제.
- 백엔드 설치: `pip install -e packages/kpi` (로컬 경로 의존성)

## 원칙 (Hard Rules 반영)
- **순수·결정론(Rule 6)**: 모든 산출 함수는 부작용이 없고 `now()`/난수를 쓰지 않는다.
  동일 입력 → 동일 출력. `config_version` 은 결과에 실리는 메타데이터일 뿐 산출 입력이 아니다.
- **버전 추적(Rule 2)**: 산식/파라미터 변경 시 단위테스트 추가 + `kpi_config.version` 증가.
  버전 증가 절차는 `culiver_kpi/config.py` 상단 주석 참조.
- **근거 추적(재현성 NFR, MASTER 7장)**: 모든 결과는 원천 reading 까지 역추적 가능한 필드
  (`source_meter_ids`, `source_biomass_refs`, included/excluded count, `config_version`)를 포함한다.
- **배출계수 하드코딩 금지(Rule 5)**: Scope2/MRV 구현 시 `emission_factors` 테이블에서 읽고
  출처·연도·버전을 결과에 함께 싣는다(Phase 1~3, `mrv.py`).

## 현재 구현 범위 (스프린트 0)
| 지표 | 함수 | 모듈 | 상태 |
|---|---|---|---|
| EI (전력집약도) ei_total / ei_aeration | `compute_ei` | `energy.py` | 구현 완료 |
| FCR (사료요구율) | `compute_fcr` | `feed.py` | Phase 1 예약 |
| OEI (산소운전 효율) | `compute_oei` | `oxygen.py` | Phase 1 예약 |
| 폐사율 (mortality) | `compute_mortality` | `mortality.py` | Phase 1 예약 |
| Scope2 / 감축량 MRV | `compute_scope2` 등 | `mrv.py` | Phase 1~3 예약 |

## EI 산식 (MASTER 3.2 ①)
```
EI = 기간 내 총 전력사용량(kWh) / 기간 내 생산량(kg) = Σ(power_kWh) / Δbiomass_kg
단위: kWh/kg
- ei_total    : 포함된 모든 reading.kwh 합 / Δbiomass
- ei_aeration : 포함된 reading 중 is_aeration=True 의 kwh 합 / Δbiomass (블로워 서브미터)
```
입력 전제(ADR 0001): `PowerReading.kwh` 는 **이미 interval kWh 로 정규화**되어 있으므로
엔진은 정렬/차분/롤오버 없이 순수 합산만 한다.

산출 규칙:
- 기간 필터는 **반열림 `[period_start, period_end)`** — 경계에서 이중 집계 방지.
- `quality_flag ∉ config.included_quality_flags` 인 reading 은 제외(오염 데이터 배제).
- `biomass_delta_kg <= config.min_biomass_delta_kg` 이면 EI = `None`(산출 불가; 0/음수 나눗셈 방지).
- 포함 reading 의 `kwh` 또는 생체량이 비유한(NaN/inf)이면 `ValueError`(KPI 오염 차단).

## 테스트
```
cd packages/kpi
python -m pytest -q
```
경계조건(생산량 0/음수, quality_flag 제외, 기간 반열림, aeration 부분집합, 결정론, 비유한값 방어)을
`tests/test_energy.py` 로 고정한다.
