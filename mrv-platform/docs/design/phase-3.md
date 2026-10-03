# Phase 3 설계 노트 — 검증 완성·사업화 (MRV 리포트·SOP·멀티사이트·감사로그·상용화 온보딩)

- 작성: architect
- 날짜: 2026-07-07
- 기준 문서: `00_개발의뢰서_MASTER.md`(SSOT) 3.3장/4장(화면 8~16)/6장/7장/9장/10장/11장, `CLAUDE.md`
- 선행 계약: `docs/design/sprint-0.md`, `docs/design/phase-1.md`, `docs/design/phase-2.md`
  (EI/FCR/OEI/mortality 엔진, `GET /sites/{id}/kpi`, baseline lock, `compare_metric`,
  신호등 판정, 추천 보드, 알림 — 이번 문서가 그대로 재사용)
- 선행 ADR: `0001`(전력 표현), `0002`(baseline 불변성), `0003`(OEI DO 유지율) — 모두 Accepted
- 신규 ADR: `0004-mrv-pdf-report-engine-selection.md`(Accepted, WeasyPrint 채택),
  `0005-supabase-auth-integration.md`(Proposed, 로그인 스택 = Supabase Auth — 8.0절/
  `docs/design/phase-3-auth.md` 참고)

> **이 문서의 목적**: Phase 3의 **인터페이스/계약을 못 박는 것**이다. 대규모 구현은 하지 않는다.
> 사용자가 명시적으로 요구한 **"상용화 수준 완성도"** 를 이번 Phase의 최우선 판단 기준으로
> 삼는다 — 단순 기능 나열이 아니라 *실제 유료 고객에게 그대로 내놓을 수 있는가*를 각 절마다
> 자문한다. KPI/MRV **산식**은 여전히 `data-kpi-engineer` 소관이다(Rule 1). architect는
> 시그니처·스키마·API·소유권 경계만 확정한다.

---

## 0. Phase 3 범위 확정 (MASTER 10장 인용) + 현재 상태 재확인

MASTER 10장:
> **Phase 3 (말기, 9~10월) — 검증 완성·사업화**: 재현성·MRV·패키징
> 결과물: MRV 리포트 자동생성, SOP, 멀티사이트(ENT), 감사 로그, 유료 전환 온보딩

**현재 구현 상태(선행 계약 확인 완료)**: EI/FCR/OEI/mortality 4종 엔진 + 신호등, baseline 잠금
(ADR 0002 불변), ingestion(HTTP+MQTT), 알림(배치+센터), 추천 보드(추천만, 승인 게이트 없음),
A/B 비교(KPI 5종, Scope2 없음), 대시보드 실데이터, `GET /auth/me`(plan 조회)가 이미 있다.

**설계 과정에서 발견한 기존 갭(이번 Phase 계약에 직접 영향)**:
1. **실 로그인 발급 경로가 없다**. 현재 JWT는 테스트 헬퍼(`_make_token`)로만 발급되며,
   `users` 테이블에 비밀번호 컬럼조차 없다. "상용화"를 논하는 이번 Phase에서 이는
   **치명적 갭**이었다 — 8.0절/ADR 0005/`phase-3-auth.md`에서 **Supabase Auth로 확정**
   (사용자 최종 결정, architect의 자체 JWT 권고를 대체)했다.
   (참고: `GET /auth/me` 자체는 이 설계 노트 작성 중 `main.py`에 `auth_router` 등록이
   완료되어 정상 동작한다 — 초기 감사 시점의 등록 누락은 별도 진행 중이던 수정으로 이미
   해소되었으므로 9절 슬라이스에서 제외한다.)
2. `main.py`에 **CORS 미들웨어가 없다**(재확인 시점 기준 여전히 부재). 배포된 FE(별도
   오리진)가 API를 호출하면 브라우저가 차단한다 — 8.4절 P0 항목.
3. `GET /ready`(readiness, DB 연결 확인)가 아직 없다(재확인 시점 기준 여전히 부재) — 8.3절.
4. MASTER 화면6(주간/월간 리포트, START)도 아직 미착수로 보인다. 이번 문서의 1절 PDF
   파이프라인을 그대로 재사용 가능하므로 9절에서 낮은 우선순위로 함께 언급한다(신규 범위
   확대는 아님 — 기존 MASTER 요구사항의 재확인).

**과설계 금지 원칙(재확인, 7개월 협약기간)**:
- **MRV 리포트(1절)를 이번 Phase의 헤드라인이자 최우선**으로 둔다(사용자 요청 "상용화"의
  핵심 산출물이자 MASTER 11장 "탄소저감 성과 리포트" 증빙의 직접 근거).
- ENTERPRISE 전용 3종(제어콘솔/멀티사이트/맞춤리포트)은 **START·PRO 완성 이후**(CLAUDE.md
  원칙). 이 중 맞춤 리포트 빌더는 이번 Phase 범위에서 **제외**한다(6절 근거).
- 승인형 제어 콘솔은 "설비 자동 제어"가 아니라 **"운영자가 물리적으로 적용 후 결과를
  기록하는 반자동 흐름"** 으로 범위를 명확히 좁힌다(3.0절) — MASTER 어디에도 액추에이터
  프로토콜이 정의되어 있지 않으므로 이를 새로 발명하지 않는다.

---

## 1. MRV 리포트 (★최우선, MASTER 3.3장, 화면10)

### 1.0 소유권 경계 재확인 (Rule 1)

Scope2 산식·감축량 산식의 **정의**는 `data-kpi-engineer` 소관이다. architect는 MASTER 3.3의
산식을 **그대로 인용**하고, `packages/kpi/culiver_kpi/mrv.py`의 **시그니처만 제안**한다.
아래 1.3절 함수 본문 구현과 "생산량 정규화 기준"·"배출계수 적용 규칙"의 **최종 확정은
data-kpi-engineer 합의가 게이트**다(ADR 0003 선례와 동일한 절차).

### 1.1 `emission_factors` 테이블 (Rule 5 — 하드코딩 금지)

`kpi_config`와 동일 패턴(조직 전역 설정, org_id 없음, RLS 비대상 — 국가 전력 배출계수는
테넌트별로 다르지 않다):

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | String(64) PK | `ef-{uuid4}` |
| `factor_tco2e_per_mwh` | Float | 전력 배출계수(tCO2e/MWh). **하드코딩 금지**(Rule 5) |
| `source` | String(255) | 출처(예: "환경부 온실가스종합정보센터(GIR)") |
| `year` | Integer | 공표 연도 |
| `version` | String(32) unique | 버전 문자열(예: '2024-GIR-v1'). 리포트가 고정 참조 |
| `effective_from` | timestamptz | 이 배출계수가 유효해지는 시점 |
| `created_at` | timestamptz | 등록 시각 |

로드 규칙(`kpi_service._load_active_kpi_config`와 동일 패턴): `effective_from` 내림차순
최신 1행을 "활성 배출계수"로 사용. `POST /sites/{id}/mrv-reports/generate` 요청에서
`emission_factor_id`를 명시하면 그 값을 강제 사용(과거 배출계수로 재현/검증 필요 시).
새 배출계수 등록 API는 관리자 전용 최소 엔드포인트만 둔다:

```
POST /emission-factors   { factor_tco2e_per_mwh, source, year, version, effective_from }
Authorization: Bearer <JWT>   # require_writer + owner 한정(조직 전역 설정 변경 리스크)
```
응답 201 + `audit_logs`(Rule 9, entity='emission_factors'). **수정/삭제 엔드포인트는 만들지
않는다**(baseline과 동일 철학 — 과거 리포트가 참조한 배출계수 값이 사후 변경되면 증빙
무결성이 깨진다). 계수 보정이 필요하면 새 `version` 행을 추가한다(Rule 2와 동형의 append-only
버전 관리).

### 1.2 `mrv_reports` 테이블 (MASTER 6장 + 근거 보강)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | String(64) PK | `mrv-{uuid4}` |
| `site_id` | FK sites | RLS 앵커 |
| `org_id` | FK organizations | RLS 비정규화(기존 패턴) |
| `baseline_id` | FK baselines | "Before" 기준(잠긴 baseline, 불변) |
| `period_start` / `period_end` | timestamptz | "After" 기간(요청 파라미터) |
| `emission_factor_id` | FK emission_factors | 적용된 배출계수(고정 참조) |
| `after_kpi_snapshot_id` | FK kpi_snapshots | After 기간 스냅샷(생성 시 영속화, drill-down) |
| `before_json` | JSON | Before 요약(1.4절 구조) — baseline 값 그대로 복사(재계산 안 함) |
| `after_json` | JSON | After 요약(1.4절 구조) |
| `reduction_tco2e` | Float NULL | 감축량. None=산출 불가(EI 중 하나라도 None) |
| `formula_text` | Text | 산식 전문(실제 대입값 포함, MASTER 3.3 ③ "재현 가능") |
| `boundary_json` | JSON | 측정경계·가정(1.6절 — 자동 생성, 자유 입력 아님) |
| `pdf_path` | String(512) NULL | 생성된 PDF 파일 경로(1.5절). 생성 직후 채움 |
| `generated_by` | String(64) | 생성자(JWT user_id) |
| `generated_at` | timestamptz | 생성 시각(append-only 메타데이터) |

`mrv_reports`는 **append-only**(baseline과 달리 물리적 불변 트리거까지는 과설계 — 수정
엔드포인트를 만들지 않는 것으로 충분. 재생성이 필요하면 새 리포트 행을 추가한다. 이미
발급된 리포트가 심사/거래처에 제출된 뒤 값이 바뀌는 것을 막는 게 목적이므로 "생성 후
불변"이 baseline만큼 물리적으로 강제될 필요는 없다고 판단 — 근거: 리포트는 baseline처럼
다른 산출물의 입력이 되는 게 아니라 **최종 산출물**이라 연쇄 오염 리스크가 baseline보다
낮다. 과설계 금지 원칙에 따라 트리거는 두지 않는다).

### 1.3 Scope2 산정 함수 계약 (`packages/kpi/culiver_kpi/mrv.py`, 제안 시그니처)

산식(MASTER 3.3 ★ 그대로 인용):
```
Scope2 배출량(tCO2e) = 전력사용량(MWh) × 전력 배출계수(tCO2e/MWh)
감축량(tCO2e) = (EI_baseline − EI_after) × 생산량(kg) × 배출계수
  → 동일 생산량 기준으로 정규화하여 "절감"을 분리(생산량 증가 효과와 혼동 방지)
```

```python
# packages/kpi/culiver_kpi/mrv.py — 시그니처 제안(구현/세부 규칙: data-kpi-engineer)

@dataclass(frozen=True)
class EmissionFactorRef:
    """emission_factors 1행의 산식 입력 투영(근거 필드 포함, drill-down)."""
    factor_tco2e_per_mwh: float
    source: str
    year: int
    version: str

@dataclass(frozen=True)
class Scope2Input:
    """서비스가 조립하는 입력. EI는 kWh/kg, 전력량은 kWh(ADR 0001 정규화 값의 합)."""
    ei_baseline: float | None          # baseline.ei_total
    ei_after: float | None             # after 기간 compute_ei 결과의 ei_total
    total_power_kwh_baseline: float    # baseline 기간 총 전력(참고표용, EiResult.total_power_kwh)
    total_power_kwh_after: float       # after 기간 총 전력
    production_kg: float               # ★정규화 생산량(아래 "결정 필요" 참조)
    emission_factor: EmissionFactorRef

@dataclass(frozen=True)
class Scope2Result:
    scope2_tco2e_baseline: float       # total_power_kwh_baseline/1000 × factor (참고: Before 총배출량)
    scope2_tco2e_after: float          # total_power_kwh_after/1000 × factor (참고: After 총배출량)
    reduction_tco2e: float | None      # (ei_baseline - ei_after) × production_kg / 1000 × factor
    formula_text: str                  # 산식 전문 + 실제 대입값(재현 가능, MASTER 3.3 ③)
    emission_factor_version: str

def compute_scope2_reduction(
    inputs: Scope2Input,
) -> Scope2Result:
    """MASTER 3.3 그대로. 순수·결정론.
    단위: EI(kWh/kg) × production_kg(kg) = kWh → /1000 = MWh → × factor(tCO2e/MWh) = tCO2e.
    규칙:
      - ei_baseline 또는 ei_after 가 None → reduction_tco2e = None(0 나눗셈/미산출 전파).
        scope2_tco2e_baseline/after 는 total_power_kwh 가 있으면 항상 산출(EI 미산출과 무관).
      - production_kg <= 0 또는 factor <= 0 → ValueError(EI/OEI와 동일한 방어 규약).
    formula_text 는 위 산식 문자열에 실제 숫자를 대입한 사람이 읽는 텍스트를 반환한다
    (예: "감축량 = (4.87 - 4.10) kWh/kg × 2560 kg / 1000 × 0.4747 tCO2e/MWh = 0.936 tCO2e").
    """
    ...  # 구현: data-kpi-engineer
```

**★ 결정 필요(data-kpi-engineer 합의 게이트, ADR 0003과 동일한 절차)**: `production_kg`
(정규화 생산량)을 무엇으로 고정할지는 MASTER 문면만으로 완전히 확정되지 않는다. architect의
제안은 **After 기간의 실제 `biomass_delta_kg`**(현재 실제로 달성한 생산량)를 쓰는 것이다 —
"baseline 대비 실제 절감된 에너지"를 "실제 달성 생산량" 기준으로 환산해야 "생산량 증가
효과와 혼동되지 않는다"는 MASTER 문구의 의도(반사실적 비교: *동일한 생산량을 baseline
효율로 냈다면 썼을 전력 대비 실제로 얼마나 덜 썼는가*)에 부합한다고 판단하나, 이는 산식의
핵심 파라미터이므로 **`data-kpi-engineer`가 최종 확정**해야 `compute_scope2_reduction`
구현에 착수할 수 있다(1.3절 게이트, 슬라이스 M-KPI 선행 조건).

**★ 결정 필요 2**: `scope2_tco2e_baseline`/`scope2_tco2e_after`에 **동일한 단일
`emission_factor`** 를 적용할지, 아니면 각 기간에 유효했던 배출계수를 각각 적용할지도
data-kpi-engineer 확인 대상이다. architect 제안은 **단일 배출계수 고정**이다 — MASTER 3.3의
감축량 산식이 배출계수 항을 하나만 쓰는 것과 정합적이며, 두 기간에 다른 배출계수를 쓰면
"효율 개선"과 "국가 전력망 탄소집약도 변화"가 뒤섞여 "달성/미달성" 판정이 흐려진다
(MASTER 1장 "심사위원이 판정할 수 있는 증빙"이라는 제품 원칙과 직결).

`RecommendConfig`/`OeiConfig`와 달리 이번엔 `kpi_config` 서브키 확장이 필요 없다 — 계수는
`emission_factors` 테이블 자체가 버전 저장소이므로 별도 `mrv` config 서브키는 두지 않는다
(과설계 금지).

### 1.4 `before_json`/`after_json` 구조 (MRV 리포트 필수 구성 ①)

```jsonc
{
  "period": { "from": "...", "to": "..." },
  "config_version": "2026.1.0",
  "ei_total": 4.87, "ei_aeration": 2.31,
  "total_power_kwh": 12480.0, "aeration_power_kwh": 5920.0,
  "biomass_delta_kg": 2560.0,
  "scope2_tco2e": 5.92,
  "kpi_snapshot_id": "snap-..."          // drill-down (1.7절)
}
```
`before_json`은 `baselines` 행 + `baseline.kpi_snapshot_id`에서 그대로 복사(재계산 금지 —
ADR 0002 불변성과 동일 정신). `after_json`은 요청 시점에 `compute_site_kpi_results`를
호출(기존 `kpi_service` 재사용, 신규 엔진 없음)하고 **`persist_kpi_snapshot`으로 영속화**
(Phase 1 헬퍼 재사용)한 뒤 그 결과를 담는다.

### 1.5 API 계약

```
POST /sites/{site_id}/mrv-reports/generate
Authorization: Bearer <JWT>   # require_writer + require_plan("PRO","ENTERPRISE") — 화면10은 PRO
Content-Type: application/json
{
  "after_period": { "from": "2026-07-01T00:00:00Z", "to": "2026-07-31T23:59:59Z" },
  "emission_factor_id": null   // 생략 시 활성(최신 effective_from) 배출계수 사용
}
```
처리(단일 트랜잭션, `baseline lock`과 동형 패턴):
1. 3중 테넌시 방어. `require_plan`+`require_writer` 게이트.
2. `after_period.from >= after_period.to` → 422.
3. locked baseline 조회 → 없으면 404 `"baseline not locked"`(`comparison.py`와 동일 문구 재사용).
4. `emission_factor_id` 지정 시 존재/유효성 확인(404), 미지정 시 활성 배출계수 로드(없으면
   404 `"no emission factor configured"` — Rule 5, 값 부재를 묵시적 0으로 처리하지 않는다).
5. `compute_site_kpi_results`로 after 기간 4종 산출(EI만 Scope2에 쓰지만 나머지도 함께
   영속화 — 리포트 drill-down이 EI 외 지표도 참조할 수 있게, 스냅샷은 이미 4종 전체 저장).
6. `persist_kpi_snapshot` → `after_kpi_snapshot_id`.
7. `compute_scope2_reduction` 호출(baseline.ei_total, after.ei_total, production_kg=after
   biomass_delta_kg, emission_factor) → `Scope2Result`.
8. `before_json`/`after_json`/`boundary_json`(1.6절) 조립.
9. **PDF 렌더링**(1.7절) → `pdf_path` 확정.
10. `mrv_reports` 삽입 + `audit_logs`(action='generate', Rule 9 — 공식 증빙 문서 발급은
    감사 대상으로 취급).
11. 커밋 → 201.

응답 201(요약, PDF 바이트는 별도 엔드포인트):
```jsonc
{
  "id": "mrv-...", "site_id": "...", "org_id": "...",
  "baseline_id": "bsl-...",
  "period": { "from": "...", "to": "..." },
  "before": { /* 1.4절 구조 */ }, "after": { /* 1.4절 구조 */ },
  "reduction_tco2e": 0.936,
  "formula_text": "감축량 = (4.87 - 4.10) kWh/kg × 2560 kg / 1000 × 0.4747 tCO2e/MWh = 0.936 tCO2e",
  "emission_factor": { "version": "2024-GIR-v1", "source": "...", "year": 2024 },
  "boundary": { /* 1.6절 */ },
  "pdf_available": true,
  "generated_by": "user_...", "generated_at": "..."
}
```
```
GET /mrv-reports/{id}                 # 위와 동일 shape(재조회). 인증만 요구, plan 게이트 없음(★)
GET /mrv-reports/{id}/pdf             # Content-Type: application/pdf, 파일 스트림. 동일(★)
GET /sites/{site_id}/mrv-reports?limit=&offset=   # 리포트 이력(화면10 목록), PRO 이상
```
에러 공통: `401`, `403`(viewer/START 플랜 — 목록/생성에만 해당), `404`(site/baseline/
emission_factor/report 없음 또는 타 org), `422`(기간 오류).

**(★) 개별 리포트 조회(`GET /mrv-reports/{id}`, `.../pdf`)는 의도적으로 plan 게이트가 없다**
(qa-reviewer 검증 시 확인된 모호성을 여기서 명시 확정 — 2026-07-07). 근거: MRV 리포트는
발급된 순간 "증빙 문서"가 되고, 조직이 이후 PRO→START로 다운그레이드하더라도 이미 발급된
증빙을 열람·재다운로드하지 못하게 막는 것은 "탄소저감 성과 리포트"라는 산출물의 신뢰성과
배치된다(심사/거래처 제출본을 나중에 못 열어보면 증빙 가치가 없다). **생성(`POST .../generate`)
과 목록 조회(이력)만 PRO 게이트 대상**이며, 특정 id를 이미 아는 상태의 단건 조회는 3중
테넌시 방어(같은 org 소속인지)만으로 충분히 보호된다.

### 1.6 측정경계·가정(boundary) — 자동 생성, 자유 입력 아님

MRV 리포트 필수 구성 ②("기간·측정경계·가정 명시")를 사람이 매번 타이핑하게 하면 오탈자·
누락 리스크가 생기고 재현성이 깨진다. **자유 입력 필드를 만들지 않는다.** 대신 이미 존재하는
근거 데이터에서 **결정론적으로 생성**한다(서비스 조립 로직, Rule 1 무관):

```jsonc
"boundary": {
  "site_id": "...", "site_name": "...",
  "included_meter_ids": ["mtr_power_main", "mtr_power_blower"],   // EiResult.source_meter_ids
  "included_quality_flags": ["ok"],                               // kpi_config.ei.included_quality_flags
  "biomass_source_refs": { "before": [...], "after": [...] },     // harvest_logs 참조
  "config_version": { "before": "2026.1.0", "after": "2026.2.0" }, // 다르면 FE가 경고 배지(phase-2 3.3절 관례 재사용)
  "assumptions": [
    "전력사용량은 site 전체 전력계(main+blower 서브미터) 합산 기준이다.",
    "생산량은 harvest_logs 개시/마감 시점 biomass_kg 차이로 정의한다(Δbiomass).",
    "감축량은 After 기간 실제 생산량을 기준으로 정규화했다(생산량 증가 효과 배제)."
  ]
}
```
`assumptions` 배열은 **고정 문자열 템플릿**(코드 상수, `mrv_report_service.py`)이며 산출값에
따라 조건부로 문구가 추가될 뿐 사용자가 편집하지 않는다(재현성). 커스터마이즈가 필요해지면
6절처럼 다음 Phase로 미룬다.

### 1.7 검증 추적성(drill-down) — kpi_snapshots까지

MASTER 3.3 검증 원칙("MRV 수치는 항상 원천 Reading까지 역추적 가능") 충족을 위해 신규
엔드포인트 하나를 추가한다(현재 스냅샷 저장은 되지만 조회 API가 없다 — 갭 보강):

```
GET /kpi-snapshots/{id}
Authorization: Bearer <JWT>
```
응답: `kpi_snapshots` 1행 그대로(스칼라 5종 + `inputs_json` + `provenance_json` +
`config_version`). 3중 테넌시 방어(`site_id`로 org 재검증). 이 엔드포인트로
`before.kpi_snapshot_id`(=baseline의 snapshot)와 `after_kpi_snapshot_id`를 각각 클릭해
들어가면 원본 readings까지 참조 ID로 역추적 가능(그 다음 단계인 "원시 reading 값 자체
조회"는 기존 `GET /sites/{id}/readings?meter_id=...&from=...&to=...`로 이미 가능 — 신규
엔드포인트 불요, phase-2 4.1절 재사용).

### 1.8 PDF 생성 파이프라인 (ADR 0004 요약)

`docs/adr/0004-mrv-pdf-report-engine-selection.md`(Accepted): **WeasyPrint** 채택.
- 신규 의존성: `weasyprint`, `jinja2` (`apps/api/pyproject.toml`), Dockerfile에 pango/cairo/
  gdk-pixbuf apt 패키지 추가(브라우저 불요, 이미지 크기 최소화).
- 템플릿: `apps/api/app/templates/mrv_report.html`(Jinja2) — before/after 비교표, 측정경계/
  가정, 산식 전문(`formula_text`), 전후 그래프(서버 생성 인라인 SVG, 외부 플로팅 라이브러리
  불요), 적용 로그 참조(리포트에 `baseline_id`/`after_kpi_snapshot_id`/추천이 있었다면
  `recipe_versions` 참조 — 있으면 표기, 없으면 생략) 를 필수 포함(MASTER 3.3 ①~⑤ 그대로).
- 한글 폰트: `apps/api/app/assets/fonts/`에 OFL 라이선스 폰트(Pretendard/Noto Sans KR) 파일을
  저장소에 포함해 `@font-face`로 직접 임베드(배포 환경 폰트 의존 제거).
- 저장 위치: 로컬 파일시스템(`MRV_REPORTS_DIR` 환경변수, 기본 `/app/var/mrv-reports`,
  docker-compose 볼륨 마운트로 컨테이너 재기동에도 보존). 파일럿 규모(사이트 소수·리포트
  월 단위 생성)에서 오브젝트 스토리지 도입은 과설계 — 사이트 수가 늘어 운영 이관이
  필요해지면 그때 ADR.

---

## 2. SOP 라이브러리 (화면8, PRO)

### 2.1 콘텐츠 저장 방식 — 정적 파일(마크다운) 채택, DB 테이블 아님

**결정**: SOP **문서 콘텐츠**(정상/이상 시나리오 설명, 체크리스트 항목 정의)는 사용자별
커스터마이즈 요구가 없으므로(MASTER 4장 화면8 어디에도 "편집" 요구 없음) **DB 테이블을
만들지 않는다**. `apps/api/app/content/sop/*.md` + `manifest.json`(메타: id/title/category/
checklist_items) 정적 파일로 관리하고, 백엔드가 파일을 읽어 API로 노출한다(FE 재배포 없이
콘텐츠 갱신 가능 — 정적 파일을 API 배포에 실어 서빙하는 정도로 충분, CMS 불요).

```
GET /sop                              # 목록: [{id, title, category, summary}]
GET /sop/{id}                         # 상세: {id, title, category, body_markdown, checklist_items:[{id,label}]}
```
`category`: `'normal'`(정상 운영) | `'water_quality'`(수질악화) | `'do_drop'`(DO 저하) |
`'mortality_spike'`(폐사증가) — MASTER 화면8 문구 그대로 4종. PRO 이상 게이팅(`require_plan`).

### 2.2 체크리스트 실행 기록 — 여기는 DB 테이블 필요(증빙 요구)

콘텐츠는 정적이지만, **"누가 언제 무엇을 점검했는가"는 증빙**이므로(MASTER 11장 "SOP PDF +
점검 체크리스트(앱 내 생성)") 실행 기록만 최소 테이블로 영속화한다:

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | String(64) PK | |
| `site_id` | FK sites | RLS 앵커 |
| `org_id` | FK organizations | RLS 비정규화 |
| `sop_id` | String(64) | 정적 콘텐츠 `manifest.json`의 id(느슨한 참조, FK 아님 — 콘텐츠가
  DB 밖에 있으므로) |
| `items_json` | JSON | `[{ "item_id": "...", "checked": true, "note": "..." }]` |
| `performed_by` | String(64) | JWT user_id |
| `performed_at` | timestamptz | append-only |

```
POST /sites/{site_id}/sop/{sop_id}/checklist-runs   { items: [{item_id, checked, note}] }
GET  /sites/{site_id}/sop/checklist-runs?sop_id=&from=&to=
```
`require_writer` 게이트 + `audit_logs`(Rule 9). append-only(수정 API 없음 — 재점검은 새 행).
PDF 내보내기는 1.8절 파이프라인(Jinja2+WeasyPrint)을 재사용 가능하나 **이번 Phase 필수는
아님**(P2, 여유 시) — 화면 조회 + CSV/화면 인쇄로도 "앱 내 생성" 요건은 충족되므로 우선순위
낮음(9절).

---

## 3. 승인형 제어 콘솔 (화면11, ENTERPRISE)

### 3.0 범위 명확화 — "반자동"의 의미 재확인

MASTER 어디에도 설비에 직접 명령을 보내는 액추에이터 프로토콜(MQTT 발행 토픽 등)이
정의되어 있지 않다(ingestion은 inbound telemetry 전용). 화면11의 "설비 적용"을 자동
액추에이터 제어로 확대 해석하면 이번 Phase에서 새 통신 프로토콜을 발명해야 하므로 과설계다.
**결정**: "적용(apply)"은 **"운영자가 추천값을 실제 설비에 물리적으로 반영한 뒤, 그 사실과
결과를 시스템에 기록하는" 사람 개입(human-in-the-loop) 흐름**으로 범위를 좁힌다(MASTER의
"반자동"이라는 표현과 정합적). 향후 하드웨어 파트너와 실제 액추에이터 연동이 확정되면
그때 별도 ADR로 자동 명령 채널을 설계한다.

### 3.1 `control_actions` 테이블 (MASTER 6장 그대로 + RLS 보강)

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | String(64) PK | `ca-{uuid4}` |
| `tank_id` | FK tanks | MASTER 6장 그대로 |
| `recipe_version_id` | FK recipe_versions | 추천 버전 참조 |
| `site_id` | FK sites | RLS 앵커(보강, tanks 경유 조회 비용 줄이기 위한 비정규화) |
| `org_id` | FK organizations | RLS 비정규화(보강) |
| `recommended_json` | JSON | 후보 등록 시점 `recipe_versions.params_json` **스냅샷**(이후
  recipe가 새 버전으로 바뀌어도 이 행은 불변 — baseline과 동일 스냅샷 철학) |
| `status` | String(16) | `'pending'`\|`'approved'`\|`'rejected'`\|`'applied'`. CHECK 제약 |
| `approved_by` / `approved_at` | String(64) / timestamptz NULL | |
| `applied_at` | timestamptz NULL | |
| `result_json` | JSON NULL | 적용 후 운영자가 기록한 관측/결과(예: 적용된 실측 DO, 비고) |
| `created_at` | timestamptz | |

**★ 승인 게이트 물리적 강제(사용자 명시 요구 — "절대 우회하지 않는 구조")**:
```sql
CHECK (status != 'applied' OR approved_at IS NOT NULL)
CHECK (status != 'approved' OR approved_by IS NOT NULL)
```
ADR 0002의 "관례만으로는 부족하다" 철학을 그대로 적용 — DB 제약으로 "승인 없이 적용 상태에
도달"을 물리적으로 차단한다(애플리케이션 버그·수동 SQL까지 방어). API 계층에서도 이중 방어:
`apply` 엔드포인트는 **현재 status가 정확히 `'approved'`일 때만** 전이를 허용하고, 그 외는
전부 `409`(경합/우회 시도 모두 동일하게 거부).

### 3.2 API 계약

```
POST /control-actions
Authorization: Bearer <JWT>   # require_writer + require_plan("ENTERPRISE")
{ "tank_id": "...", "recipe_version_id": "..." }
```
처리: tank/recipe_version 소유권 검증(3중 방어) → `recipe_versions.params_json` 스냅샷 복사
→ `status='pending'` 삽입 → `audit_logs`(action='propose'). 응답 201.

```
POST /control-actions/{id}/approve
Authorization: Bearer <JWT>   # require_writer + require_plan("ENTERPRISE")
{}
```
처리: `status=='pending'`일 때만 `'approved'`로 전이(그 외 `409 "invalid transition"`).
`approved_by`/`approved_at` 기록 + `audit_logs`(action='approve'). **이중 확인 UX**: FE는
Phase 1 `ConfirmLockDialog.tsx` 패턴을 재사용해 "정말 승인하시겠습니까? 승인 후에는 적용
단계로 진행됩니다"를 명시적으로 재확인시킨다(백엔드가 최종 방어선, FE는 오조작 방지용).

```
POST /control-actions/{id}/reject
{ "note": "..." }
```
`pending → rejected`만 허용(그 외 409). 승인 거부 사유는 `result_json`이 아니라 별도
`audit_logs.note`로 남긴다(승인 안 된 건은 "적용 결과"라는 개념 자체가 없어야 하므로
`result_json`을 오염시키지 않는다).

```
POST /control-actions/{id}/apply
Authorization: Bearer <JWT>   # require_writer + require_plan("ENTERPRISE")
{ "result_json": { "applied_note": "...", "observed_do_mg_l": 6.4 } }
```
처리: **`status=='approved'`일 때만** 통과(그 외 `409 "control action not approved"` — 이
분기가 승인 게이트의 핵심 실행 지점). `applied_at`/`result_json` 기록, `status='applied'`,
`audit_logs`(action='apply'). FE 이중 확인 다이얼로그 재사용(2차 재확인 — "설비에 실제로
적용하셨습니까?").

```
GET /control-actions?site_id=&status=pending|approved|rejected|applied|all
GET /control-actions/{id}
```
목록/상세 조회(승인 대기열 화면). 전부 `require_plan("ENTERPRISE")`, 조회는 `require_writer`
불요(viewer도 대기열 확인 가능, 승인/적용/제안만 writer 게이트).

에러 공통: `401`, `403`(viewer의 쓰기 시도/START·PRO 플랜), `404`(리소스 없음/타 org),
`409`(상태 전이 규칙 위반 — 승인 게이트 우회 시도 포함).

---

## 4. 멀티사이트 관리 (화면12, ENTERPRISE) — 축소 범위

### 4.1 축소 판단 (과설계 금지)

사이트별 세분화 권한 모델(예: "이 operator는 site A만 접근")은 MASTER 6장 스키마에
`site_id`별 권한 테이블이 없고, 현재 `users.role`은 **org 전역**이다. 파일럿 규모(조직당
사이트 소수)에서 site별 RBAC까지 만드는 것은 과설계다. **결정**: 이번 Phase는
**"org 소속 여러 site 목록 조회 + KPI 벤치마크 비교"만** 제공하고, 권한은 기존
org-level role(owner/operator/viewer)을 그대로 적용한다. site별 세분화 권한이 실제
ENTERPRISE 파일럿에서 요구되면 그때 ADR + 스키마 확장(예: `user_site_roles` 테이블)으로
대응한다.

### 4.2 API 계약

```
GET /sites
Authorization: Bearer <JWT>
```
응답: `auth.org_id` 소속 전체 site 요약 목록(신규 — 현재 이런 목록 엔드포인트 자체가 없다,
onboarding 화면7.2절에서도 필요). `{ items: [{id, name, region, ras_type}], total }`.
플랜 게이팅 없음(단일 site 조직도 자기 site 목록을 볼 권리는 있다 — START/PRO에서도 유용).

```
GET /sites/kpi-benchmark?from=&to=
Authorization: Bearer <JWT>   # require_plan("ENTERPRISE")
```
처리: org의 모든 site에 대해 기존 `compute_site_kpi_results`를 반복 호출(신규 엔진 없음,
Rule 1 위반 아님 — 조립 반복일 뿐). 응답:
```jsonc
{
  "period": { "from": "...", "to": "..." },
  "sites": [
    { "site_id": "...", "site_name": "...", "config_version": "2026.2.0",
      "metrics": { "ei_total": 4.10, "ei_aeration": 1.95, "oei": 78.9, "fcr": 1.35, "mortality_rate": 4.80 } },
    { "site_id": "...", ... }
  ]
}
```
정렬/랭킹·색상 하이라이트는 FE 표시 로직(신규 산식 아님). N+1 site 순회 쿼리 성능은 사이트
수가 파일럿 규모(수 곳)를 넘어서기 전까지는 문제되지 않는다고 판단(4.2절 phase-2 continuous
aggregate 판단과 동일 논리) — 실측에서 느려지면 그때 최적화.

---

## 5. 감사 로그 뷰어 (화면14, ENTERPRISE)

`audit_logs`는 이미 Phase 1부터 baseline lock/수기입력/알림 ack 등에서 쌓이고 있다(Rule 9).
**신규 테이블 불필요** — 조회 API + 화면만 추가한다.

```
GET /audit-logs?entity=&action=&from=&to=&limit=&offset=
Authorization: Bearer <JWT>   # require_plan("ENTERPRISE"). 읽기 전용이므로 viewer 도 허용
  (승인/적용 등 쓰기 게이트가 아니라 "누가 무엇을 했는지 투명하게 보는" 기능 자체가 목적)
```
응답: `auth.org_id` 스코프(AuditLog.org_id, 기존 RLS 그대로 적용) 필터 결과.
```jsonc
{
  "items": [
    { "id": "audit-...", "entity": "baselines", "entity_id": "bsl-...", "action": "lock",
      "actor_id": "user_...", "diff": {"before": null, "after": {...}}, "ts": "..." }
  ],
  "total": 1
}
```
`entity` 필터는 화이트리스트 검증 없이 문자열 그대로 매칭(신뢰 가능한 내부 값이므로 과설계
불필요). 신규 산식/도메인 판단 없음 — 순수 조회 API(backend-engineer 단독 구현 가능).

---

## 6. 맞춤 리포트 빌더 (화면13, ENTERPRISE) — ★ 이번 Phase 범위에서 제외

**결정**: 이번 Phase에서 **손대지 않는다**. 다음 Phase(또는 협약기간 이후 로드맵)로 미룬다.

근거(과설계 금지 원칙):
- MASTER 11장 "산출물 ↔ 평가 증빙 매핑"에서 "탄소저감 성과 리포트"는 **MRV 리포트 하나로
  충분히 충족**된다(1절). 커스터마이즈 가능한 리포트 빌더는 평가 증빙 매핑 어디에도 직접
  대응하지 않는다.
- ENTERPRISE 고객은 파일럿 2곳 목표 중에서도 가장 소수일 가능성이 높다(CLAUDE.md "최소
  START·PRO 완성"이 최우선). 템플릿 커스터마이즈 엔진(섹션 추가/삭제/재배열 UI, 저장된
  템플릿 관리)은 신규 상태 모델과 상당한 FE 작업을 요구해 7개월 협약기간 리스크를 키운다.
- 1.8절 PDF 파이프라인(Jinja2+WeasyPrint)은 이미 "템플릿 기반"이므로, 향후 이 기능을 열 때
  **재사용 가능한 기반이 이미 준비되어 있다** — 지금 만들지 않아도 나중 비용이 크게 늘지
  않는다(선반영 불필요, 진짜 과설계 회피 사례).

---

## 7. 온보딩 마법사 (화면16, 공통)

### 7.1 단계 구성 (MASTER: "설치키트→센서매핑→기준선수집→유료전환")

기존 자산 재사용: 기준선 수집·잠금은 이미 화면15(설정)에 구현되어 있다(`/baseline`,
`BaselineLockPage.tsx`). 온보딩은 **새 기능을 만드는 게 아니라 기존 조각들을 순서대로
안내하는 오케스트레이션 화면 + 최소 2개 신규 API**(설치키트 단계에 필요한 meter 등록이
현재 API 자체가 없다 — 아래 7.2절)로 구성한다.

### 7.2 신규: 계측기(meter) 등록 API (설치키트→센서매핑 단계에 필수, 현재 갭)

현재 `meters`는 시드 스크립트로만 생성되고 API가 없다. 온보딩·실제 파일럿 확장 모두에
필요하므로 이번 Phase에 최소 CRUD(생성/목록만, 수정·삭제는 다음 Phase로 미룸 — 계측기 교체는
운영 이벤트라 신중해야 하고 과설계 회피)를 추가한다.

```
POST /sites/{site_id}/meters
Authorization: Bearer <JWT>   # require_writer
{ "type": "power"|"do"|"temp"|"ph"|"orp"|"ec", "unit": "kWh_interval"|"mg_l"|...,
  "is_aeration": false, "tank_id": null, "label": "..." }
```
응답 201 + `audit_logs`(Rule 9, entity='meters'). MASTER 9장 규제훅("IoT/무선기기(KCC),
전기안전(KC) 인증정보·라벨 필드")을 이번에 반영: `label` 외에 `certification_info`(선택,
자유 텍스트/JSON) 컬럼을 `meters`에 추가해 "자리만" 마련한다(MASTER 9장 명시: "MVP에서
데이터 필드+자리만").
```
GET /sites/{site_id}/meters
```
목록 조회(센서 매핑 화면이 현재 등록된 계측기를 보여주는 데 필요).

### 7.3 온보딩 진행 상태 — 파생 조회(신규 상태 테이블 불필요)

**결정**: 별도 `onboarding_status` 테이블/컬럼을 만들지 않는다. 이미 존재하는 데이터에서
**매 요청 시 파생 계산**한다(과설계 금지 — 상태 동기화 버그 리스크 자체를 없앤다):

```
GET /sites/{site_id}/onboarding-status
Authorization: Bearer <JWT>
```
```jsonc
{
  "steps": {
    "install_kit":     { "done": true,  "detail": "api_keys 1개 이상 발급됨" },
    "sensor_mapping":   { "done": true,  "detail": "meters 2개 등록됨" },
    "baseline_locked":  { "done": false, "detail": "잠긴 baseline 없음" },
    "plan_active":      { "done": false, "detail": "현재 플랜: START(무료/평가)" }
  },
  "current_step": "baseline_locked"
}
```
판정 로직(신규 산식 아님, 단순 존재 여부 조회 — backend-engineer 단독): `api_keys` 존재,
`meters` 존재, `baselines(status='locked')` 존재, `organizations.plan != 'START'`(또는 별도
"평가판" 개념이 필요하면 `organizations`에 `trial` bool 컬럼 — 이번엔 plan 값 자체로 충분하다
판단, 과설계 금지).

### 7.4 유료 전환(plan 변경) — 결제 연동은 범위 밖

실제 결제 게이트웨이 연동은 이번 Phase 범위가 아니다(MASTER 어디에도 결제 시스템 요구 없음
— "협약기간 내 유료 파일럿 2곳 전환"은 계약/청구가 오프라인으로 이뤄지는 B2B 영업 프로세스로
읽는 것이 타당). 시스템은 **플랜 값을 반영하는 최소 엔드포인트만** 제공한다:

```
PATCH /organizations/{org_id}/plan
Authorization: Bearer <JWT>   # owner 한정(operator/viewer 403)
{ "plan": "PRO" }
```
`plan ∈ {START, PRO, ENTERPRISE}` 검증(그 외 422). `audit_logs`(Rule 9, entity='organizations',
action='plan_change'). 이 엔드포인트는 결제 확인 **후** 컬리버 운영진/owner가 수동으로
호출하는 것을 전제한다(자동 청구 없음 — 명시적 범위 제한).

---

## 8. 프로덕션 준비성 (★사용자 "상용화" 요구 직접 반영)

### 8.0 ★ 발견된 치명적 갭 — 실 로그인 발급 부재 → **Supabase Auth로 확정(사용자 결정)**

코드 감사 결과 **실제 로그인(비밀번호 검증 → JWT 발급) 경로가 시스템에 전혀 없다**. 현재
JWT는 테스트 헬퍼로만 발급되고, `users` 테이블에는 비밀번호 컬럼조차 없다. "상용화 수준"을
논하는 이번 Phase에서 **고객이 스스로 로그인할 방법이 없다는 것은 이 요구를 근본적으로
가로막는다**. MASTER 5장은 "JWT/Supabase Auth 또는 자체 JWT"를 둘 다 열어 뒀다.

architect는 애초에 "이미 JWT 검증 인프라가 존재한다"는 근거로 자체 로그인(bcrypt +
`POST /auth/login`)을 권고했으나, **최종 결정권자인 사용자가 Supabase Auth 통합을 명시적으로
선택**했다. 이 결정을 그대로 따르며, 설계는 architect가 확정한다 — 전문은
**`docs/adr/0005-supabase-auth-integration.md`**(근거·대안·트레이드오프) +
**`docs/design/phase-3-auth.md`**(스키마/`deps.py`/API/FE/테스트 전략 구현 계약)를 참고한다.
8.0절 초안의 `password_hash`/`POST /auth/login` 안은 **폐기**되었다.

핵심 결정 요약(전문은 위 두 문서):
- JWT 검증: Supabase 프로젝트의 **레거시 HS256 공유 비밀**(`SUPABASE_JWT_SECRET`) 채택.
  JWKS/비대칭키는 채택하지 않음(과설계 금지 — 기존 `deps.py`의 `jwt.decode` 경로를 그대로
  재사용, 검증이 완전히 오프라인·결정론적이라 테스트도 오프라인으로 가능해짐).
- `org_id`/`role` 연계: Supabase Auth Hooks(custom claims)를 **채택하지 않는다**. 매 요청
  `users` 테이블을 조회(supabase_user_id 인덱스 조회 1회)한다 — 기존 `GET /auth/me`가 `plan`을
  토큰에 굽지 않은 것과 동일한 "즉시 반영" 논리를 `role`에도 대칭 적용.
  `users`는 RLS 대상 테이블이 아니므로 org 컨텍스트를 모르는 시점의 조회도 안전하다.
- `users` 테이블: `password_hash` 대신 `supabase_user_id`(nullable) 컬럼 추가.
- 로그인/프로비저닝: **초대 기반**(신규 `POST /organizations/{org_id}/users`, owner 전용,
  `supabase_user_id=NULL`로 생성) + 첫 로그인 시 이메일 매칭으로 자동 연계(lazy-link, 0건→403/
  1건→연계/2건 이상→409). 자동 회원가입/셀프서비스 org 생성은 범위 밖.
- ★테스트 전략: `AUTH_MODE`(`test-local`|`supabase`) 스위치 도입. 기존 `_make_token` 기반
  테스트 전부(24개 이상 파일) **무변경**(`test-local`이 기존 동작 그대로 유지). 신규
  `AUTH_MODE=supabase` 경로는 합성 HS256 토큰으로 오프라인 테스트(진짜 Supabase 불요).
  `environment=production`에서 `auth_mode!=supabase`면 **설정 로드 시점에 기동 실패**(물리적
  강제, ADR 0002와 동형).
- FE: `@supabase/supabase-js` 도입. `api-client.ts::getAuthToken()`은 시그니처 불변으로
  Supabase 세션 캐시로 소스만 교체(기존 코드에 이미 "인증 모듈이 붙으면 이 함수만 교체" 주석이
  이 지점을 정확히 예견하고 있었다). `useAuth`는 Supabase JWT에 `org_id`/`role`이 없으므로
  `GET /auth/me` 결과를 소스로 재구성. 범위는 로그인+세션 유지로 최소화(회원가입/재설정 UI 제외).

ADR 상태: **`0005` = Proposed**(스택 선택은 확정, 코드 구현 착수 가능. 실제 Supabase 프로젝트
생성·키 발급은 사용자/컬리버 운영진 몫이며 완료 전까지 `AUTH_MODE=supabase`의 실 운영 배포는
불가 — 설정 가드가 막는다. 개발/테스트는 즉시 진행 가능).

### 8.1 비밀값 관리 점검

`infra/.env.example` 현재 항목(DB/JWT/APP/MQTT)에 Phase 3 신규 항목을 추가해야 한다:
```
# --- MRV 리포트(Phase 3) ---
MRV_REPORTS_DIR=/app/var/mrv-reports

# --- CORS(Phase 3, 8.4절) ---
CORS_ALLOWED_ORIGINS=http://localhost:5173

# --- 로깅(Phase 3, 8.2절) ---
LOG_LEVEL=INFO

# --- 로그인(8.0절, ADR 0005 — Supabase Auth로 확정. 전문은 phase-3-auth.md) ---
AUTH_MODE=test-local
SUPABASE_JWT_SECRET=
SUPABASE_URL=
```
`JWT_SECRET` 기본값이 `"dev-insecure-change-me"`로 코드에 박혀 있다(`config.py`) — 운영
배포 시 반드시 `.env`로 재정의해야 함을 README/배포 체크리스트에 명시(코드 변경 아님,
운영 절차 문서화 항목). `JWT_SECRET`은 `AUTH_MODE=test-local`(개발/테스트 전용) 경로에서만
쓰이므로 운영 배포(`AUTH_MODE=supabase`)에서는 `SUPABASE_JWT_SECRET`이 대신 필수다(ADR 0005
5절 — production에서 `AUTH_MODE!=supabase`면 설정 로드 시점에 기동 자체가 실패한다).

### 8.2 구조화 로깅

현재 `print()`가 `worker.py`/`mqtt_consumer.py`에만 있고 API 요청 로깅 자체가 없다. 결정
(과설계 금지 — 외부 로그 수집기 연동은 하지 않는다, stdout 구조화까지만):
- Python 표준 `logging` + 최소 JSON 포맷터(`app/logging_config.py` 신규, 외부 의존성 추가
  없이 stdlib `logging.Formatter` 서브클래스로 충분) 도입.
- `print()` 전부 `logger.info/warning/error`로 치환.
- FastAPI 미들웨어 1개 추가: 요청마다 `{method, path, status_code, duration_ms, org_id(있으면)}`
  1줄 로그. **비밀값·JWT 원문·PII(email 등)는 로그에 남기지 않는다**(OWASP A09/A02 교차 원칙).
- 컨테이너는 stdout으로만 출력(도커/오케스트레이터가 수집 — Grafana 등 연동은 MASTER 5장
  "확장 시" 명시대로 이번 범위 밖).

### 8.3 헬스체크 — `/health`(liveness) + `/ready`(readiness) 분리

현재 `/health`는 DB를 확인하지 않는 단순 200 응답(liveness에는 적합하나 readiness로는
불충분 — DB 연결이 끊겨도 "정상"으로 보고됨). 결정:
- `GET /health`: 기존 그대로 유지(빠른 liveness, DB 미조회).
- `GET /ready`(신규): `SELECT 1`을 DB에 실행해 연결 확인. 성공 200 `{"status":"ready"}`,
  실패 503 `{"status":"not_ready","detail":"..."}`.
- `infra/docker-compose.yml`의 `api` 서비스 `HEALTHCHECK`/`healthcheck.test`를 `/ready`로
  교체 권고(현재 `/health`를 치고 있어 "컨테이너는 떠 있는데 DB가 끊긴" 상태를 못 잡는다).

### 8.4 CORS 설정 — ★ 현재 완전 부재(P0)

`main.py`에 `CORSMiddleware`가 전혀 등록되어 있지 않다. 배포된 FE가 API와 다른 오리진이면
브라우저가 요청을 차단한다(현재는 개발 중 프록시 등으로 가려져 있을 수 있으나 실배포에서
반드시 드러난다). 계약:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,  # .env 콤마구분 → list 파싱
    allow_credentials=False,   # Bearer 헤더 방식이라 쿠키 자격증명 불요(CSRF 표면 축소)
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
```
운영 배포에서는 `CORS_ALLOWED_ORIGINS`에 실제 FE 도메인만 명시(와일드카드 `*` 금지 — Bearer
토큰을 쓰더라도 응답 데이터 유출 방지 원칙).

### 8.5 에러 응답 스키마 일관성

기존 코드 감사 결과: 모든 라우터가 이미 `HTTPException(status_code=..., detail="...")`
패턴을 **일관되게** 쓰고 있다(FastAPI 기본 `{"detail": "..."}}` 봉투) — 이 관례는 그대로
유지한다(불필요한 커스텀 에러 봉투 재설계는 과설계). **갭은 예기치 못한 예외**: 현재
uncaught exception이 발생하면 FastAPI 기본 500 처리로 넘어가 위 관례와 다른 형태(또는
운영모드에서 트레이스백 노출 위험)가 될 수 있다. 결정:
```python
@app.exception_handler(Exception)
def _unhandled_exception_handler(request, exc):
    logger.error("unhandled exception", exc_info=exc, extra={"path": str(request.url)})
    return JSONResponse(status_code=500, content={"detail": "internal server error"})
```
이로써 **모든** 에러 응답이 예외 없이 `{"detail": "..."}` 봉투로 통일된다(OWASP A05 — 내부
구현 노출 방지도 겸함).

### 8.6 API 문서화(OpenAPI `/docs`)

이미 `FastAPI(title=..., description=..., version=...)`로 자동 노출 중 — 갭 없음. 운영
배포 시 공개 여부는 설정 가능하게만 열어 둔다(`settings.enable_docs: bool = True`,
`app = FastAPI(docs_url="/docs" if settings.enable_docs else None, ...)`). 기본값은 유지
(인증이 최종 방어선이므로 문서 자체를 숨길 필수 이유는 없음 — 필요시 끄는 스위치만 확보).

### 8.7 Rate limiting 필요성 판단 — 이번 Phase는 전역 도입 안 함(과설계 금지)

파일럿 규모(사이트 소수·동시 사용자 소수)에서 전역 rate limiting 미들웨어(Redis 등 신규
인프라 요구)는 과설계로 판단해 **도입하지 않는다**. 예외적으로 주의가 필요한 표면:
- `POST /ingest/readings`: API Key 기반, 외부 게이트웨이가 호출하는 공개 도달 가능
  엔드포인트. 오남용 방어가 값어치 있으나 별도 인프라 없이 **단일 프로세스 in-memory
  슬라이딩 윈도**(API Key별 분당 요청 수 제한) 정도로 충분 — 멀티 인스턴스 확장 시
  Redis 기반으로 교체가 필요해지면 그때 ADR. **P2(여유)로 배치**, 이번 Phase 필수 게이트
  아님.
- 8.0절 로그인 엔드포인트가 실제로 만들어지면(사용자 확인 후) **brute-force 방어용
  rate limit은 그 슬라이스의 필수 수용 기준**으로 격상한다(로그인이 없는 지금은 해당 없음).

### 8.8 OWASP Top 10 점검 체크리스트 (요약)

| 항목 | 현황 | Phase 3 조치 |
|---|---|---|
| A01 Broken Access Control | 3중 방어(인증/RLS/서비스) + `require_plan` 게이팅 존재 | 신규 엔드포인트(MRV/제어콘솔/감사로그/멀티사이트)도 동일 패턴 강제(9절 QA 게이트) |
| A02 Cryptographic Failures | JWT 대칭키 기본값이 코드에 하드코딩(`dev-insecure-...`) | 8.1절: 운영 배포 체크리스트에 `.env` 재정의 명시. 로그인 도입 시 bcrypt 해시(8.0절) |
| A03 Injection | SQLAlchemy ORM 전면 사용, raw SQL 문자열 결합 미발견 | 신규 코드도 동일 원칙 유지(QA 코드리뷰 항목) |
| A05 Security Misconfiguration | CORS 부재(8.4절), `/docs` 상시 노출(8.6절 판단 완료) | CORS 추가(P0), 문서화 스위치만 확보 |
| A07 Identification & Auth Failures | ★로그인 발급 경로 부재(8.0절) | Supabase Auth 통합으로 확정(ADR 0005, `phase-3-auth.md`), P0 구현 착수 가능 |
| A08 Software/Data Integrity Failures | 의존성이 `>=` 범위 핀(정확 버전 미고정) | 이번 Phase 필수는 아님 — lockfile(예: `uv.lock`) 도입은 별도 판단(P2, 배포 재현성 향상용) |
| A09 Logging & Monitoring Failures | print 산발적, 요청 로그 없음(8.2절) | 구조화 로깅 도입(P0) |
| A10 SSRF | 외부 URL 페치 로직 없음(현재 범위에서 해당 사항 없음) | 해당 없음 |

---

## 9. 수직 슬라이스 분해 + 위임 제안 + 우선순위

**START·PRO(MRV 리포트, 프로덕션 준비성, 온보딩)를 ENTERPRISE(제어콘솔·멀티사이트)보다
우선**한다(CLAUDE.md 원칙). 각 슬라이스는 DB→엔진/서비스→API→(UI)를 관통하며 **수용 기준**과
**MASTER 11장 증빙**, **위임 대상**을 갖는다.

### 슬라이스 P0-0 — 기존 갭 긴급 보수 (P0, 선행 전제)
- 내용: CORS 미들웨어 추가(8.4절). `GET /ready` 추가(8.3절). (`auth_router` 등록은 이미
  해소됨 — 0절 참고.)
- 수용: 브라우저 cross-origin 시나리오(FE dev 서버 기준) CORS 통과 확인, `/ready`가 DB
  재기동 시 503으로 정확히 전환되는 것을 통합테스트로 확인.
- 증빙(11장): "도입 패키지" 신뢰성 기반 / "현장 재현성"(운영 가능한 배포).
- 위임: **backend-engineer**, **qa-reviewer**.

### 슬라이스 M — MRV 리포트 끝까지 (★P0, Phase 3 헤드라인)
- 선행: **data-kpi-engineer가 1.3절 "결정 필요" 2건을 확정**(production_kg 정규화 기준,
  단일 배출계수 적용) — ADR 0003과 동일한 합의 게이트.
- 내용: `emission_factors`+`mrv_reports` 마이그레이션, `culiver_kpi/mrv.py`(M-KPI),
  `GET /kpi-snapshots/{id}`(1.7절 드릴다운 갭 보강), `POST /sites/{id}/mrv-reports/generate`
  +`GET /mrv-reports/{id}`+`GET /mrv-reports/{id}/pdf`+`GET /sites/{id}/mrv-reports`,
  PDF 파이프라인(ADR 0004: Jinja2 템플릿+WeasyPrint+한글 폰트 임베드), FE 화면10.
- 수용: baseline 없음(404), emission_factor 없음(404), reduction_tco2e 수기 검산 일치
  (`(ei_baseline-ei_after)×production_kg/1000×factor`), `formula_text`에 실제 대입값 포함,
  PDF가 필수 5구성(before/after표·경계/가정·산식전문·전후그래프·적용로그참조)을 모두 포함,
  한글이 배포환경 무관하게 동일하게 렌더(폰트 임베드 확인), before/after `kpi_snapshot_id`
  드릴다운이 `GET /kpi-snapshots/{id}`로 끝까지 열림, PRO 게이팅(START 403), 누수 테스트 green.
- 증빙(11장): "탄소저감 성과 리포트(MRV)" — 이번 Phase 최핵심 산출물.
- 위임: **data-kpi-engineer**(★M-KPI: mrv.py 구현+테스트, 최우선 병목), **backend-engineer**
  (스키마·API·PDF 파이프라인 배선), **frontend-engineer**(화면10, PDF 뷰어), **qa-reviewer**
  (수치 재현성·PDF 렌더 확인·플랜 게이팅).

### 슬라이스 N — 프로덕션 준비성 (P0, "상용화" 직접 반영)
- 내용: 8.1~8.6절 전부(비밀값 항목 보강, 구조화 로깅, `/ready`는 P0-0에서 이미 처리,
  전역 예외 핸들러, `/docs` 토글, CORS는 P0-0과 통합 진행 가능).
- 수용: 8.8절 OWASP 체크리스트 항목별 조치 완료 확인, 예기치 못한 예외도 `{"detail":...}`
  봉투로 응답, 로그에 비밀값/PII 미노출(코드리뷰+샘플 로그 확인), `.env.example` 신규 항목
  반영.
- 증빙(11장): "도입 패키지"(제품으로서 신뢰성) — MASTER 8장 NFR 보안 항목 직접 충족.
- 위임: **backend-engineer**, **qa-reviewer**(OWASP 체크리스트 게이트).

### 슬라이스 O — ★로그인 발급 (P0, Supabase Auth로 확정 — 8.0절, ADR 0005)
- 선행: 없음(스택 선택 확정 완료 — `docs/adr/0005-supabase-auth-integration.md` Proposed).
  구현 착수 가능. 단 실 운영 배포(`AUTH_MODE=supabase`)는 사용자가 Supabase 프로젝트/키를
  준비한 뒤에만 가능(ADR 0005 "실행 전제" 참고) — 개발/테스트는 즉시 진행.
- 전문 계약: **`docs/design/phase-3-auth.md`**(스키마·`deps.py`·API·FE·테스트 전략 전부 이
  문서 하나로 확정, 본 절은 요약만 유지).
- 내용: `users.supabase_user_id` 컬럼(마이그레이션), `AUTH_MODE` 설정 스위치 + production
  가드, `deps.py::get_auth_context` supabase 분기(HS256 공유비밀 검증 + `users` 조회 +
  lazy-link), `POST /organizations/{org_id}/users`(초대), FE `@supabase/supabase-js` 로그인
  페이지 + `api-client`/`useAuth` 갱신.
- 수용: `phase-3-auth.md` 8절 그대로(요약 — 기존 100개 이상 테스트 회귀 없음★최우선,
  supabase 모드 로그인/미초대/이중초대 분기, production+test-local 조합 기동 실패, 초대
  API owner 게이팅+누수 테스트, FE 세션 유지).
- 증빙(11장): "도입 패키지"(유료 전환 온보딩이 실제로 작동하기 위한 전제) / OWASP A07.
- 위임: **backend-engineer**(스키마/`deps.py`/초대 API/테스트), **frontend-engineer**
  (로그인 페이지/세션 배선), **qa-reviewer**(★기존 테스트 회귀 없음 + production 가드
  최우선 검증).

### 슬라이스 Q — 온보딩 마법사 (P1, START·PRO 완성 직후)
- 선행: O(로그인) 완료 권장(로그인 없이도 화면 자체는 만들 수 있으나 "유료 전환" 단계의
  의미가 반감).
- 내용: `POST/GET /sites/{id}/meters`(7.2절, 규제훅 필드 포함), `GET /sites/{id}/onboarding-status`
  (7.3절, 파생 조회), `PATCH /organizations/{id}/plan`(7.4절), FE 마법사(기존 baseline lock
  화면 재사용해 단계 안내로 연결).
- 수용: 4단계 상태가 실제 데이터와 일치(수기 검증), plan 변경이 owner만 가능(403 for
  operator/viewer), meter 등록 시 `certification_info` 필드 저장 확인(9장 규제훅), audit_logs
  기록.
- 증빙(11장): "현장 재현성"(설치·운영 매뉴얼의 앱 내 구현) / "도입 패키지"(유료 전환 흐름).
- 위임: **backend-engineer**, **frontend-engineer**, **qa-reviewer**.

### 슬라이스 R — SOP 라이브러리 (P1, PRO)
- 내용: `apps/api/app/content/sop/*.md`+manifest, `GET /sop`+`GET /sop/{id}`,
  `sop_checklist_runs` 마이그레이션+API(2.2절), FE 화면8.
- 수용: 4개 카테고리 콘텐츠 최소 1개씩 등록, 체크리스트 실행 기록 append-only 확인,
  PRO 게이팅, audit_logs 기록.
- 증빙(11장): "표준 운영 체계(SOP)" — 11장 매핑 직접 항목.
- 위임: **backend-engineer**(API/스키마), **data-kpi-engineer**(콘텐츠 도메인 검수 —
  시나리오/체크리스트 항목이 도메인적으로 타당한지 확인, 산식은 아니므로 필수 게이트는
  아니나 권장), **frontend-engineer**(화면8), **qa-reviewer**.

### 슬라이스 S — 감사 로그 뷰어 (P2, ENTERPRISE)
- 내용: `GET /audit-logs`(5절) + FE 화면14.
- 수용: org 스코프 필터링(누수 테스트), entity/action/기간 필터 동작, ENTERPRISE 게이팅.
- 증빙(11장): "추천/부분제어 로직" 및 전 항목의 "책임 추적" 신뢰성 기반.
- 위임: **backend-engineer**, **frontend-engineer**, **qa-reviewer**.

### 슬라이스 T — 멀티사이트 관리 (P2, ENTERPRISE)
- 내용: `GET /sites`(4.2절, START/PRO에도 유용하므로 게이팅 없음), `GET /sites/kpi-benchmark`
  (ENTERPRISE), FE 화면12.
- 수용: 벤치마크 응답의 site별 metrics가 `GET /sites/{id}/kpi`와 개별 수기 검산 일치,
  ENTERPRISE 게이팅, 누수 테스트(타 org site 미노출).
- 증빙(11장): "통합 관리 대시보드" 확장(멀티사이트) — ENTERPRISE 차별점.
- 위임: **backend-engineer**, **frontend-engineer**, **qa-reviewer**.

### 슬라이스 U — 승인형 제어 콘솔 (P2, ENTERPRISE, 신규 산식 없음이지만 상태기계 복잡도 높음)
- 내용: `control_actions` 마이그레이션(CHECK 제약 포함, 3.1절) + 4개 상태전이 API(3.2절) +
  FE 이중 확인 다이얼로그(`ConfirmLockDialog` 패턴 재사용) + 승인 대기열 화면11.
- 수용: `pending→approved→applied` 정상 흐름, `approved` 거치지 않은 `apply` 시도 **반드시
  409**(핵심 수용 기준 — 승인 게이트 우회 불가 물리적 검증, DB CHECK 제약까지 테스트),
  거부(`reject`) 흐름, ENTERPRISE 게이팅, audit_logs 3단계(propose/approve/apply) 모두 기록,
  누수 테스트.
- 증빙(11장): "추천/부분제어 로직"(적용 로그, `control_actions`) — 11장 매핑 핵심 항목.
- 위임: **backend-engineer**(스키마·상태기계·API), **frontend-engineer**(이중 확인 UX),
  **qa-reviewer**(★게이트 우회 불가 집중 검증 — 이 슬라이스의 최우선 QA 항목).

### 9.1 우선순위 요약 (실행 순서)

```
P0 (선행 보수 + 상용화 필수 + 헤드라인):
  P0-0(갭 보수: CORS/ready) → 즉시 착수, 나머지 전부의 전제
  N(프로덕션 준비성)                    → P0-0과 병행
  O(로그인)                             → 스택 확정(ADR 0005), 즉시 병행 착수 가능
  M(MRV 리포트)                         → data-kpi-engineer 1.3절 결정 확정이 게이트,
                                           확정 즉시 최우선 병목 해소하며 착수(★헤드라인)
P1 (START·PRO 마무리):
  Q(온보딩) ∥ R(SOP)                    → 서로 독립, 병행 가능
P2 (ENTERPRISE, START·PRO 완성 후):
  S(감사로그뷰어) → T(멀티사이트) → U(제어콘솔)
  (U는 상태기계 복잡도가 가장 높아 QA 리소스를 가장 크게 배정)
```
- **M(MRV)의 병목은 data-kpi-engineer의 1.3절 2개 결정**이다 — ADR 0003 선례처럼 이 문서
  발행 직후 가장 먼저 합의를 받아야 한다(9.2절 위임 요약 1번).
- **O(로그인)는 더 이상 병목이 아니다** — 스택 선택(Supabase Auth, ADR 0005)이 사용자에 의해
  확정되었고 구현 계약(`phase-3-auth.md`)도 못박혔다. 단 `AUTH_MODE=supabase`의 **실 운영
  배포**는 사용자가 Supabase 프로젝트·키 발급을 완료해야 가능(ADR 0005 "실행 전제") —
  개발/테스트는 그 전제와 무관하게 즉시 진행한다.
- ENTERPRISE 3종(S/T/U)은 병행 가능하나 U가 상태기계·게이트 검증 부담이 가장 크므로 QA
  일정에서 가장 여유를 둔다.

### 9.2 위임 요약 (오케스트레이터용)

1. **최우선 합의**: `data-kpi-engineer` — 1.3절 Scope2 정규화 생산량/배출계수 적용 규칙
   확정(M의 게이트).
2. **P0 병행 착수**: `backend-engineer` P0-0(갭 보수, 즉시) → N(프로덕션 준비성) → O(로그인,
   `phase-3-auth.md` 계약대로 즉시 착수) → M의 스키마/API/PDF 파이프라인(1.3절 확정 후).
   `frontend-engineer`는 P0-0 완료 후 화면10·O(로그인 페이지) 착수.
3. O(로그인)는 독립 슬라이스이므로 M/N/P0-0 진행과 무관하게 병행 가능(실 운영 배포만 사용자의
   Supabase 키 발급을 기다린다 — 코드 구현/테스트는 대기 불필요).
4. **P1**: `backend-engineer`+`frontend-engineer`가 Q/R을 병행. `data-kpi-engineer`는
   R의 콘텐츠 도메인 검수만 지원(비필수 게이트).
5. **P2**: START·PRO 전 슬라이스green 확인 후 S→T→U 순서로 ENTERPRISE 착수. U는
   qa-reviewer 검증 비중을 가장 크게 배정(승인 게이트 우회 불가 검증).
6. 각 슬라이스 통합 후 `qa-reviewer` 게이트(수용 기준 + 누수 테스트 + 플랜 게이팅 + 상태기계
   무결성) 통과 시에만 머지(Rule 10).
7. 계약(1~8절 시그니처·스키마·API)은 architect가 못 박았다. 구현자는 임의 변경 금지 —
   변경 필요 시 architect·(산식이면) data-kpi-engineer에 되돌려 합의한다.

---

## 10. 결정 기록(ADR) 현황

- **ADR 0001~0003**(Accepted): 변경 없음.
- **ADR 0004**(Accepted): PDF 생성 엔진 = WeasyPrint(1.8절 요약, 전문은 ADR 파일).
- **ADR 0005**(신규, **Proposed**): 로그인 스택 = **Supabase Auth**(8.0절 갭에 대한 최종
  확정 — 사용자가 architect의 자체 JWT 권고 대신 Supabase Auth를 선택, `phase-3-auth.md`가
  구현 계약). Proposed인 이유는 스택 자체는 확정됐으나 실제 Supabase 프로젝트 생성·키 발급이
  사용자/컬리버 운영진 몫으로 아직 완료되지 않았기 때문(ADR 0005 "실행 전제" 절). 키 발급 후
  Accepted로 전이한다. 코드 구현은 Proposed 상태에서도 즉시 착수 가능(`AUTH_MODE=test-local`
  기본값이 개발/테스트를 막지 않음).
- 그 외 스택 변경 없음(WeasyPrint 도입은 "확정 스택 내 세부 라이브러리 선택"이 아니라 MASTER
  5장이 이미 후보로 열어 둔 두 옵션 중 하나를 확정한 것이므로 ADR 0004로 충분 — 새로운 ADR
  체계 도입 아님. ADR 0005도 동일하게 MASTER 5장이 이미 후보로 열어 둔 "Supabase Auth 또는
  자체 JWT" 중 하나를 확정한 것).
