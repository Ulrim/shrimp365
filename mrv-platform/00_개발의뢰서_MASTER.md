# 개발의뢰서 (MASTER) — 컬리버 통합관리 + 탄소 MRV 플랫폼

> **이 문서의 용도**: Claude Code에 그대로 입력하는 최상위 사양서(PRD)입니다.
> Claude Code는 이 문서를 단일 진실 공급원(Single Source of Truth)으로 취급하고,
> 모든 작업은 여기에 정의된 도메인 모델 · KPI 산식 · 산출물 기준을 따릅니다.
> 세부 작업은 `.claude/agents/`에 정의된 전담 팀(서브에이전트)에게 위임합니다.

---

## 0. 한 문장 정의

**실내 흰다리새우(RAS) 양식장의 전력·산소(DO)·수질·급이·폐사 데이터를 한 공정 흐름으로 통합하여, 공정 KPI(EI·OEI·FCR·폐사율)를 자동 산출·개선하고, 전력 절감을 Scope2 탄소저감 성과로 환산해 "달성/미달성"이 명확한 MRV 리포트로 자동 증빙하는 B2B 구독형 웹 애플리케이션.**

단순 모니터링 앱이 아니다. **(1) 기준선 고정 → (2) 추천/부분제어 적용 → (3) 적용 로그/버전 이력 → (4) 전·후 KPI 비교 → (5) MRV 리포트 제출**의 5단계가 한 시스템 안에서 끊김 없이 이어지는 것이 이 제품의 본질이자 차별성이다.

---

## 1. 사업 배경 (개발자가 반드시 이해할 맥락)

- 발주: 주식회사 컬리버 / 정부 청년그린창업 스프링캠프 과제
- 과제명: **흰다리새우 양식 공정의 탄소배출 저감을 위한 통합 관리 기술 개발**
- 과제분야: 탄소저감(주) / 물(보조)
- 협약기간: **4월~10월(7개월)**, 3-Phase 구조
- 이 플랫폼은 과제의 **핵심 산출물**이다. 화면·로직·리포트가 곧 평가 증빙물이 된다.
- 따라서 "멋진 대시보드"가 아니라 **"심사위원이 달성/미달성을 판정할 수 있는 증빙 시스템"** 으로 설계할 것.

### 1.1 왜 이 KPI들인가 (도메인 근거)
- 실내(RAS) 양식은 폭기·순환·여과 설비 상시 가동 → 전력 의존도 높음 → 비효율이 곧 전기요금 + Scope2 배출.
  - 폭기 전력: 새우 톤당 약 3,700~6,800 kWh (평균 ~5,000 kWh/t).
- 사료비가 생산원가의 40~65% → FCR 악화 시 손실 누적 (평균 FCR 1.4~1.6).
- 폐사는 손실의 직접 원인 → 조기경보 필요.
- 글로벌 ESG/ASC 흐름은 에너지·GHG의 **정기적 측정·보고(MRV)** 를 요구 → "측정"을 넘어 "증빙"이 시장 니즈.

---

## 2. 제품 범위 — 3-Tier 패키지

플랫폼은 단일 코드베이스로 빌드하되, **요금제(Plan)별 기능 게이팅(feature flag)** 으로 3개 티어를 제공한다.

| 티어 | 한 줄 정의 | 핵심 기능 | 월 요금(참고) | 약정 |
|---|---|---|---|---|
| **START** (모니터링/보고) | 데이터부터 모은다 | 통합 대시보드 / KPI 자동집계 / 임계치 알림 / 주·월간 리포트 | 390,000원 | 24개월 |
| **PRO** (운영개선, 주력) | 성과를 만든다 | START + 추천 로직(급이·산소·순환) / SOP / KPI 전·후 비교 리포트 | 790,000원 | 24개월 |
| **ENTERPRISE** (연동/반자동 제어) | 멀티사이트로 확장 | PRO + 승인형 반자동 제어(권장값→적용→로그) / 맞춤 KPI·탄소 리포트 / 멀티사이트 관리 | 1,980,000원 | 36개월 |

> **개발 우선순위**: START(MVP) → PRO → ENTERPRISE 순. 협약기간 내 최소 START·PRO 완성 + 유료 파일럿 2곳 전환이 목표.

---

## 3. 도메인 모델 (★ 가장 중요 — 임의 변경 금지)

### 3.1 핵심 개념(엔티티)
- **Organization(법인)** → **Site(양식장/사이트)** → **Tank(수조)** → **Batch(입식 사이클)**
- **Sensor / Meter(센서·계측기)**: 전력계, 수온, DO, pH, ORP, EC/염도 등
- **Reading(계측값)**: 시계열 측정 데이터 (TimescaleDB hypertable)
- **FeedLog(급이 기록)**, **MortalityLog(폐사 기록)**, **HarvestLog(생산/출하 기록)**
- **Baseline(기준선)**: 비교의 기준이 되는 고정된 KPI 스냅샷 (★ 한번 확정하면 잠금)
- **Recipe / Recommendation(운전 레시피·추천값)** + **RecipeVersion(버전 이력)**
- **ControlAction(제어 액션)**: 추천값에 대한 승인→적용→결과 로그 (ENTERPRISE)
- **KpiSnapshot(KPI 산출 결과)**: 기간 단위로 산출된 EI/OEI/FCR/폐사율
- **MrvReport(MRV 리포트)**: 전/후 비교 + Scope2 환산 + 산식·가정 명시
- **Alert(알림)**, **AuditLog(전 행위 감사 로그)**

### 3.2 KPI 산식 정의 (이 산식이 제품의 영업비밀이자 IP의 핵심)

> 모든 KPI는 `kpi_engine` 모듈에서 **순수 함수**로 구현하고 **단위 테스트로 고정**한다.
> 산식은 설정값(`kpi_config`)으로 파라미터화하며, 실증 과정에서 보정 가능하되 버전을 남긴다.

**① EI (Energy Intensity, 전력집약도)** — 낮을수록 우수
```
EI = 기간 내 총 전력사용량(kWh) / 기간 내 생산량(kg)
   = Σ(power_kWh) / Δbiomass_kg
단위: kWh/kg
세부: 총전력 EI, 폭기전력 EI(블로워 서브미터 분리) 둘 다 산출
```

**② OEI (Oxygen Efficiency Index, 산소운전 효율지수)** — 높을수록 우수
```
정의: "폭기에 투입한 전력 대비, DO를 목표대역에 얼마나 안정적으로 유지했는가"

OEI = (DO 목표대역 유지율) / (생산 kg당 폭기 전력)
    = (t_in_band / t_total) / (aeration_kWh / biomass_kg)

  - t_in_band : DO가 [DO_min, DO_max] 목표대역 안에 머문 시간
  - 단위 정규화 후 0~100 지수로 스케일링
★ 본 산식은 제안값. 실증 1단계에서 현장 데이터로 계수 보정 → RecipeVersion으로 기록.
```

**③ FCR (Feed Conversion Ratio, 사료요구율)** — 낮을수록 우수
```
FCR = 기간 내 총 급이량(kg) / 기간 내 증체량(kg)
    = Σ(feed_kg) / Δbiomass_kg
```

**④ 폐사율 (Mortality Rate)** — 낮을수록 우수
```
폐사율(%) = (기간 내 폐사 개체수 / 기초 입식 개체수) × 100
누적 폐사율 / 일일 폐사율 / 7일 이동평균 모두 산출
```

### 3.3 Scope2 탄소 MRV 산정 (★ 과제의 주 성과 — 정밀 검증 대상)
```
Scope2 배출량(tCO2e) = 전력사용량(MWh) × 전력 배출계수(tCO2e/MWh)

  - 전력 배출계수는 하드코딩 금지. `emission_factor` 설정 테이블에서 관리.
  - 출처: 환경부/온실가스종합정보센터(GIR) 공표 국가 전력 배출계수 최신값.
    → 값과 출처·연도·버전을 DB에 함께 저장하고 리포트에 명시(검증 가능성 확보).

탄소저감 성과(Before/After):
  감축량(tCO2e) = (EI_baseline − EI_after) × 생산량(kg) × 배출계수
  → 동일 생산량 기준으로 정규화하여 "절감"을 분리(생산량 증가 효과와 혼동 방지)

MRV 리포트 필수 구성:
  ① Before/After EI·전력량·생산량 비교표
  ② 기간·측정경계(boundary)·가정(assumption) 명시
  ③ 산식 전문 출력 (재현 가능)
  ④ 전/후 그래프
  ⑤ 적용 로직·버전·적용 로그 참조(증빙 추적성)
```

> **검증 원칙**: MRV 수치는 항상 원천 Reading까지 역추적(drill-down) 가능해야 한다. 리포트의 모든 숫자는 클릭 시 근거 데이터로 이동.

---

## 4. 화면(페이지) 인벤토리

### START
1. **로그인 / 멀티테넌시** (Organization 격리, 역할: Owner/Operator/Viewer)
2. **사이트 선택 & 개요(Overview)**: 현재 KPI 카드(EI/OEI/FCR/폐사율) + 신호등 상태
3. **통합 대시보드**: 전력·DO·수온·pH 실시간 시계열, 수조별 비교, 기간 필터
4. **급이/폐사 기록 입력**: 수동 입력 폼 + 표준 기록지(CSV 업로드) + 입력 검증
5. **알림 센터**: 임계치 초과·DO 저하·폐사 급증 이벤트 로그/구독 설정
6. **리포트(주간/월간)**: 자동 생성, PDF 다운로드, 이메일 발송

### PRO (START +)
7. **추천(운전 레시피) 보드**: 급이·산소·순환 추천값 + 근거 + "추천만/적용 표시"
8. **SOP 라이브러리**: 정상/이상(수질악화·DO저하·폐사증가) 대응 시나리오, 체크리스트
9. **전·후 비교(A/B) 분석**: 기준선 vs 적용 후 KPI, 비교실험(A/B) 구성·결과
10. **MRV 리포트(전·후)**: Scope2 환산, 산식·가정 명시, 검증 drill-down

### ENTERPRISE (PRO +)
11. **승인형 제어 콘솔**: 권장값 → 운영자 승인 → 설비 적용 → 결과 로그 (이중 확인)
12. **멀티사이트 관리**: 사이트 횡단 KPI 벤치마크, 사이트별 권한
13. **맞춤 리포트 빌더**: KPI/탄소 리포트 템플릿 커스터마이즈
14. **감사 로그 뷰어**: 모든 제어/설정 변경 이력 (책임 추적)

### 공통/관리
15. **설정**: 기준선 확정/잠금, KPI 산식 파라미터, 배출계수 관리, 센서/계측기 등록
16. **온보딩 마법사**: 설치키트→센서 매핑→기준선 수집→유료 전환 흐름

---

## 5. 기술 스택 (확정안)

> 컬리버의 기존 자산/역량과 정렬: React 18·TS·Zustand·TanStack Query, FastAPI, MQTT, Supabase 경험.

### 프론트엔드
- **React 18 + TypeScript + Vite**
- **상태**: Zustand(클라이언트 UI 상태) + **TanStack Query**(서버 상태/캐싱)
- **UI**: Tailwind CSS + shadcn/ui (디자인 토큰은 `ui-ux-designer` 에이전트가 관리)
- **차트**: ECharts(고밀도 시계열·대시보드) — 단순 막대/도넛은 Recharts 허용
- **PDF 미리보기**: 서버 생성 PDF를 뷰어로 렌더
- **i18n**: 기본 한국어, 영어 확장 가능 구조(글로벌 SAM 대비)

### 백엔드
- **FastAPI (Python 3.12)** — KPI 엔진/MRV 산정/추천 로직과 동일 언어로 통일
- **DB**: **PostgreSQL + TimescaleDB**(시계열 hypertable) — Reading 대용량 대응
- **인증/RLS**: Supabase Auth 또는 자체 JWT + Postgres Row-Level Security(테넌트 격리)
- **ORM**: SQLAlchemy 2.0 + Alembic(마이그레이션)
- **데이터 수집**: **MQTT 브로커(EMQX/Mosquitto)** → ingestion 워커 → Timescale
  - 게이트웨이(현장) → MQTT/HTTP → ingestion → 검증·정합(QA) → 저장
- **작업 큐**: Celery 또는 APScheduler(KPI 배치 산출·리포트 생성·알림)
- **리포트 생성**: WeasyPrint 또는 Playwright(HTML→PDF), 한글 폰트 임베드

### 인프라/운영
- **개발**: Docker Compose(postgres+timescale, mqtt, api, web, worker)
- **테스트**: pytest(백엔드), Vitest + Testing Library(프론트), Playwright(E2E)
- **CI**: GitHub Actions(lint+typecheck+test+build)
- **관측성**: 구조화 로깅 + 헬스체크. (확장 시 Grafana 연동 — 컬리버 기존 자산)

> 스택 변경이 필요하면 `architect` 에이전트가 ADR(아키텍처 결정 기록)로 근거를 남긴 뒤에만 변경.

---

## 6. 데이터 모델 스케치 (핵심 테이블)

```
organizations(id, name, plan[START|PRO|ENT], created_at)
users(id, org_id, email, role[owner|operator|viewer])
sites(id, org_id, name, region, ras_type)
tanks(id, site_id, name, volume_m3, target_do_min, target_do_max)
batches(id, tank_id, species, stocked_count, stocked_at, closed_at)

meters(id, site_id, tank_id, type[power|do|temp|ph|orp|ec], unit, sub_meter_of)
readings(time, meter_id, value, quality_flag)   -- TimescaleDB hypertable
feed_logs(id, batch_id, ts, feed_kg, source[manual|csv|device])
mortality_logs(id, batch_id, ts, dead_count, cause_note)
harvest_logs(id, batch_id, ts, biomass_kg, count)

baselines(id, site_id, period_start, period_end, ei, oei, fcr, mortality,
          locked[bool], locked_by, locked_at)     -- ★ 잠금 후 불변
kpi_snapshots(id, site_id, tank_id, period_start, period_end,
              ei_total, ei_aeration, oei, fcr, mortality_rate, config_version)
kpi_config(id, version, params_json, effective_from)

recipes(id, site_id, type[feed|oxygen|circulation], current_version)
recipe_versions(id, recipe_id, version, params_json, rationale, created_by, created_at)
control_actions(id, tank_id, recipe_version_id, recommended_json,
                approved_by, approved_at, applied_at, result_json, status)

emission_factors(id, factor_tco2e_per_mwh, source, year, version, effective_from)
mrv_reports(id, site_id, period_start, period_end, before_json, after_json,
            reduction_tco2e, emission_factor_id, formula_text, pdf_path, generated_at)

alerts(id, site_id, type, severity, payload_json, status, created_at)
audit_logs(id, org_id, actor_id, entity, entity_id, action, diff_json, ts)
```

---

## 7. API 설계 원칙
- REST + OpenAPI 자동 문서화(`/docs`).
- 모든 응답은 `org_id` 스코프로 격리(RLS + 서비스 레이어 이중 방어).
- KPI/MRV 조회는 **항상 산출 파라미터·기간·근거 참조 ID**를 함께 반환(검증 추적성).
- 대표 엔드포인트(예시):
  - `POST /ingest/readings` (게이트웨이 전용, API Key)
  - `GET /sites/{id}/kpi?from&to&granularity`
  - `POST /sites/{id}/baseline/lock`
  - `GET /sites/{id}/recipes` / `POST /recipes/{id}/versions`
  - `POST /control-actions` / `POST /control-actions/{id}/approve` / `POST /{id}/apply`
  - `POST /sites/{id}/mrv-reports/generate` / `GET /mrv-reports/{id}/pdf`

---

## 8. 비기능 요구사항 (NFR)
- **멀티테넌시 격리**: 테넌트 간 데이터 누수 0건 — 테스트로 강제.
- **데이터 주권**: "고객 소유 데이터" 원칙. 익명 벤치마크는 옵트인. 저장 시 암호화, 최소수집.
- **이식성**: 현장 인터넷 단절 대비 게이트웨이 버퍼링·재전송(at-least-once) 가정.
- **재현성**: KPI/MRV는 동일 입력 → 동일 출력(결정론적). 난수·시각 의존 금지.
- **감사성**: 모든 제어/설정 변경은 `audit_logs`에 diff 기록.
- **성능**: readings 1년치(수조 수십 개 × 분 단위)에서 대시보드 쿼리 < 2초(continuous aggregate 활용).
- **보안**: 인증/인가, API Key 회전, OWASP Top 10 점검, 비밀값은 .env(커밋 금지).

---

## 9. 규제/인허가 훅 (코드에 반영할 것)
- 배출수/폐수: 사이트 설정에 방류 경로·수질 모니터링 필드 + 리포트 항목 자리 마련.
- IoT/무선기기(KCC), 전기안전(KC): 계측기 등록 시 인증정보·라벨 필드.
- 질병·방역: 폐사·수질 이상 → 조기경보 + 원인추정 + 조치이력(증빙) 흐름.
- 위 항목은 MVP에서 "데이터 필드 + 자리"만, 본격 기능은 PRO/ENT에서 확장.

---

## 10. 개발 단계 (협약 일정 매핑)

| Phase | 기간 | 목표 | 결과물 |
|---|---|---|---|
| **Phase 1 (초기, 4~5월)** | Baseline 확보 | 데이터 파이프라인·기준선 고정 | DB/스키마, ingestion, 센서 매핑, **기준선 잠금**, KPI 엔진 v1 + 단위테스트 |
| **Phase 2 (중기, 6~8월)** | 기술 구현·1차 실증 | 대시보드·추천·비교실험 | START 대시보드 MVP, 알림, 추천 보드(PRO), A/B 비교, 1차 실증 튜닝 |
| **Phase 3 (말기, 9~10월)** | 검증 완성·사업화 | 재현성·MRV·패키징 | MRV 리포트 자동생성, SOP, 멀티사이트(ENT), 감사 로그, 유료 전환 온보딩 |

### 스프린트 0 (개발 착수 즉시)
1. 모노레포 + Docker Compose 부팅 (web/api/db/mqtt/worker)
2. 데이터 모델 마이그레이션 + 시드 데이터(가상 양식장 1곳)
3. `kpi_engine` 순수 함수 4종 + 단위테스트(★ 최우선)
4. 인증 + 멀티테넌시 RLS 골격
5. 대시보드 셸 + 더미 시계열 차트 1개 (수직 슬라이스로 끝까지 관통)

---

## 11. 산출물 ↔ 평가 증빙 매핑 (반드시 충족)

| 정성 목표 | 시스템이 만들어야 할 증빙 |
|---|---|
| 통합 관리 대시보드 구축 | 대시보드 화면 캡처/URL + 데이터 흐름도 |
| 추천/부분제어 로직 | 룰셋/버전이력 + 적용 로그(`recipe_versions`,`control_actions`) |
| 표준 운영 체계(SOP) | SOP PDF + 점검 체크리스트(앱 내 생성) |
| 탄소저감 성과 리포트(MRV) | MRV 리포트(월간/최종) + 산식·가정 명시 + 전·후 그래프 |
| 도입 패키지(START/PRO/ENT) | 제안서/가격표 + 기능 게이팅 동작 |
| 현장 재현성 | 설치·운영 매뉴얼 + 온보딩 마법사 |

---

## 12. 작업 위임 규칙 (Claude Code 오케스트레이터에게)
- 너(메인 세션)는 **오케스트레이터**다. 직접 코딩보다 **계획 → 위임 → 통합 → 검증**에 집중한다.
- 큰 작업은 `architect`에게 설계를 받고, 구현은 `frontend-engineer`/`backend-engineer`/`data-kpi-engineer`에게 나눠 위임한다.
- **모든 머지 전 `qa-reviewer`가 수용 기준을 검증**한다.
- 도메인 산식(EI/OEI/FCR/MRV)은 **반드시 `data-kpi-engineer`만** 수정한다.
- 막히면 추측하지 말고 이 문서를 재확인하고, 그래도 불명확하면 정석(사용자)에게 질문한다.
- 한국어 도메인 용어를 코드 식별자로 쓰지 말 것(영문 + 주석에 한글 병기).
