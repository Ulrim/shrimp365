# ADR 0003 — OEI의 DO 목표대역 유지율 산정 규약 (deterministic in-band fraction)

- 상태(Status): 승인(Accepted) — architect 발의, `data-kpi-engineer` 합의 완료(산식 소유)
- 합의: data-kpi-engineer, 2026-07-03
- 날짜: 2026-07-03
- 작성: architect
- 관련: MASTER 3.2 ②(OEI 산식, "제안값 — 실증 1단계에서 계수 보정"), CLAUDE Rule 1·2·6,
  ADR 0001(데이터 표현 규약의 선례)

## 맥락 (Context)

MASTER 3.2 ②의 OEI 산식은 `t_in_band / t_total`(DO가 목표대역에 머문 **시간** 비율)을 요구한다.
그러나 DO는 이산(discrete) 샘플로 저장된다(`readings`). 이산 샘플에서 "시간 비율"을 얻는
방법은 여러 가지이며(샘플 개수 비율 / 샘플 간격 가중 적분 / 보간), 선택에 따라 값이 달라진다.
ADR 0001이 전력 표현을 못 박은 것과 동일한 이유로, **산식을 건드리기 전에 DO 유지율의
결정론적 산정 규약**을 먼저 정해야 한다(Rule 6). 또한 MASTER는 OEI를 "제안값"으로 명시하고
"실증 1단계에서 계수 보정 → 버전 기록"을 요구하므로, 보정 파라미터의 소재를 정의해야 한다.

## 결정 (Decision)

1. **유지율 = 유효 샘플 개수 비율(sample-count fraction)을 v1 기본으로 한다.**
   - `do_in_band_fraction = (대역 내 유효 샘플 수) / (전체 유효 샘플 수)`.
   - 유효 샘플 = `quality_flag ∈ included_quality_flags`인 DoReading.
   - 근거: 게이트웨이가 **고정 간격**으로 샘플링하면 개수 비율 ≈ 시간 비율이며, 정렬·보간
     같은 순서·시각 의존 부작용이 없어 순수·결정론(Rule 6)을 자연스럽게 만족한다.
   - 시간 가중(`time_weighted`) 방식은 `OeiConfig.do_band_method`로 예약하되 v1 미구현
     (불규칙 샘플링이 실증에서 확인되면 그때 구현 + config_version 증가). 과설계 금지.

2. **0~100 스케일링 계수는 산식이 아니라 `kpi_config` 파라미터다.**
   - `OeiConfig.oei_scale_factor`(★ **제안값**, 실증 데이터로 보정 대상) 및 `clamp_max=100`.
   - 보정 시 `energy.py`류 산식 코드를 고치지 말고 **kpi_config에 새 version 행**을 추가하고
     단위테스트를 갱신한다(Rule 2). baseline에는 잠금 시점의 config_version이 고정 저장된다.

3. **경계 규칙(산출 불가 = None)**
   - 유효 DO 샘플 0개(`t_total`=0) → OEI = None.
   - `aeration_power_kwh` = 0(폭기 전력 없음) → 분모 정의 불가 → OEI = None.
   - `biomass_delta_kg <= min_biomass_kg` → None(생산 kg당 정규화 불가).
   - `band.min >= band.max` 또는 비유한(NaN/inf) 입력 → `ValueError`(EI와 동일 방어).

## 대안 (Alternatives considered)

- **샘플 간 선형 보간 후 시간 적분**: 시각·순서 의존 부작용을 엔진에 도입 → 순수성 훼손,
  ADR 0001에서 기각한 논리와 동일. v1 기각(불규칙 샘플 확인 시 재검토).
- **스케일 계수를 코드 상수로 하드코딩**: 실증 보정마다 코드·테스트를 고쳐야 하고 버전
  추적이 끊김 → Rule 2 위반. 기각(→ kpi_config 파라미터로 외부화).

## 결과 (Consequences)

- (+) OEI가 EI/FCR/mortality와 **동일한 순수·결정론 패턴**을 공유 → 테스트·검증 일관성.
- (+) 실증 계수 보정이 산식 코드가 아닌 **kpi_config version**으로 흡수 → baseline 재현성 유지.
- (−) 고정 간격 샘플링 가정이 깨지면(결측·비정기) 개수 비율이 시간 비율에서 벗어남 →
  `quality_flag` 필터로 결측을 배제하고, 편차가 크면 `time_weighted`를 도입(후속 ADR/버전).
- **합의 필요**: 유지율 정의(개수 비율)와 스케일 계수의 kpi_config 외부화는 산식 IP의 핵심
  (MASTER 3.2)이므로 `data-kpi-engineer`가 본 ADR을 Accepted로 전환한 뒤에만 `compute_oei`
  구현에 착수한다. architect는 산식/계수를 정하지 않는다(시그니처·경계·표현 규약만 확정).

## 합의 근거 (data-kpi-engineer, 2026-07-03)

산식 소유자로서 본 ADR을 **승인(Accepted)** 한다. 판단 근거:

1. **유지율 = 유효 샘플 개수 비율(v1)은 산식적으로 타당**하다.
   - `do_in_band_fraction`을 유효 샘플 개수 비율로 정의하면 `ts` 정렬·간격 계산·보간 같은
     순서/시각 의존 연산이 필요 없어 **순수·결정론(Rule 6)** 을 구조적으로 보장한다. 이는
     `compute_ei`가 정렬 없는 순수 합산으로 결정론을 얻는 방식과 동일한 설계 철학이다.
   - 고정 간격 샘플링 전제에서 개수 비율은 시간 비율의 불편(unbiased) 추정이다. 결측·비정기
     샘플은 `included_quality_flags` 필터가 배제하므로 편향을 억제한다. 불규칙 샘플링이
     실증에서 확인되면 `time_weighted`를 도입하되(예약 필드 존재), 이는 **산출값이 바뀌는
     변경**이므로 config_version MAJOR 증가 + 단위테스트 갱신을 동반한다(Rule 2).
2. **`oei_scale_factor`의 kpi_config 외부화는 필수적이며 타당**하다.
   - MASTER 3.2 ②가 OEI를 명시적 "제안값"으로 규정하고 "실증 1단계 계수 보정"을 요구한다.
     스케일 계수를 코드 상수로 두면 보정마다 산식 코드를 고쳐야 하고 버전 추적이 끊긴다(Rule 2 위반).
   - `OeiConfig.oei_scale_factor`(제안값 1.0)로 외부화하면 보정이 산식 코드가 아닌
     **kpi_config version 증가**로 흡수되고, baseline은 잠금 시점 config_version을 고정 저장하므로
     "Before" 재현성이 유지된다. 결과 dataclass에 `oei_raw`(스케일 전 원값)와 `scale_factor`를
     함께 노출해 어떤 계수로 스케일됐는지 drill-down 추적이 가능하다.
3. **경계 규칙(None 반환)이 EI와 일관**하다: 유효 DO 샘플 0 / aeration_kwh=0 / biomass_delta<=min은
   모두 분모 정의 불가이므로 `None`("산출 불가")이 옳다. band 역전·비유한·기간 역전은 `ValueError`.

→ 본 승인으로 슬라이스 D(`compute_oei`) 구현 게이트를 개방한다. 스케일 계수 실증 보정 시
   절차: (1) 단위테스트에 새 계수 기대값 고정 → (2) kpi_config 새 version 행(effective_from) 추가 →
   (3) `kpi_snapshots.config_version`으로 적용 기간 추적. **산식 코드(oxygen.py)는 불변 유지.**
</content>
