-- ============================================================================
-- 컬리버 탄소 MRV 플랫폼 — Supabase 스키마
--
-- 원본: mrv-platform/infra/migrations/versions/0001..0013 (Alembic, PostgreSQL+TimescaleDB)
-- 이 파일은 그 13개 마이그레이션을 shrimp365 의 Supabase Postgres 로 이식한 것이다.
--
-- 이식하며 달라진 점(그 외는 원본과 동일):
--   1) 테이블 이름에 `mrv_` 접두사를 붙였다. shrimp365 가 이미 public 스키마에서
--      alerts/users/sites 같은 이름을 쓰고 있어 그대로 두면 운영 스키마를 오염시킨다
--      (ADR 0006 1절이 "역방향은 스키마 오염이라 기각"이라고 지적한 바로 그 문제 —
--      접두사로 그 지적을 해소한다).
--   2) readings 는 TimescaleDB 하이퍼테이블이 아니다. Supabase 관리형 Postgres 는
--      TimescaleDB 를 제공하지 않는다. 대신 (meter_id, time) 복합 인덱스와 time BRIN
--      인덱스로 시계열 조회를 받는다 — 파일럿 규모(수조 수십 개 × 분 단위)에서는
--      연속집계 없이도 대시보드 질의가 성립한다. 연속집계가 필요해지면 그때
--      머티리얼라이즈드 뷰로 올린다.
--   3) RLS 정책의 테넌트 앵커가 세션 GUC(`app.current_org_id`)에서 `auth.uid()` 로
--      바뀌었다. GUC 방식은 요청마다 SET LOCAL 을 거는 직접 연결을 전제하는데
--      (ADR 0006 이 "PgBouncer 트랜잭션 풀링·PostgREST 와 궁합이 나쁘다"고 적은 그
--      방식), Supabase 에서는 JWT 의 auth.uid() 가 그 자리를 대신한다. 격리의 강도는
--      같거나 더 세다 — org 를 사칭할 수 있는 세션 변수가 아예 없기 때문이다.
--
-- 실행: Supabase SQL Editor 에 이 파일 전체를 붙여 넣고 실행한다(service_role 필요).
-- 멱등: 전부 IF NOT EXISTS / CREATE OR REPLACE 라 여러 번 실행해도 안전하다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 조직 · 사용자 (멀티테넌시의 뿌리)
-- ---------------------------------------------------------------------------

-- organizations(법인). plan 이 3-Tier 기능 게이팅의 근거다.
create table if not exists public.mrv_organizations (
  id          text primary key,
  name        text not null,
  plan        text not null default 'START',
  created_at  timestamptz not null default now(),
  constraint ck_mrv_organizations_plan check (plan in ('START', 'PRO', 'ENTERPRISE'))
);

-- users(조직 소속). 초대 기반이며, 이 행 자체가 초대 레코드를 겸한다
-- (별도 invitations 테이블 없음 — ADR 0005 4절).
--   · supabase_user_id NULL = "초대는 됐으나 아직 첫 로그인 전".
--   · 비밀번호 컬럼은 두지 않는다(인증은 shrimp365 와 공유하는 auth.users 가 전담).
create table if not exists public.mrv_users (
  id                text primary key,
  org_id            text not null references public.mrv_organizations(id) on delete cascade,
  email             text not null,
  role              text not null default 'viewer',
  supabase_user_id  uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint ck_mrv_users_role check (role in ('owner', 'operator', 'viewer')),
  -- 같은 사람이 여러 org 에 속할 수 있으므로 이메일은 org 내에서만 유니크하다.
  constraint ux_mrv_users_org_email unique (org_id, email)
);
create index if not exists ix_mrv_users_org_id on public.mrv_users (org_id);
-- 한 Supabase 계정이 두 org 에 연결되는 것을 물리적으로 막는다(다중 초대는 409 로 안내).
create unique index if not exists ux_mrv_users_supabase_user_id
  on public.mrv_users (supabase_user_id) where supabase_user_id is not null;

-- ---------------------------------------------------------------------------
-- 2. 사이트 · 수조 · 배치 · 계측기
-- ---------------------------------------------------------------------------

create table if not exists public.mrv_sites (
  id        text primary key,
  org_id    text not null references public.mrv_organizations(id) on delete cascade,
  name      text not null,
  region    text,
  ras_type  text,
  -- 알림 구독 on/off 스위치(채널 개념 없는 최소안).
  alert_enabled_types jsonb not null
    default '{"do_low": true, "mortality_spike": true, "kpi_red": true}'::jsonb
);
create index if not exists ix_mrv_sites_org_id on public.mrv_sites (org_id);

-- tanks. target_do_min/max 가 OEI 산출의 DO 목표대역(DoBand) 근거다.
create table if not exists public.mrv_tanks (
  id             text primary key,
  site_id        text not null references public.mrv_sites(id) on delete cascade,
  org_id         text not null references public.mrv_organizations(id) on delete cascade,
  name           text not null,
  volume_m3      double precision,
  target_do_min  double precision,
  target_do_max  double precision
);
create index if not exists ix_mrv_tanks_site_id on public.mrv_tanks (site_id);
create index if not exists ix_mrv_tanks_org_id on public.mrv_tanks (org_id);

-- batches(입식 사이클). stocked_count 가 폐사율의 분모다.
create table if not exists public.mrv_batches (
  id             text primary key,
  tank_id        text not null references public.mrv_tanks(id) on delete cascade,
  org_id         text not null references public.mrv_organizations(id) on delete cascade,
  species        text not null,
  stocked_count  integer not null,
  stocked_at     timestamptz not null,
  closed_at      timestamptz
);
create index if not exists ix_mrv_batches_tank_id on public.mrv_batches (tank_id);
create index if not exists ix_mrv_batches_org_id on public.mrv_batches (org_id);

-- meters. is_aeration 이 폭기전력 EI(ei_aeration)의 분자를 가른다.
-- unit 은 ADR 0001 규약(예: 'kWh_interval') — 계측값이 이미 구간 증분으로 정규화됐다는 표시.
create table if not exists public.mrv_meters (
  id                  text primary key,
  site_id             text not null references public.mrv_sites(id) on delete cascade,
  org_id              text not null references public.mrv_organizations(id) on delete cascade,
  type                text not null,
  unit                text not null default 'kWh_interval',
  sub_meter_of        text references public.mrv_meters(id) on delete set null,
  is_aeration         boolean not null default false,
  tank_id             text references public.mrv_tanks(id) on delete set null,
  label               text,
  -- MASTER 9장 규제훅(IoT/무선기기 KCC, 전기안전 KC). 이번 Phase 는 저장만 하고
  -- 형식 검증은 하지 않는다 — "자리만" 마련하는 필드다.
  certification_info  jsonb
);
create index if not exists ix_mrv_meters_site_id on public.mrv_meters (site_id);
create index if not exists ix_mrv_meters_org_id on public.mrv_meters (org_id);
create index if not exists ix_mrv_meters_tank_id on public.mrv_meters (tank_id);

-- ---------------------------------------------------------------------------
-- 3. 계측값(시계열) · 수기 기록
-- ---------------------------------------------------------------------------

-- readings. value = ADR 0001 로 정규화된 구간 kWh(또는 DO mg/L 등 계측기 단위).
-- KPI 엔진은 이 값을 정렬·차분·보간 없이 단순 합산만 한다.
--
-- 원본은 TimescaleDB 하이퍼테이블이었다. Supabase 에는 TimescaleDB 가 없으므로 일반
-- 테이블로 두되, 하이퍼테이블이 주던 두 가지 이점을 인덱스로 대신한다:
--   · (meter_id, time) 복합 인덱스 — "이 계측기의 이 기간" 이 모든 KPI 질의의 형태다.
--   · time BRIN — 시간순으로 append 되는 테이블이라 BRIN 이 아주 작고 잘 듣는다.
create table if not exists public.mrv_readings (
  "time"        timestamptz not null,
  meter_id      text not null references public.mrv_meters(id) on delete cascade,
  org_id        text not null references public.mrv_organizations(id) on delete cascade,
  value         double precision not null,
  quality_flag  text not null default 'ok',
  primary key ("time", meter_id)
);
create index if not exists ix_mrv_readings_org_id on public.mrv_readings (org_id);
create index if not exists ix_mrv_readings_meter_time on public.mrv_readings (meter_id, "time");
create index if not exists ix_mrv_readings_time_brin on public.mrv_readings using brin ("time");

-- feed_logs. quality_flag 를 FCR 엔진이 included_quality_flags 로 필터한다.
create table if not exists public.mrv_feed_logs (
  id            text primary key,
  batch_id      text not null references public.mrv_batches(id) on delete cascade,
  org_id        text not null references public.mrv_organizations(id) on delete cascade,
  ts            timestamptz not null,
  feed_kg       double precision not null,
  source        text not null default 'manual',
  quality_flag  text not null default 'ok',
  constraint ck_mrv_feed_logs_source check (source in ('manual', 'csv', 'device'))
);
create index if not exists ix_mrv_feed_logs_batch_id on public.mrv_feed_logs (batch_id);
create index if not exists ix_mrv_feed_logs_org_id on public.mrv_feed_logs (org_id);
create index if not exists ix_mrv_feed_logs_ts on public.mrv_feed_logs (org_id, ts);

create table if not exists public.mrv_mortality_logs (
  id          text primary key,
  batch_id    text not null references public.mrv_batches(id) on delete cascade,
  org_id      text not null references public.mrv_organizations(id) on delete cascade,
  ts          timestamptz not null,
  dead_count  integer not null,
  cause_note  text
);
create index if not exists ix_mrv_mortality_logs_batch_id on public.mrv_mortality_logs (batch_id);
create index if not exists ix_mrv_mortality_logs_org_id on public.mrv_mortality_logs (org_id);
create index if not exists ix_mrv_mortality_logs_ts on public.mrv_mortality_logs (org_id, ts);

-- harvest_logs. EI/FCR 분모 Δbiomass 의 개시/마감 근거(BiomassPoint.source_ref).
create table if not exists public.mrv_harvest_logs (
  id          text primary key,
  batch_id    text references public.mrv_batches(id) on delete set null,
  site_id     text not null references public.mrv_sites(id) on delete cascade,
  org_id      text not null references public.mrv_organizations(id) on delete cascade,
  ts          timestamptz not null,
  biomass_kg  double precision not null,
  count       integer
);
create index if not exists ix_mrv_harvest_logs_site_id on public.mrv_harvest_logs (site_id);
create index if not exists ix_mrv_harvest_logs_org_id on public.mrv_harvest_logs (org_id);
create index if not exists ix_mrv_harvest_logs_ts on public.mrv_harvest_logs (site_id, ts);

-- ---------------------------------------------------------------------------
-- 4. KPI 설정 · 산출 결과 · 기준선
-- ---------------------------------------------------------------------------

-- kpi_config 는 org 전역 설정이라 org_id 가 없다(RLS 비대상, 읽기 전용 공개).
-- 산식 파라미터가 바뀌면 이 테이블에 새 version 행을 추가하고, 어떤 기간에 어떤
-- version 이 적용됐는지는 kpi_snapshots.config_version 으로 추적한다.
create table if not exists public.mrv_kpi_config (
  id              text primary key,
  version         text not null unique,
  params_json     jsonb not null default '{}'::jsonb,
  effective_from  timestamptz not null
);

-- kpi_snapshots — append-only. 스칼라 지표 + 근거 JSON(drill-down).
-- 지표 컬럼은 NULL 허용: '산출 불가'(엔진의 null)를 0 으로 치환하지 않고 그대로 영속한다.
create table if not exists public.mrv_kpi_snapshots (
  id               text primary key,
  site_id          text not null references public.mrv_sites(id) on delete cascade,
  tank_id          text references public.mrv_tanks(id) on delete set null,
  org_id           text not null references public.mrv_organizations(id) on delete cascade,
  period_start     timestamptz not null,
  period_end       timestamptz not null,
  ei_total         double precision,
  ei_aeration      double precision,
  oei              double precision,
  fcr              double precision,
  mortality_rate   double precision,
  config_version   text not null,
  inputs_json      jsonb not null default '{}'::jsonb,
  provenance_json  jsonb not null default '{}'::jsonb,
  generated_at     timestamptz not null default now()
);
create index if not exists ix_mrv_kpi_snapshots_site_id on public.mrv_kpi_snapshots (site_id);
create index if not exists ix_mrv_kpi_snapshots_org_id on public.mrv_kpi_snapshots (org_id);

-- baselines — 잠금 후 불변(ADR 0002). MRV 리포트의 'Before' 기준이다.
create table if not exists public.mrv_baselines (
  id               text primary key,
  site_id          text not null references public.mrv_sites(id) on delete cascade,
  org_id           text not null references public.mrv_organizations(id) on delete cascade,
  period_start     timestamptz not null,
  period_end       timestamptz not null,
  ei_total         double precision,
  ei_aeration      double precision,
  oei              double precision,
  fcr              double precision,
  mortality_rate   double precision,
  config_version   text not null,
  kpi_snapshot_id  text references public.mrv_kpi_snapshots(id) on delete restrict,
  status           text not null default 'draft',
  locked_by        text,
  locked_at        timestamptz,
  created_at       timestamptz not null default now(),
  constraint ck_mrv_baselines_status check (status in ('draft', 'locked'))
);
create index if not exists ix_mrv_baselines_site_id on public.mrv_baselines (site_id);
create index if not exists ix_mrv_baselines_org_id on public.mrv_baselines (org_id);
-- 사이트당 활성 잠금 baseline 은 최대 1개(재잠금 방지).
create unique index if not exists ux_mrv_baselines_one_locked
  on public.mrv_baselines (site_id) where status = 'locked';

-- ★ ADR 0002 불변성: 잠긴 baseline 은 UPDATE/DELETE 자체를 DB 가 거부한다.
-- 관례(코드 리뷰)로는 부족하다는 것이 ADR 0002 의 결론이므로, service_role 로 접근하는
-- 경로까지 포함해 물리적으로 막는다.
create or replace function public.mrv_prevent_locked_baseline_change()
returns trigger as $$
begin
  if OLD.status = 'locked' then
    raise exception 'baseline % is locked and immutable (ADR 0002)', OLD.id;
  end if;
  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_mrv_baselines_immutable on public.mrv_baselines;
create trigger trg_mrv_baselines_immutable
  before update or delete on public.mrv_baselines
  for each row execute function public.mrv_prevent_locked_baseline_change();

-- ---------------------------------------------------------------------------
-- 5. 추천(운전 레시피) · 승인형 제어
-- ---------------------------------------------------------------------------

create table if not exists public.mrv_recipes (
  id               text primary key,
  site_id          text not null references public.mrv_sites(id) on delete cascade,
  org_id           text not null references public.mrv_organizations(id) on delete cascade,
  type             text not null,
  current_version  integer not null default 0,
  created_at       timestamptz not null default now(),
  constraint ck_mrv_recipes_type check (type in ('feed', 'oxygen', 'circulation')),
  constraint uq_mrv_recipes_site_type unique (site_id, type)
);
create index if not exists ix_mrv_recipes_site_id on public.mrv_recipes (site_id);
create index if not exists ix_mrv_recipes_org_id on public.mrv_recipes (org_id);

-- recipe_versions — append-only. baseline 과 달리 버전이 늘어나는 것 자체가 정상 동작이다
-- (잠금 개념 없음). org_id 는 부모 recipes.org_id 와 항상 같으며 RLS 앵커로만 쓴다.
create table if not exists public.mrv_recipe_versions (
  id           text primary key,
  recipe_id    text not null references public.mrv_recipes(id) on delete cascade,
  org_id       text not null references public.mrv_organizations(id) on delete cascade,
  version      integer not null,
  params_json  jsonb not null,
  rationale    text not null,
  created_by   text not null,
  created_at   timestamptz not null default now(),
  constraint uq_mrv_recipe_versions_recipe_version unique (recipe_id, version)
);
create index if not exists ix_mrv_recipe_versions_recipe_id on public.mrv_recipe_versions (recipe_id);
create index if not exists ix_mrv_recipe_versions_org_id on public.mrv_recipe_versions (org_id);

-- control_actions — 승인형 제어(ENTERPRISE).
-- ★ 승인 게이트를 CHECK 제약으로 물리적으로 강제한다: 적용은 반드시 승인 시각을,
-- 승인은 반드시 승인자를 동반한다. 애플리케이션 버그나 수동 SQL 로도 우회할 수 없다.
create table if not exists public.mrv_control_actions (
  id                 text primary key,
  tank_id            text not null references public.mrv_tanks(id) on delete cascade,
  recipe_version_id  text not null references public.mrv_recipe_versions(id) on delete restrict,
  site_id            text not null references public.mrv_sites(id) on delete cascade,
  org_id             text not null references public.mrv_organizations(id) on delete cascade,
  -- 제안 등록 시점 recipe_versions.params_json 스냅샷(불변 — 이후 recipe 가 새 버전으로
  -- 바뀌어도 이 행은 영향받지 않는다).
  recommended_json   jsonb not null default '{}'::jsonb,
  status             text not null default 'pending',
  approved_by        text,
  approved_at        timestamptz,
  applied_at         timestamptz,
  result_json        jsonb,
  created_at         timestamptz not null default now(),
  constraint ck_mrv_control_actions_status
    check (status in ('pending', 'approved', 'rejected', 'applied')),
  constraint ck_mrv_control_actions_applied_requires_approved_at
    check (status <> 'applied' or approved_at is not null),
  constraint ck_mrv_control_actions_approved_requires_approved_by
    check (status <> 'approved' or approved_by is not null)
);
create index if not exists ix_mrv_control_actions_tank_id on public.mrv_control_actions (tank_id);
create index if not exists ix_mrv_control_actions_site_id on public.mrv_control_actions (site_id);
create index if not exists ix_mrv_control_actions_org_id on public.mrv_control_actions (org_id);
create index if not exists ix_mrv_control_actions_status on public.mrv_control_actions (status);

-- ---------------------------------------------------------------------------
-- 6. 배출계수 · MRV 리포트 · SOP · 알림 · 감사 로그 · API 키
-- ---------------------------------------------------------------------------

-- emission_factors — kpi_config 과 같은 org 전역 설정(국가 전력 배출계수는 테넌트별로
-- 다르지 않다). append-only: 과거 리포트가 참조한 값이 사후에 바뀌면 증빙 무결성이 깨진다.
-- ★ 값을 코드에 하드코딩하지 않는 이유가 이 테이블이다 — 출처/연도/버전을 함께 저장해
-- 리포트에 명시하고 제3자가 검증할 수 있게 한다.
create table if not exists public.mrv_emission_factors (
  id                    text primary key,
  factor_tco2e_per_mwh  double precision not null,
  source                text not null,
  year                  integer not null,
  version               text not null unique,
  effective_from        timestamptz not null,
  created_at            timestamptz not null default now()
);

-- mrv_reports — before_json/after_json 은 재계산하지 않고 생성 시점 구조 그대로 영속한다.
-- 수정/삭제 경로를 두지 않는다(재생성이 필요하면 새 행을 추가).
create table if not exists public.mrv_reports (
  id                     text primary key,
  site_id                text not null references public.mrv_sites(id) on delete cascade,
  org_id                 text not null references public.mrv_organizations(id) on delete cascade,
  baseline_id            text not null references public.mrv_baselines(id) on delete restrict,
  period_start           timestamptz not null,
  period_end             timestamptz not null,
  emission_factor_id     text not null references public.mrv_emission_factors(id) on delete restrict,
  after_kpi_snapshot_id  text not null references public.mrv_kpi_snapshots(id) on delete restrict,
  before_json            jsonb not null default '{}'::jsonb,
  after_json             jsonb not null default '{}'::jsonb,
  reduction_tco2e        double precision,
  -- 실제 대입값이 들어간 산식 전문. 리포트의 재현성 증빙이다.
  formula_text           text not null,
  -- 측정경계·가정(자동 생성, 자유 입력 아님).
  boundary_json          jsonb not null default '{}'::jsonb,
  pdf_path               text,
  generated_by           text not null,
  generated_at           timestamptz not null default now()
);
create index if not exists ix_mrv_reports_site_id on public.mrv_reports (site_id);
create index if not exists ix_mrv_reports_org_id on public.mrv_reports (org_id);

-- SOP 문서 콘텐츠 자체는 DB 밖 정적 파일로 관리한다. 이 테이블은 "누가 언제 무엇을
-- 점검했는가"라는 증빙만 남긴다(append-only). sop_id 는 그래서 FK 가 아닌 느슨한 참조다.
create table if not exists public.mrv_sop_checklist_runs (
  id            text primary key,
  site_id       text not null references public.mrv_sites(id) on delete cascade,
  org_id        text not null references public.mrv_organizations(id) on delete cascade,
  sop_id        text not null,
  items_json    jsonb not null default '[]'::jsonb,
  performed_by  text not null,
  performed_at  timestamptz not null default now()
);
create index if not exists ix_mrv_sop_runs_site_id on public.mrv_sop_checklist_runs (site_id);
create index if not exists ix_mrv_sop_runs_org_id on public.mrv_sop_checklist_runs (org_id);
create index if not exists ix_mrv_sop_runs_sop_id on public.mrv_sop_checklist_runs (sop_id);

-- alerts — 임계치 배치 평가 결과. append-only + status 전이(open→ack)만 허용.
create table if not exists public.mrv_alerts (
  id            text primary key,
  site_id       text not null references public.mrv_sites(id) on delete cascade,
  org_id        text not null references public.mrv_organizations(id) on delete cascade,
  type          text not null,
  severity      text not null,
  -- 판정 근거(트리거값·임계값·source refs — drill-down).
  payload_json  jsonb not null,
  status        text not null default 'open',
  created_at    timestamptz not null default now(),
  acked_by      text,
  acked_at      timestamptz,
  constraint ck_mrv_alerts_type check (type in ('do_low', 'mortality_spike', 'kpi_red')),
  constraint ck_mrv_alerts_severity check (severity in ('info', 'warning', 'critical')),
  constraint ck_mrv_alerts_status check (status in ('open', 'ack'))
);
create index if not exists ix_mrv_alerts_site_id on public.mrv_alerts (site_id);
create index if not exists ix_mrv_alerts_org_id on public.mrv_alerts (org_id);
create index if not exists ix_mrv_alerts_created_at on public.mrv_alerts (org_id, created_at desc);

-- audit_logs — 모든 제어/설정 변경의 감사 기록. append-only.
create table if not exists public.mrv_audit_logs (
  id         text primary key,
  org_id     text not null references public.mrv_organizations(id) on delete cascade,
  actor_id   text not null,
  entity     text not null,
  entity_id  text not null,
  action     text not null,
  -- {before, after} 형태의 변경 diff. 생성은 before=null.
  diff_json  jsonb not null default '{}'::jsonb,
  note       text,
  ts         timestamptz not null default now()
);
create index if not exists ix_mrv_audit_logs_org_id on public.mrv_audit_logs (org_id);
create index if not exists ix_mrv_audit_logs_ts on public.mrv_audit_logs (org_id, ts desc);

-- api_keys — ingestion 게이트웨이 인증. 원문 키는 저장하지 않고 해시만 보관한다.
-- (org_id, site_id) 스코프가 수집 시 테넌시를 확정한다 — 토픽이나 요청 본문은 믿지 않는다.
create table if not exists public.mrv_api_keys (
  id          text primary key,
  org_id      text not null references public.mrv_organizations(id) on delete cascade,
  site_id     text not null references public.mrv_sites(id) on delete cascade,
  key_hash    text not null unique,
  label       text,
  revoked     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists ix_mrv_api_keys_org_id on public.mrv_api_keys (org_id);
create index if not exists ix_mrv_api_keys_site_id on public.mrv_api_keys (site_id);

-- ============================================================================
-- 7. RLS — 테넌트 격리 (Hard Rule 4: 테넌트 간 데이터 누수 0건)
--
-- 원본은 세션 GUC `app.current_org_id` 를 요청마다 SET 해 정책이 그것을 읽었다.
-- Supabase 에서는 JWT 의 auth.uid() 가 그 자리를 대신한다 — 클라이언트가 값을 정할 수
-- 있는 세션 변수가 아니라 서명된 토큰에서 나오므로 사칭이 불가능하고, 커넥션 풀링과도
-- 무관하다(원본 ADR 0006 이 GUC 방식의 약점으로 지목한 바로 그 지점).
--
-- 방어선은 원본과 같이 이중이다:
--   1차) API Route 의 authorizeMrv() — 호출자의 org/role 을 확정하고 질의를 그 org 로 좁힌다.
--   2차) 여기 RLS — 1차가 뚫려도(코드 버그, 직접 PostgREST 접근) DB 가 행을 내주지 않는다.
-- service_role 키는 RLS 를 우회하므로 1차 방어가 곧 그 경로의 유일한 방어선이다.
-- 그래서 authorizeMrv() 없이 조기 반환하는 분기를 두어서는 안 된다.
-- ============================================================================

-- 현재 로그인 계정이 속한 org 목록. 정책이 매 행마다 부르므로 stable 로 표시한다.
-- security definer: 정책 안에서 mrv_users 를 읽어야 하는데, mrv_users 자체에도 RLS 가
-- 걸려 있어 무한 재귀가 된다. definer 로 그 고리를 끊는다.
create or replace function public.mrv_current_org_ids()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.mrv_users where supabase_user_id = auth.uid()
$$;

revoke all on function public.mrv_current_org_ids() from public;
grant execute on function public.mrv_current_org_ids() to authenticated, service_role;

do $$
declare
  t text;
  -- org_id 를 직접 들고 있는(=RLS 앵커가 있는) 테이블 전부.
  org_scoped text[] := array[
    'mrv_sites', 'mrv_tanks', 'mrv_batches', 'mrv_meters', 'mrv_readings',
    'mrv_feed_logs', 'mrv_mortality_logs', 'mrv_harvest_logs',
    'mrv_kpi_snapshots', 'mrv_baselines',
    'mrv_recipes', 'mrv_recipe_versions', 'mrv_control_actions',
    'mrv_reports', 'mrv_sop_checklist_runs', 'mrv_alerts', 'mrv_audit_logs',
    'mrv_api_keys'
  ];
begin
  foreach t in array org_scoped loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists org_isolation_%s on public.%I', t, t);
    execute format(
      'create policy org_isolation_%s on public.%I '
      'using (org_id in (select public.mrv_current_org_ids())) '
      'with check (org_id in (select public.mrv_current_org_ids()))',
      t, t
    );
  end loop;
end
$$;

-- organizations 는 org_id 컬럼이 없으므로 id 로 같은 판정을 한다.
alter table public.mrv_organizations enable row level security;
alter table public.mrv_organizations force row level security;
drop policy if exists org_isolation_mrv_organizations on public.mrv_organizations;
create policy org_isolation_mrv_organizations on public.mrv_organizations
  using (id in (select public.mrv_current_org_ids()))
  with check (id in (select public.mrv_current_org_ids()));

-- mrv_users 는 읽기와 쓰기를 나눈다.
--   · 읽기: 자기 행 + 같은 org 동료. 로그인 직후 "나는 어느 org 인가"를 알아내려면
--     org 를 알기 전에 자기 행을 읽을 수 있어야 하는데, auth.uid() 매칭이 그 조건을
--     org 를 몰라도 만족시킨다. (원본은 이 자리에서 USING(true) 로 전면 개방해야 했다 —
--     GUC 방식에는 "나"를 가리킬 수단이 없었기 때문이다. 여기서는 그럴 필요가 없다.)
--   · 쓰기: org 스코프 강제. 피해 org 에 role='owner' 행을 밀어 넣어 테넌트를 탈취하는
--     것이 이 시스템에서 가장 값비싼 공격이므로 이 방어선은 절대 열지 않는다.
alter table public.mrv_users enable row level security;
alter table public.mrv_users force row level security;
drop policy if exists org_isolation_mrv_users on public.mrv_users;
drop policy if exists mrv_users_select_self_or_org on public.mrv_users;
drop policy if exists mrv_users_insert_org on public.mrv_users;
drop policy if exists mrv_users_update_org on public.mrv_users;
drop policy if exists mrv_users_delete_org on public.mrv_users;

create policy mrv_users_select_self_or_org on public.mrv_users for select
  using (supabase_user_id = auth.uid() or org_id in (select public.mrv_current_org_ids()));
create policy mrv_users_insert_org on public.mrv_users for insert
  with check (org_id in (select public.mrv_current_org_ids()));
create policy mrv_users_update_org on public.mrv_users for update
  using (org_id in (select public.mrv_current_org_ids()))
  with check (org_id in (select public.mrv_current_org_ids()));
create policy mrv_users_delete_org on public.mrv_users for delete
  using (org_id in (select public.mrv_current_org_ids()));

-- kpi_config 와 emission_factors 는 org 전역 설정이다(국가 배출계수·산식 파라미터는
-- 테넌트별로 다르지 않다). 로그인한 사용자면 읽을 수 있고, 쓰기는 service_role 만 한다
-- — 쓰기 정책을 하나도 만들지 않으면 RLS 가 켜진 상태에서 그렇게 된다.
alter table public.mrv_kpi_config enable row level security;
alter table public.mrv_kpi_config force row level security;
drop policy if exists mrv_kpi_config_read on public.mrv_kpi_config;
create policy mrv_kpi_config_read on public.mrv_kpi_config for select
  using (auth.uid() is not null);

alter table public.mrv_emission_factors enable row level security;
alter table public.mrv_emission_factors force row level security;
drop policy if exists mrv_emission_factors_read on public.mrv_emission_factors;
create policy mrv_emission_factors_read on public.mrv_emission_factors for select
  using (auth.uid() is not null);

-- ============================================================================
-- 8. 기본 데이터 — 산식 파라미터 버전과 배출계수
--
-- 둘 다 "값을 코드에 박지 않는다"는 원칙의 실체다. 코드는 여기 담긴 값을 읽어 쓰고,
-- 리포트는 어떤 version 을 썼는지 함께 기록한다.
-- ============================================================================

-- KPI 산식 파라미터 v2026.1.0. 값은 전부 엔진 기본값과 같다(lib/mrv/kpi/types.ts).
-- 실증으로 계수를 보정할 때는 이 행을 고치지 말고 새 version 행을 추가할 것 —
-- 과거 스냅샷이 어떤 파라미터로 산출됐는지 추적할 수 없게 된다.
insert into public.mrv_kpi_config (id, version, params_json, effective_from)
values (
  'kpicfg-2026-1-0',
  '2026.1.0',
  jsonb_build_object(
    'ei', jsonb_build_object(
      'included_quality_flags', jsonb_build_array('ok'),
      'min_biomass_delta_kg', 0.0),
    'fcr', jsonb_build_object(
      'included_quality_flags', jsonb_build_array('ok'),
      'min_biomass_delta_kg', 0.0),
    'oei', jsonb_build_object(
      'included_quality_flags', jsonb_build_array('ok'),
      'min_biomass_kg', 0.0,
      'do_band_method', 'sample_count',
      'oei_scale_factor', 1.0,
      'clamp_max', 100.0),
    'mortality', jsonb_build_object('moving_avg_window_days', 7)
  ),
  timestamptz '2026-01-01 00:00:00+00'
)
on conflict (version) do nothing;

-- 국가 전력 배출계수. ★ 이 값은 운영자가 확인해 갱신해야 한다 —
-- 환경부/온실가스종합정보센터(GIR)가 공표하는 최신 국가 전력 배출계수를 확인하고,
-- 값이 다르면 이 행을 고치지 말고 새 version 행을 추가한 뒤 새 리포트부터 그것을 쓴다.
-- (기존 리포트는 emission_factor_id 로 자기가 쓴 계수를 계속 가리키므로 영향받지 않는다.)
insert into public.mrv_emission_factors
  (id, factor_tco2e_per_mwh, source, year, version, effective_from)
values (
  'ef-kr-grid-2024',
  0.4594,
  '환경부 온실가스종합정보센터(GIR) 국가 전력 배출계수 — 운영자 확인 필요',
  2024,
  'KR-GRID-2024.1',
  timestamptz '2024-01-01 00:00:00+00'
)
on conflict (version) do nothing;

-- ============================================================================
-- 9. 시계열 집계 함수 — 대시보드 차트 전용
--
-- 원본은 SQLAlchemy 로 `date_trunc` GROUP BY 를 서버에서 돌렸다. PostgREST 질의
-- 빌더로는 그런 집계를 표현할 수 없고, 그렇다고 원본 행을 전부 끌어와 앱에서 합치면
-- 집계를 도입한 이유(원본 행이 너무 많아 raw 상한 5000 을 넘는 상황)가 사라진다.
-- 그래서 집계를 DB 함수로 옮긴다 — 계산 위치와 규칙 모두 원본 그대로다.
--
-- 규칙(원본과 동일):
--   · 버킷 = date_trunc('hour'|'day', time)
--   · 값   = power 는 SUM, 그 외 계측 타입은 AVG
--   · 품질 = bad 하나라도 있으면 bad, 아니면 suspect 하나라도 있으면 suspect, 전부면 ok
--   · 기간 = [from, to) 반열림 — KPI 엔진의 기간 규약과 같다
--
-- ★ 이 함수는 차트 표시값만 만든다. 여기서 나온 값은 KPI 산식에 절대 투입되지 않는다
--   (KPI 는 언제나 원본 readings 를 엔진에 그대로 넣는다).
-- ============================================================================

create or replace function public.mrv_aggregate_readings(
  p_meter_ids   text[],
  p_from        timestamptz,
  p_to          timestamptz,
  p_granularity text,   -- 'hourly' | 'daily'
  p_sum         boolean -- true = SUM(power), false = AVG(그 외)
)
returns table (
  meter_id     text,
  bucket       timestamptz,
  value        double precision,
  quality_flag text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    r.meter_id,
    date_trunc(case when p_granularity = 'hourly' then 'hour' else 'day' end, r."time") as bucket,
    case when p_sum then sum(r.value) else avg(r.value) end as value,
    case max(case r.quality_flag when 'bad' then 2 when 'suspect' then 1 else 0 end)
      when 2 then 'bad' when 1 then 'suspect' else 'ok' end as quality_flag
  from public.mrv_readings r
  where r.meter_id = any(p_meter_ids)
    and r."time" >= p_from
    and r."time" <  p_to
  group by r.meter_id, bucket
  order by bucket, r.meter_id
$$;

-- security invoker 라 호출자의 RLS 가 그대로 적용된다 — 이 함수로 남의 org 계측값을
-- 읽을 수는 없다. service_role 로 호출할 때는 라우트가 meter_id 목록을 org 스코프에서
-- 미리 해석해 넘기는 것이 방어선이다.
grant execute on function public.mrv_aggregate_readings(text[], timestamptz, timestamptz, text, boolean)
  to authenticated, service_role;
