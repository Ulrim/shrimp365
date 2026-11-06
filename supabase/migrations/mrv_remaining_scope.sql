-- ---------------------------------------------------------------------------
-- 남은 사양 범위 일괄 — 리포트 자동화·이메일 · 맞춤 리포트 · A/B 실험 ·
-- 수확 기록 정정 · Scope 2 market-based.
--
-- ── 왜 한 파일인가 ─────────────────────────────────────────────────────────
-- 사람이 Supabase SQL Editor 에서 손으로 실행하는 단계다. 다섯 개로 쪼개면 실행
-- 순서와 누락을 사람이 관리해야 하고, 이 저장소는 이미 "다섯인 줄 알았더니 열이었다"
-- 를 한 번 겪었다. 한 번에 실행되게 두고 절마다 왜 필요한지를 여기에 적는다.
--
-- 멱등이다. 여러 번 실행해도 안전하다.
--
-- ── RLS ────────────────────────────────────────────────────────────────────
-- 새 표는 전부 org_id 를 직접 들고 있다(= RLS 앵커가 있다). `mrv_platform.sql` 의
-- org_scoped 루프와 **같은 정책**을 맨 아래에서 건다. org_id 없이 다른 표를 경유해
-- 판정하는 모양을 만들지 않는다 — 조인 한 번이 빠지면 격리가 조용히 뚫린다.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. 리포트 자동 생성 (주간/월간)
-- ===========================================================================
-- 사양서 화면 6번이 "리포트(주간/월간): **자동 생성**" 인데, 지금까지 리포트는 사람이
-- 기간을 골라 누를 때만 만들어졌다. 알림에는 배치 평가 창구(`/api/mrv/jobs/
-- evaluate-alerts`)가 있는데 리포트에는 없었다.
--
-- 일정은 **사이트마다** 둔다. 조직 단위로 두면 사이트별로 기준선 잠금 시점이 달라
-- 어떤 사이트는 리포트가 나오고 어떤 사이트는 안 나오는 이유를 설명할 자리가 없다.
create table if not exists public.mrv_report_schedules (
  id           text primary key,
  site_id      text not null references public.mrv_sites(id) on delete cascade,
  org_id       text not null references public.mrv_organizations(id) on delete cascade,
  -- 'weekly'(매주 월요일, 직전 7일) | 'monthly'(매월 1일, 직전 달)
  cadence      text not null check (cadence in ('weekly', 'monthly')),
  enabled      boolean not null default true,
  -- 이 일정으로 만든 리포트를 받을 주소. 비어 있으면 생성만 하고 보내지 않는다.
  recipients   jsonb not null default '[]'::jsonb,
  -- 어느 서식으로 만들 것인가(3절). null 이면 기본 서식.
  -- 외래키는 그 표가 만들어진 뒤에 건다(아래 3절 끝).
  template_id  text,
  -- 마지막으로 **성공한** 실행의 기간 끝. 다음 실행이 여기서 이어진다.
  -- 이 값이 있으면 같은 기간을 두 번 만들지 않는다(중복 발행은 증빙에서 특히 나쁘다 —
  -- 같은 기간에 리포트가 둘이면 어느 쪽이 근거인지 사람이 고르게 된다).
  last_period_end timestamptz,
  last_run_at  timestamptz,
  last_status  text,
  last_error   text,
  created_by   text not null,
  created_at   timestamptz not null default now(),
  -- 사이트마다 주기별로 하나. 같은 주기를 두 번 걸면 같은 기간이 두 번 발행된다.
  unique (site_id, cadence)
);
create index if not exists ix_mrv_report_schedules_site_id
  on public.mrv_report_schedules (site_id);
create index if not exists ix_mrv_report_schedules_org_id
  on public.mrv_report_schedules (org_id);


-- ===========================================================================
-- 2. 리포트 발송 기록
-- ===========================================================================
-- 사양서 화면 6번의 "이메일 발송". **보냈다는 사실 자체가 증빙**이므로 발송마다 한 줄을
-- 남긴다 — 누구에게, 언제, 성공했는지. 실패도 남긴다(남기지 않으면 "안 왔다" 는 말에
-- 답할 근거가 없다).
--
-- 본문은 저장하지 않는다. 본문은 리포트에서 다시 만들 수 있고, 수신자 주소 말고는
-- 개인정보를 쌓지 않는 편이 낫다.
create table if not exists public.mrv_report_deliveries (
  id          text primary key,
  report_id   text not null references public.mrv_reports(id) on delete cascade,
  org_id      text not null references public.mrv_organizations(id) on delete cascade,
  -- 지금은 'email' 하나다. 채널이 늘면 여기에 붙는다.
  channel     text not null default 'email',
  recipient   text not null,
  -- 'sent' | 'failed' | 'skipped'(보낼 곳이 없거나 발송기가 꺼져 있음)
  status      text not null,
  provider    text,
  error       text,
  attempted_at timestamptz not null default now()
);
create index if not exists ix_mrv_report_deliveries_report_id
  on public.mrv_report_deliveries (report_id);
create index if not exists ix_mrv_report_deliveries_org_id
  on public.mrv_report_deliveries (org_id);


-- ===========================================================================
-- 3. 맞춤 리포트 서식 (ENTERPRISE)
-- ===========================================================================
-- 사양서 화면 13번 "맞춤 리포트 빌더 — KPI/탄소 리포트 템플릿 커스터마이즈".
--
-- **서식이 바꾸는 것은 보여 주기뿐이다.** 어떤 절을 넣고 뺄지, 어떤 지표를 표에 올릴지,
-- 표지에 무엇을 적을지만 정한다. 산식·배출계수·기간은 서식이 건드리지 못한다 — 서식으로
-- 숫자가 달라질 수 있으면 "어느 서식으로 뽑았느냐" 가 감축량을 바꾸는 변수가 된다.
create table if not exists public.mrv_report_templates (
  id          text primary key,
  org_id      text not null references public.mrv_organizations(id) on delete cascade,
  name        text not null,
  -- 넣을 절. 예: ["summary","kpi_table","formula","boundary","provenance","unavailability"]
  sections    jsonb not null default '[]'::jsonb,
  -- 표에 올릴 지표. 예: ["ei_total","ei_aeration","fcr","oei","mortality_rate"]
  metrics     jsonb not null default '[]'::jsonb,
  -- 표지 제목·머리말(자유 입력). 숫자를 적는 칸이 아니다.
  cover_title text,
  cover_note  text,
  is_default  boolean not null default false,
  created_by  text not null,
  created_at  timestamptz not null default now()
);
create index if not exists ix_mrv_report_templates_org_id
  on public.mrv_report_templates (org_id);

-- 발행된 리포트는 **그때 쓴 서식을 얼려서** 들고 있다. 서식을 나중에 고쳐도 이미 발행된
-- 리포트의 모양이 사후에 바뀌면 안 된다 — 배출계수 출처를 boundary_json 에 얼린 것과
-- 같은 이유다.
alter table public.mrv_reports
  add column if not exists template_id text
    references public.mrv_report_templates(id) on delete set null;
alter table public.mrv_reports
  add column if not exists template_json jsonb;

-- 1절에서 미뤄 둔 외래키. 표 생성 순서 때문에 여기에 있다.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mrv_report_schedules_template_id_fkey'
  ) then
    alter table public.mrv_report_schedules
      add constraint mrv_report_schedules_template_id_fkey
      foreign key (template_id) references public.mrv_report_templates(id)
      on delete set null;
  end if;
end $$;


-- ===========================================================================
-- 4. 비교실험(A/B) 구성
-- ===========================================================================
-- 사양서 화면 9번 "전·후 비교(A/B) 분석: 기준선 vs 적용 후 KPI, **비교실험(A/B)
-- 구성**·결과". 지금까지 비교 화면은 잠긴 기준선 ↔ 조회 기간만 견줬고, 실험을 정의하는
-- 개체가 없었다. 그래서 "무엇을 바꿔 보았는가" 가 어디에도 남지 않았다.
--
-- **대조군 기간을 실험이 직접 들고 있다.** 기준선을 쓰면 실험마다 기준선을 새로 잠가야
-- 하는데 기준선은 사이트당 하나이고 불변이다. 실험은 그보다 가벼운 "이 기간 ↔ 저 기간"
-- 비교이고, 둘 다 기록이 있는 과거 구간이다.
create table if not exists public.mrv_experiments (
  id             text primary key,
  site_id        text not null references public.mrv_sites(id) on delete cascade,
  org_id         text not null references public.mrv_organizations(id) on delete cascade,
  name           text not null,
  -- 무엇을 바꿨고 무엇을 기대했는가. 결과를 읽을 때 이 문장이 있어야 해석이 된다.
  hypothesis     text,
  -- 바꾸기 전 구간
  control_from   timestamptz not null,
  control_to     timestamptz not null,
  -- 바꾼 뒤 구간
  treatment_from timestamptz not null,
  treatment_to   timestamptz not null,
  -- 'running' | 'concluded' | 'abandoned'
  status         text not null default 'running'
                 check (status in ('running', 'concluded', 'abandoned')),
  -- 끝낼 때 사람이 적는 판단. 수치는 조회 시점에 다시 산출하므로 여기 적지 않는다.
  conclusion     text,
  concluded_at   timestamptz,
  created_by     text not null,
  created_at     timestamptz not null default now(),
  -- 구간이 뒤집히면 KPI 조회가 422 로 죽는다. 들어올 때 막는다.
  constraint mrv_experiments_control_order check (control_from < control_to),
  constraint mrv_experiments_treatment_order check (treatment_from < treatment_to)
);
create index if not exists ix_mrv_experiments_site_id
  on public.mrv_experiments (site_id);
create index if not exists ix_mrv_experiments_org_id
  on public.mrv_experiments (org_id);


-- ===========================================================================
-- 5. 수확 기록 정정 — 지우지 않고 무효로 표시한다
-- ===========================================================================
-- 잘못 넣은 생산량을 되돌릴 길이 없어 DB 를 직접 고쳐야 했다. 그런데 **지우는 것은
-- 답이 아니다.** 생산량은 EI·FCR·OEI 의 분모이고, 행이 사라지면 이미 발행된 리포트가
-- 참조한 근거가 흔적 없이 없어진다.
--
-- 그래서 무효화(void)로 둔다. 행은 남고 KPI 산입에서만 빠지며, **누가 왜 무효로 했는지**
-- 가 함께 남는다. 감사 로그와 합쳐 보면 "그때는 이 값이 있었고 이런 이유로 뺐다" 가
-- 재구성된다. 되돌리기(unvoid)도 같은 창구로 한다.
alter table public.mrv_harvest_logs
  add column if not exists voided_at timestamptz;
alter table public.mrv_harvest_logs
  add column if not exists voided_by text;
alter table public.mrv_harvest_logs
  add column if not exists void_reason text;
-- 산입 조회가 `voided_at is null` 로 거르므로 부분 인덱스를 둔다.
create index if not exists ix_mrv_harvest_logs_live
  on public.mrv_harvest_logs (site_id, ts) where voided_at is null;


-- ===========================================================================
-- 6. Scope 2 market-based — 계약상 전력 증서
-- ===========================================================================
-- 지금 Scope 2 는 location-based(계통 평균 배출계수) 하나뿐이다. market-based 는
-- REC·PPA·녹색프리미엄처럼 **계약으로 확보한 전력**에 그 계약의 배출계수를 쓰고, 남은
-- 전력에만 계통 계수를 쓴다.
--
-- ── 한국에는 공표된 residual mix 가 없다 ───────────────────────────────────
-- GHG Protocol 의 market-based 는 계약 전력을 뺀 **잔여 전력**에 residual mix(계약
-- 전력이 빠진 뒤의 계통 평균)를 쓰라고 한다. 한국은 그 값을 공표하지 않는다. 그래서
-- 이 구현은 잔여분에 **location-based 계수를 그대로** 쓰고, 리포트가 그 대체를 명시한다.
-- 숨기고 쓰면 그 자체가 과소·과대 산정이 된다.
create table if not exists public.mrv_contractual_instruments (
  id          text primary key,
  org_id      text not null references public.mrv_organizations(id) on delete cascade,
  -- 사이트별 계약이면 site_id, 조직 전체 계약이면 null.
  site_id     text references public.mrv_sites(id) on delete cascade,
  -- 'rec'(재생에너지 공급인증서) | 'ppa'(전력구매계약) | 'green_premium'(녹색프리미엄)
  kind        text not null check (kind in ('rec', 'ppa', 'green_premium')),
  -- 이 증서가 덮는 전력량(MWh)과 그 전력의 배출계수.
  -- 재생에너지 증서는 보통 0 이지만 0 을 기본값으로 박지 않는다 — 계약마다 다르고,
  -- 0 을 가정하면 사람이 확인하지 않은 값이 감축량으로 들어간다.
  mwh         double precision not null check (mwh > 0),
  factor_tco2e_per_mwh double precision not null check (factor_tco2e_per_mwh >= 0),
  -- 이 증서가 유효한 기간. 리포트 기간과 겹치는 만큼만 쓴다.
  period_start timestamptz not null,
  period_end   timestamptz not null,
  -- 증빙. 검증기관이 가장 먼저 묻는 것이 "그 증서가 실재하는가" 다.
  document_name text,
  certificate_id text,
  source_url   text,
  note         text,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  constraint mrv_contractual_instruments_period check (period_start < period_end)
);
create index if not exists ix_mrv_contractual_instruments_org_id
  on public.mrv_contractual_instruments (org_id);
create index if not exists ix_mrv_contractual_instruments_site_id
  on public.mrv_contractual_instruments (site_id);

-- 발행된 리포트는 market-based 산출 결과도 얼려서 들고 있다. null 이면 그 리포트는
-- location-based 만 담은 것이다(증서가 없었거나 기능 도입 전).
alter table public.mrv_reports
  add column if not exists market_based_json jsonb;


-- ===========================================================================
-- 7. RLS — mrv_platform.sql 의 org_scoped 루프와 같은 정책
-- ===========================================================================
do $$
declare
  t text;
  org_scoped text[] := array[
    'mrv_report_schedules', 'mrv_report_deliveries', 'mrv_report_templates',
    'mrv_experiments', 'mrv_contractual_instruments'
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


-- ===========================================================================
-- 확인
-- ===========================================================================
do $$
declare
  missing text[] := array[]::text[];
  t text;
begin
  foreach t in array array[
    'mrv_report_schedules', 'mrv_report_deliveries', 'mrv_report_templates',
    'mrv_experiments', 'mrv_contractual_instruments'
  ] loop
    if to_regclass('public.' || t) is null then
      missing := missing || t;
    end if;
  end loop;
  if array_length(missing, 1) is not null then
    raise warning '만들어지지 않은 표가 있습니다: %', missing;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'mrv_harvest_logs'
       and column_name = 'voided_at'
  ) then
    raise warning 'mrv_harvest_logs.voided_at 이 없습니다 — 생산량 정정이 동작하지 않습니다.';
  end if;
end $$;
