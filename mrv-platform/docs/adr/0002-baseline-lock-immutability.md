# ADR 0002 — 기준선 잠금 불변성 강제 전략 (baseline lock immutability)

- 상태(Status): 승인(Accepted) — architect 발의, `data-kpi-engineer` 스냅샷 구성 확인 완료
- 합의: data-kpi-engineer, 2026-07-03 (스냅샷 구성 2.4절 한정 — 불변성 강제 방식은 backend 소관)
- 날짜: 2026-07-03
- 작성: architect
- 관련: MASTER 3.1(Baseline), 6장(baselines 스키마), 10장(Phase 1 "기준선 잠금"),
  CLAUDE Hard Rule 3(잠금 후 불변, 수정 코드 경로 금지)·Rule 9(감사 로그)

## 맥락 (Context)

CLAUDE Rule 3은 **"기준선(baseline)은 잠금 후 불변. 수정 코드 경로를 만들지 말 것"** 을
절대 규칙으로 못 박는다. MASTER 6장 `baselines`는 `locked[bool], locked_by, locked_at`만
가지며, 불변성을 *어떻게 강제하는지*는 정의되어 있지 않다. Baseline은 MRV 전/후 비교의
"Before" 기준이므로(MASTER 3.3), 잠금 후 단 한 번의 수정도 전체 탄소저감 성과의 신뢰성을
무너뜨린다. 따라서 "수정 엔드포인트를 만들지 않는다"는 관례(convention)에만 의존하지 않고
**데이터 계층에서 물리적으로 강제**해야 하는지, 어느 계층까지 방어할지를 결정한다.

## 결정 (Decision)

기준선 불변성을 **3중 방어(엔드포인트 부재 + DB 트리거 + 부분 유니크 인덱스)** 로 강제한다.

1. **API 계약 계층 — 수정 경로 부재**
   - `baselines`에 대한 `PATCH`/`PUT`/`DELETE` 엔드포인트를 **만들지 않는다**.
   - 상태 전이는 오직 **생성→잠금** 단방향. Phase 1의 `POST /sites/{id}/baseline/lock`은
     KPI 스냅샷 계산과 `status='locked'` 삽입을 **단일 트랜잭션**으로 수행한다(원자적 잠금).
   - `draft`는 스키마상 예약 상태(향후 "미리보기 후 확정" UX용)이며, Phase 1의 lock은
     draft를 영속화하지 않고 곧바로 locked로 삽입한다(가변 baseline 함정 회피, 과설계 금지).

2. **DB 계층 — BEFORE UPDATE/DELETE 트리거(Postgres)**
   - `status='locked'`인 행에 대한 `UPDATE`/`DELETE`를 트리거가 `RAISE EXCEPTION`으로 차단한다.
   - 애플리케이션 버그·수동 SQL·향후 개발자의 실수까지 물리적으로 막는다(관례 아닌 강제).
   - sqlite(테스트 폴백)는 트리거 미적용 → 3번 인덱스 + 서비스 가드로 회귀 검증.

3. **DB 계층 — 부분 유니크 인덱스(재잠금 방지)**
   - `UNIQUE (site_id) WHERE status='locked'` — 사이트당 활성 잠금 baseline은 최대 1개.
   - 이미 잠긴 사이트에 재잠금 삽입 시 유니크 위반 → 서비스가 이를 **409 Conflict**로 변환.
   - 서비스 계층은 삽입 전 기존 locked baseline 존재를 조회해 **선제적으로 409** 반환(UX),
     경합(race) 시 DB 제약이 최종 방어선.

## 대안 (Alternatives considered)

- **관례(수정 엔드포인트만 안 만든다)만으로 강제**: Rule 3의 "물리적 불변"을 만족하지 못함.
  워커/마이그레이션/수동 SQL이 잠금 값을 바꿔도 막을 수 없어 MRV 신뢰성 위험. 기각.
- **append-only 이력 테이블(baseline 수정 시 새 버전 행)**: 잠금 후 "수정"이라는 개념 자체가
  Rule 3 위반이므로 버전 이력이 불필요. 재기준선(re-baseline)은 별개의 새 baseline 생성으로
  처리하면 충분(Phase 1은 사이트당 1개). 과설계로 기각.
- **DB 사용자 권한(REVOKE UPDATE)으로 차단**: 앱이 단일 DB 롤을 쓰므로 다른 정상 쓰기까지
  막혀 실용성 낮음. 트리거가 행 단위로 정밀 차단하므로 우수. 기각.

## 결과 (Consequences)

- (+) Rule 3을 데이터 계층에서 물리적으로 보장 — MRV "Before" 기준의 무결성 확보.
- (+) 수정 코드 경로가 아예 없어 감사·검증이 단순(잠금=사실상 append-only 이벤트).
- (+) 감사성(Rule 9): 잠금 시 `audit_logs`에 `action='lock'`, `diff_json={before:null, after:snapshot}`
  1행 기록. 이후 수정 이벤트는 존재할 수 없으므로 감사 로그도 잠금 1건으로 종결.
- (−) 잘못 잠근 baseline의 정정 수단은 "무효화(void) 후 신규 잠금"뿐 → Phase 1 범위 밖.
  필요 시 별도 ADR로 `status='voided'` 전이(값 수정이 아닌 상태 무효화)를 도입한다.
- 후속: baseline이 담을 KPI 스냅샷 구성(EI/OEI/FCR/mortality + config_version 고정)은
  `data-kpi-engineer`가 확인한다(불변으로 얼려질 값의 정의는 산식 소유자 합의 대상).

## 스냅샷 구성 확인 (data-kpi-engineer, 2026-07-03)

산식 소유자로서 phase-1.md 2.4절이 규정한 **baseline 스냅샷 구성이 도메인상 타당**함을 확인한다.
불변성을 *어떻게* 강제하는지(트리거·부분유니크·엔드포인트 부재)는 backend 소관이므로 검토하지
않으며, 아래는 **얼려질 값의 정의**에 대한 확인이다:

1. **4종 KPI 스칼라(EI 2종 포함 5개 값) + config_version 고정은 MRV "Before" 무결성에 필요충분**하다.
   - 얼리는 스칼라: `ei_total`, `ei_aeration`, `oei`, `fcr`, `mortality_rate`. 이는 각 산출 함수의
     대표 지표값(`*Result`의 최상단 Optional 필드)과 정확히 일치한다. `None`("산출 불가")도
     그대로 보존해야 하므로 컬럼은 NULL 허용이 옳다(phase-1 2.1절 반영됨).
   - `config_version` 고정이 핵심이다: KPI는 결정론적이므로 (입력 readings + config_version)이
     고정되면 값이 영원히 재현된다. 잠금 후 kpi_config가 MAJOR 증가(예: OEI 스케일 보정)해도
     baseline은 잠금 당시 version의 값을 보존한다 → MRV 전/후 비교의 기준선 신뢰성 확보.
2. **전체 근거(inputs/provenance)를 `kpi_snapshots`에 두고 baseline은 요약 스칼라 + FK만 드는
   구조가 옳다.** 각 `*Result`는 `source_*_refs`·중간값·근거 필드를 담는데, 이를 baseline에
   중복 복사하면 정합 리스크가 생긴다. `kpi_snapshot_id` FK 한 개로 drill-down(원천 reading까지
   역추적)이 유지되므로 중복 최소화 원칙에 부합한다.
3. **주의(backend 이행 조건)**: 잠금 시 스냅샷에 실린 각 지표의 `config_version`은 반드시
   **단일 값**이어야 한다(4종 지표가 서로 다른 version으로 산출되면 baseline 재현성이 깨진다).
   phase-1 1.4절대로 version은 전 지표가 공유(2026.1.0)하므로 현 시점 충족된다. 향후 지표별
   version 분기가 필요해지면 별도 ADR로 스냅샷 구성을 재확인한다.

→ 본 확인으로 슬라이스 C(baseline lock)의 스냅샷 구성 게이트를 승인한다.
</content>
</invoke>
