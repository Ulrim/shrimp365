-- ============================================================================
-- 현장관리(DailyWork) — Supabase 스키마
--
-- 원본: 공개 저장소 Ulrim/DailyWork 커밋 348652e ("CULIVER 스마트팜 통합 현장관리 시스템")
--       supabase/migrations/20261124000001_schema.sql ~ 20261124000004_storage.sql (4개)
-- 이 파일은 그 4개 마이그레이션을 shrimp365 의 Supabase Postgres(public 스키마)로 이식한 것이다.
--
-- 이식하며 달라진 점(그 외 테이블 구조·업무 규칙·예외 문구는 원본과 동일):
--   1) 모든 테이블·뷰·함수·트리거·인덱스·정책 이름에 `dw_` 접두사를 붙였다. shrimp365 가 이미
--      public 스키마에서 profiles 등을 쓰고 있어 그대로 두면 충돌한다. RPC 의 매개변수 이름과
--      반환 형태는 원본 그대로다. 저장소 버킷은 `dw-report-photos`.
--   2) 권한(grant/revoke)을 스키마 전체가 아니라 `dw_` 테이블·함수 하나하나에만 건다.
--      원본의 `revoke all on all tables in schema public …`, `grant … on all functions in schema
--      public …`, `alter default privileges …` 는 shrimp365 기존 테이블의 권한을 깨뜨리므로 옮기지
--      않았다. 결과로 얻는 권한은 원본과 같다 — anon 은 접근 불가, authenticated 는 RLS 범위 안,
--      이력·알림·검토 기록·통합일보는 함수와 트리거로만 기록된다.
--      (Supabase 는 public 스키마의 새 객체에 anon/authenticated 권한을 자동으로 주므로,
--      `dw_` 객체마다 먼저 전부 revoke 한 뒤 필요한 것만 다시 grant 한다.)
--   3) `auth.users` 트리거(`on_auth_user_created` / `handle_new_user`)를 옮기지 않았다.
--      shrimp365 가입 흐름에 끼어들지 않기 위해서다. 대신 초대제를 쓴다 —
--      `dw_invites` 테이블과 `dw_invite_member`, `dw_invite_executive`, `dw_accept_invites`,
--      `dw_bootstrap_executive`. 가입만으로는 `dw_profiles` 행이 생기지 않고, 이메일 인증이
--      끝난 계정이 자기 이메일 앞으로 온 초대를 수락할 때 생긴다.
--   4) `dw_profiles_guard`(역할·활성 여부·이메일은 관리자만 변경)는 유지하되 security definer 를
--      뗐다. 직접 수정(authenticated)은 원본과 똑같이 막고, 위 초대 함수(security definer)가
--      수락 과정에서 전사 역할을 넣는 것은 통과시키기 위해서다. service_role 은 원본처럼 통과한다.
--   5) 변경 이력(`dw_audit_logs.table_name`)에는 접두사를 뗀 원래 테이블 이름을 저장한다
--      (`daily_reports`, `tasks` …). 화면의 라벨 코드를 원본 그대로 쓰기 위해서다.
--   6) `dw_is_site_manager_elsewhere(p_user, p_project)` 추가. 원본 화면이 service_role 로
--      조회하던 "대상이 다른 사업장의 현장관리자인가"를 권한 확인을 거친 함수로 옮겼다.
--   7) `create extension pgcrypto` 를 뺐다. gen_random_uuid() 는 PostgreSQL 13 부터 내장이다.
--   8) 알림(`dw_notifications.link`)의 경로는 원본 그대로 `/tasks`, `/reports/<id>` 로 저장한다.
--      `/daumlabs/work` 접두사는 화면이 붙인다.
--
-- 실행: Supabase SQL Editor 에 이 파일 전체를 붙여 넣고 사람이 실행한다(postgres 권한 필요).
-- 멱등: create … if not exists / create or replace / drop … if exists 후 create 로만 이루어져
--       여러 번 실행해도 안전하다. 데이터는 지우지 않는다.
--
-- 최초 관리자 지정(실행 후 SQL Editor 에서 한 번):
--   select public.dw_bootstrap_executive('you@example.com', 'ceo', '이름');
--   · 그 이메일로 가입하고 이메일 인증을 마친 계정이 있으면 바로 대표이사가 된다('added').
--   · 아직 없으면 전사 역할 초대가 등록되고('invited'), 가입·인증 후 현장관리에 처음 들어올 때 수락된다.
-- ============================================================================

-- ===========================================================================
-- 1. 테이블
-- 모든 사업 데이터는 project_id 기준으로 관리한다.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 사용자 프로필 (auth.users 와 1:1)
-- ---------------------------------------------------------------------------
create table if not exists public.dw_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null check (length(btrim(full_name)) > 0),
  phone text,
  company text,
  position text,
  -- 전사 역할: chairman(회장), ceo(대표이사). 그 외 사용자는 null.
  global_role text check (global_role in ('chairman', 'ceo')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 사업장(프로젝트)
-- ---------------------------------------------------------------------------
create table if not exists public.dw_projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9-]{2,20}$'),
  name text not null check (length(btrim(name)) > 0),
  location text,
  description text,
  start_date date,
  end_date date,
  status text not null default 'active'
    check (status in ('planning', 'active', 'completed', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

-- 사업장 소속 및 역할: site_manager(현장관리자), site_worker(현장팀), partner(협력업체)
create table if not exists public.dw_project_members (
  project_id uuid not null references public.dw_projects (id) on delete cascade,
  user_id uuid not null references public.dw_profiles (id) on delete cascade,
  role text not null check (role in ('site_manager', 'site_worker', 'partner')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists dw_project_members_user_idx on public.dw_project_members (user_id);

-- ---------------------------------------------------------------------------
-- 공정
-- ---------------------------------------------------------------------------
create table if not exists public.dw_processes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.dw_projects (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  description text,
  sort_order integer not null default 0,
  weight numeric(6, 2) not null default 1 check (weight >= 0),
  planned_start date not null,
  planned_end date not null,
  actual_start date,
  actual_end date,
  progress numeric(5, 2) not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (planned_end >= planned_start),
  check (actual_end is null or actual_start is null or actual_end >= actual_start),
  unique (project_id, name)
);
create index if not exists dw_processes_project_idx on public.dw_processes (project_id, sort_order);

-- 공정 실적률 변경 기록 (계획 대비 실적 추이)
create table if not exists public.dw_process_progress_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.dw_projects (id) on delete cascade,
  process_id uuid not null references public.dw_processes (id) on delete cascade,
  log_date date not null,
  progress numeric(5, 2) not null check (progress between 0 and 100),
  source_report_id uuid,
  recorded_by uuid references public.dw_profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists dw_process_progress_logs_idx
  on public.dw_process_progress_logs (project_id, process_id, log_date);

-- ---------------------------------------------------------------------------
-- 업무 배정
-- ---------------------------------------------------------------------------
create table if not exists public.dw_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.dw_projects (id) on delete cascade,
  process_id uuid references public.dw_processes (id) on delete set null,
  title text not null check (length(btrim(title)) > 0),
  description text,
  assignee_id uuid not null references public.dw_profiles (id) on delete restrict,
  assigned_by uuid references public.dw_profiles (id) on delete set null,
  start_date date,
  due_date date,
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'done', 'on_hold')),
  progress integer not null default 0 check (progress between 0 and 100),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or start_date is null or due_date >= start_date)
);
create index if not exists dw_tasks_project_idx on public.dw_tasks (project_id, status);
create index if not exists dw_tasks_assignee_idx on public.dw_tasks (assignee_id, status);

-- ---------------------------------------------------------------------------
-- 일정 (owner_id 가 null 이면 전체 일정, 값이 있으면 개인 일정)
-- ---------------------------------------------------------------------------
create table if not exists public.dw_schedule_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.dw_projects (id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  description text,
  start_date date not null,
  end_date date not null,
  event_type text not null default 'construction'
    check (event_type in ('construction', 'meeting', 'inspection', 'delivery', 'personal', 'other')),
  owner_id uuid references public.dw_profiles (id) on delete cascade,
  process_id uuid references public.dw_processes (id) on delete set null,
  created_by uuid references public.dw_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists dw_schedule_events_project_idx on public.dw_schedule_events (project_id, start_date, end_date);

-- ---------------------------------------------------------------------------
-- 개인 작업일보
-- ---------------------------------------------------------------------------
create table if not exists public.dw_daily_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.dw_projects (id) on delete cascade,
  author_id uuid not null references public.dw_profiles (id) on delete restrict,
  work_date date not null,
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 60 check (break_minutes between 0 and 600),
  -- 실제 작업시간(분) = 종료 - 시작 - 휴게
  work_minutes integer generated always as (
    (extract(epoch from (end_time - start_time)) / 60)::integer - break_minutes
  ) stored,
  notes text,            -- 특이사항
  support_request text,  -- 지원 요청사항
  next_day_plan text,    -- 익일 작업계획
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'revision_requested')),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.dw_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  check ((extract(epoch from (end_time - start_time)) / 60)::integer - break_minutes > 0),
  -- 한 사람은 한 사업장에서 하루에 작업일보 1건만 작성할 수 있다 (중복 제출 차단)
  unique (project_id, author_id, work_date)
);
create index if not exists dw_daily_reports_project_date_idx on public.dw_daily_reports (project_id, work_date, status);

-- 작업내역 (작업일보 1건에 여러 건)
create table if not exists public.dw_report_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.dw_daily_reports (id) on delete cascade,
  project_id uuid not null references public.dw_projects (id) on delete cascade,
  process_id uuid references public.dw_processes (id) on delete set null,
  task_id uuid references public.dw_tasks (id) on delete set null,
  sort_order integer not null default 0,
  content text not null check (length(btrim(content)) > 0),  -- 작업내용
  result text,                                               -- 작업실적
  quantity numeric(12, 2) check (quantity is null or quantity >= 0),
  unit text,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'delayed', 'on_hold')),
  -- 연결된 업무의 누계 진행률(%)
  task_progress integer check (task_progress is null or task_progress between 0 and 100),
  -- 공정 누계 실적률(%). 승인 시 공정 실적률에 반영된다.
  process_progress numeric(5, 2)
    check (process_progress is null or process_progress between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dw_report_items_report_idx on public.dw_report_items (report_id, sort_order);
create index if not exists dw_report_items_process_idx on public.dw_report_items (project_id, process_id);

-- 현장 사진
create table if not exists public.dw_report_photos (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.dw_daily_reports (id) on delete cascade,
  item_id uuid references public.dw_report_items (id) on delete set null,
  project_id uuid not null references public.dw_projects (id) on delete cascade,
  storage_path text not null unique,
  caption text,
  uploaded_by uuid references public.dw_profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists dw_report_photos_report_idx on public.dw_report_photos (report_id);

-- 제출/승인/보완 요청/수정 요청 이력
create table if not exists public.dw_report_reviews (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.dw_daily_reports (id) on delete cascade,
  project_id uuid not null references public.dw_projects (id) on delete cascade,
  actor_id uuid references public.dw_profiles (id) on delete set null,
  action text not null check (action in (
    'submitted', 'resubmitted', 'approved', 'revision_requested',
    'change_requested', 'change_approved', 'change_rejected'
  )),
  comment text,
  created_at timestamptz not null default now()
);
create index if not exists dw_report_reviews_report_idx on public.dw_report_reviews (report_id, created_at);

-- 승인 완료된 작업일보의 수정 요청
create table if not exists public.dw_change_requests (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.dw_daily_reports (id) on delete cascade,
  project_id uuid not null references public.dw_projects (id) on delete cascade,
  requester_id uuid not null references public.dw_profiles (id) on delete restrict,
  reason text not null check (length(btrim(reason)) > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewer_id uuid references public.dw_profiles (id) on delete set null,
  review_comment text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists dw_change_requests_one_pending_idx
  on public.dw_change_requests (report_id) where status = 'pending';
create index if not exists dw_change_requests_project_idx on public.dw_change_requests (project_id, status);

-- ---------------------------------------------------------------------------
-- 통합 작업일보 (승인된 개인 작업일보를 작업일 단위로 취합한 스냅샷)
-- ---------------------------------------------------------------------------
create table if not exists public.dw_consolidated_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.dw_projects (id) on delete cascade,
  report_date date not null,
  weather text,
  summary text,  -- 관리자 종합 의견
  snapshot jsonb not null default '{}'::jsonb,
  is_finalized boolean not null default false,
  finalized_by uuid references public.dw_profiles (id) on delete set null,
  finalized_at timestamptz,
  generated_at timestamptz not null default now(),
  unique (project_id, report_date)
);

-- ---------------------------------------------------------------------------
-- 알림
-- ---------------------------------------------------------------------------
create table if not exists public.dw_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.dw_profiles (id) on delete cascade,
  project_id uuid references public.dw_projects (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists dw_notifications_user_idx on public.dw_notifications (user_id, is_read, created_at desc);

-- ---------------------------------------------------------------------------
-- 변경 이력 (트리거로 자동 기록)
-- ---------------------------------------------------------------------------
create table if not exists public.dw_audit_logs (
  id bigint generated always as identity primary key,
  project_id uuid,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id uuid,
  old_data jsonb,
  new_data jsonb,
  changed_fields text[],
  created_at timestamptz not null default now()
);
create index if not exists dw_audit_logs_project_idx on public.dw_audit_logs (project_id, created_at desc);
create index if not exists dw_audit_logs_record_idx on public.dw_audit_logs (table_name, record_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 초대 (이식본 신규). 현장관리 구성원은 초대받은 shrimp365 계정뿐이다.
--   · 사업장 초대: project_id + role (global_role 은 null)
--   · 전사 역할 초대: global_role (project_id·role 은 null)
-- 행은 dw_invite_member / dw_invite_executive / dw_bootstrap_executive 로만 만들고,
-- 본인이 dw_accept_invites 로 수락하면 지워진다.
-- ---------------------------------------------------------------------------
create table if not exists public.dw_invites (
  id uuid primary key default gen_random_uuid(),
  -- 소문자로 정규화해 저장한다
  email text not null check (email = lower(btrim(email)) and length(email) > 0),
  full_name text,
  phone text,
  company text,
  position text,
  project_id uuid references public.dw_projects (id) on delete cascade,
  role text check (role in ('site_manager', 'site_worker', 'partner')),
  global_role text check (global_role in ('chairman', 'ceo')),
  invited_by uuid references public.dw_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (
    (global_role is not null and project_id is null and role is null)
    or (global_role is null and project_id is not null and role is not null)
  )
);
-- 한 이메일은 사업장마다 초대 1건, 전사 역할 초대 1건
create unique index if not exists dw_invites_email_project_key
  on public.dw_invites (lower(email), project_id) where project_id is not null;
create unique index if not exists dw_invites_email_global_key
  on public.dw_invites (lower(email)) where project_id is null;
create index if not exists dw_invites_project_idx on public.dw_invites (project_id);

-- ===========================================================================
-- 2. 권한 판별 함수, 트리거, 업무 규칙 함수(RPC)
-- ===========================================================================

-- 권한 판별 함수, 트리거, 업무 규칙 함수(RPC)

-- ---------------------------------------------------------------------------
-- 공통
-- ---------------------------------------------------------------------------
create or replace function public.dw_kst_today() returns date
language sql stable
as $$ select (now() at time zone 'Asia/Seoul')::date $$;

create or replace function public.dw_set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 권한 판별 (RLS 정책에서 사용). 비활성 사용자는 모든 권한을 잃는다.
-- ---------------------------------------------------------------------------
create or replace function public.dw_is_executive() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from dw_profiles
    where id = auth.uid() and is_active and global_role is not null
  )
$$;

-- 반환값: executive | site_manager | site_worker | partner | null(권한 없음)
create or replace function public.dw_project_role(p_project uuid) returns text
language sql stable security definer set search_path = public
as $$
  select case
    when public.dw_is_executive() then 'executive'
    else (
      select pm.role
      from dw_project_members pm
      join dw_profiles p on p.id = pm.user_id
      where pm.project_id = p_project and pm.user_id = auth.uid() and p.is_active
    )
  end
$$;

create or replace function public.dw_is_project_member(p_project uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select public.dw_project_role(p_project) is not null $$;

create or replace function public.dw_is_project_manager(p_project uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.dw_project_role(p_project) in ('executive', 'site_manager'), false) $$;

-- 협력업체를 제외한 내부 구성원
create or replace function public.dw_is_internal_member(p_project uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.dw_project_role(p_project) in ('executive', 'site_manager', 'site_worker'), false)
$$;

create or replace function public.dw_shares_project_with(p_user uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from dw_project_members mine
    join dw_project_members theirs on theirs.project_id = mine.project_id
    join dw_profiles me on me.id = mine.user_id
    where mine.user_id = auth.uid() and me.is_active and theirs.user_id = p_user
  )
$$;

-- ---------------------------------------------------------------------------
-- 프로필
-- ---------------------------------------------------------------------------
-- (원본의 handle_new_user / on_auth_user_created 는 옮기지 않는다. 프로필은 초대 수락 시
--  dw_accept_invites 가 만든다 — 아래 '초대 · 수락' 절.)

-- 전사 역할·활성 여부·이메일은 회장/대표이사 또는 서버(서비스 키)만 바꿀 수 있다.
-- 원본과 달리 security definer 가 아니다 — current_user 로 "로그인 사용자가 직접 수정했는가"를
-- 가려야 하기 때문이다. 직접 수정은 current_user 가 authenticated 이고, 초대 함수
-- (dw_accept_invites 등, security definer) 안에서의 수정은 함수 소유자다. 사용자가 꾸며 낼 수 없는 값이다.
create or replace function public.dw_profiles_guard() returns trigger
language plpgsql set search_path = public
as $$
begin
  if auth.uid() is not null and current_user in ('authenticated', 'anon')
     and not public.dw_is_executive() then
    if new.global_role is distinct from old.global_role
       or new.is_active is distinct from old.is_active
       or new.email is distinct from old.email then
      raise exception '권한이 없습니다: 역할, 활성 여부, 이메일은 관리자만 변경할 수 있습니다.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists dw_profiles_guard on public.dw_profiles;
create trigger dw_profiles_guard before update on public.dw_profiles
  for each row execute function public.dw_profiles_guard();
drop trigger if exists dw_profiles_updated_at on public.dw_profiles;
create trigger dw_profiles_updated_at before update on public.dw_profiles
  for each row execute function public.dw_set_updated_at();
drop trigger if exists dw_projects_updated_at on public.dw_projects;
create trigger dw_projects_updated_at before update on public.dw_projects
  for each row execute function public.dw_set_updated_at();
drop trigger if exists dw_processes_updated_at on public.dw_processes;
create trigger dw_processes_updated_at before update on public.dw_processes
  for each row execute function public.dw_set_updated_at();
drop trigger if exists dw_tasks_updated_at on public.dw_tasks;
create trigger dw_tasks_updated_at before update on public.dw_tasks
  for each row execute function public.dw_set_updated_at();
drop trigger if exists dw_schedule_events_updated_at on public.dw_schedule_events;
create trigger dw_schedule_events_updated_at before update on public.dw_schedule_events
  for each row execute function public.dw_set_updated_at();
drop trigger if exists dw_daily_reports_updated_at on public.dw_daily_reports;
create trigger dw_daily_reports_updated_at before update on public.dw_daily_reports
  for each row execute function public.dw_set_updated_at();
drop trigger if exists dw_report_items_updated_at on public.dw_report_items;
create trigger dw_report_items_updated_at before update on public.dw_report_items
  for each row execute function public.dw_set_updated_at();

-- ---------------------------------------------------------------------------
-- 알림
-- ---------------------------------------------------------------------------
create or replace function public.dw_notify(
  p_user uuid, p_project uuid, p_type text, p_title text, p_body text, p_link text
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_user is null or p_user = auth.uid() then
    return;  -- 본인이 한 작업은 본인에게 알리지 않는다
  end if;
  insert into dw_notifications (user_id, project_id, type, title, body, link)
  values (p_user, p_project, p_type, p_title, p_body, p_link);
end $$;

-- 사업장 현장관리자에게 알림. 현장관리자가 없으면 회장/대표이사에게 보낸다.
create or replace function public.dw_notify_managers(
  p_project uuid, p_type text, p_title text, p_body text, p_link text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
  v_found boolean := false;
begin
  for v_user in
    select pm.user_id from dw_project_members pm
    join dw_profiles p on p.id = pm.user_id
    where pm.project_id = p_project and pm.role = 'site_manager' and p.is_active
  loop
    v_found := true;
    perform public.dw_notify(v_user, p_project, p_type, p_title, p_body, p_link);
  end loop;
  if not v_found then
    for v_user in select id from dw_profiles where global_role is not null and is_active loop
      perform public.dw_notify(v_user, p_project, p_type, p_title, p_body, p_link);
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 변경 이력
-- ---------------------------------------------------------------------------
create or replace function public.dw_audit_row() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[];
  v_project uuid;
  -- 접두사(dw_)를 뗀 원래 테이블 이름으로 기록한다(화면 라벨이 원본 이름을 쓴다)
  v_table text := regexp_replace(tg_table_name, '^dw_', '');
begin
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(v_new) n
    where n.key <> 'updated_at' and n.value is distinct from v_old -> n.key;
    if v_changed is null then
      return null;  -- 실제 변경 없음
    end if;
  end if;
  v_project := case
    when v_table = 'projects' then (v_row ->> 'id')::uuid
    else (v_row ->> 'project_id')::uuid
  end;
  insert into dw_audit_logs (project_id, table_name, record_id, action, actor_id, old_data, new_data, changed_fields)
  values (
    v_project, v_table,
    coalesce((v_row ->> 'id')::uuid, (v_row ->> 'user_id')::uuid),
    tg_op, auth.uid(), v_old, v_new, v_changed
  );
  return null;
end $$;

drop trigger if exists dw_audit_profiles on public.dw_profiles;
create trigger dw_audit_profiles after insert or update or delete on public.dw_profiles
  for each row execute function public.dw_audit_row();
drop trigger if exists dw_audit_projects on public.dw_projects;
create trigger dw_audit_projects after insert or update or delete on public.dw_projects
  for each row execute function public.dw_audit_row();
drop trigger if exists dw_audit_project_members on public.dw_project_members;
create trigger dw_audit_project_members after insert or update or delete on public.dw_project_members
  for each row execute function public.dw_audit_row();
drop trigger if exists dw_audit_processes on public.dw_processes;
create trigger dw_audit_processes after insert or update or delete on public.dw_processes
  for each row execute function public.dw_audit_row();
drop trigger if exists dw_audit_tasks on public.dw_tasks;
create trigger dw_audit_tasks after insert or update or delete on public.dw_tasks
  for each row execute function public.dw_audit_row();
drop trigger if exists dw_audit_schedule_events on public.dw_schedule_events;
create trigger dw_audit_schedule_events after insert or update or delete on public.dw_schedule_events
  for each row execute function public.dw_audit_row();
drop trigger if exists dw_audit_daily_reports on public.dw_daily_reports;
create trigger dw_audit_daily_reports after insert or update or delete on public.dw_daily_reports
  for each row execute function public.dw_audit_row();
drop trigger if exists dw_audit_report_items on public.dw_report_items;
create trigger dw_audit_report_items after insert or update or delete on public.dw_report_items
  for each row execute function public.dw_audit_row();
drop trigger if exists dw_audit_report_photos on public.dw_report_photos;
create trigger dw_audit_report_photos after insert or delete on public.dw_report_photos
  for each row execute function public.dw_audit_row();
drop trigger if exists dw_audit_change_requests on public.dw_change_requests;
create trigger dw_audit_change_requests after insert or update on public.dw_change_requests
  for each row execute function public.dw_audit_row();
drop trigger if exists dw_audit_consolidated_reports on public.dw_consolidated_reports;
create trigger dw_audit_consolidated_reports after update on public.dw_consolidated_reports
  for each row when (old.is_finalized is distinct from new.is_finalized
                     or old.summary is distinct from new.summary
                     or old.weather is distinct from new.weather)
  execute function public.dw_audit_row();

-- ---------------------------------------------------------------------------
-- 작업일보 보호 트리거
-- ---------------------------------------------------------------------------
-- 상태·승인 정보는 아래 업무 함수(submit_report 등)를 통해서만 바뀐다.
create or replace function public.dw_daily_reports_guard() returns trigger
language plpgsql
as $$
declare
  v_allowed boolean := coalesce(current_setting('app.status_change', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not v_allowed then
      new.status := 'draft';
      new.submitted_at := null;
      new.approved_at := null;
      new.approved_by := null;
    end if;
    return new;
  end if;

  if new.project_id <> old.project_id or new.author_id <> old.author_id then
    raise exception '작업일보의 사업장과 작성자는 변경할 수 없습니다.' using errcode = '42501';
  end if;
  if not v_allowed and (
    new.status is distinct from old.status
    or new.submitted_at is distinct from old.submitted_at
    or new.approved_at is distinct from old.approved_at
    or new.approved_by is distinct from old.approved_by
  ) then
    raise exception '작업일보 상태는 제출·승인 절차를 통해서만 변경할 수 있습니다.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists dw_daily_reports_guard on public.dw_daily_reports;
create trigger dw_daily_reports_guard before insert or update on public.dw_daily_reports
  for each row execute function public.dw_daily_reports_guard();

-- 작업내역: project_id 를 작업일보에서 가져오고, 공정·업무가 같은 사업장인지 검증한다.
create or replace function public.dw_report_items_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid;
begin
  select project_id into v_project from dw_daily_reports where id = new.report_id;
  if v_project is null then
    raise exception '작업일보를 찾을 수 없습니다.' using errcode = '23503';
  end if;
  new.project_id := v_project;
  if new.process_id is not null and not exists (
    select 1 from dw_processes where id = new.process_id and project_id = v_project
  ) then
    raise exception '다른 사업장의 공정은 선택할 수 없습니다.' using errcode = '23514';
  end if;
  if new.task_id is not null and not exists (
    select 1 from dw_tasks where id = new.task_id and project_id = v_project
  ) then
    raise exception '다른 사업장의 업무는 선택할 수 없습니다.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists dw_report_items_guard on public.dw_report_items;
create trigger dw_report_items_guard before insert or update on public.dw_report_items
  for each row execute function public.dw_report_items_guard();

create or replace function public.dw_report_photos_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid;
begin
  select project_id into v_project from dw_daily_reports where id = new.report_id;
  if v_project is null then
    raise exception '작업일보를 찾을 수 없습니다.' using errcode = '23503';
  end if;
  new.project_id := v_project;
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  if new.storage_path not like v_project::text || '/' || new.report_id::text || '/%' then
    raise exception '사진 경로가 올바르지 않습니다.' using errcode = '23514';
  end if;
  if new.item_id is not null and not exists (
    select 1 from dw_report_items where id = new.item_id and report_id = new.report_id
  ) then
    raise exception '다른 작업일보의 작업내역에는 사진을 연결할 수 없습니다.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists dw_report_photos_guard on public.dw_report_photos;
create trigger dw_report_photos_guard before insert or update on public.dw_report_photos
  for each row execute function public.dw_report_photos_guard();

-- ---------------------------------------------------------------------------
-- 업무 배정 트리거
-- ---------------------------------------------------------------------------
create or replace function public.dw_tasks_before_write() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from dw_project_members where project_id = new.project_id and user_id = new.assignee_id
  ) and not exists (
    select 1 from dw_profiles where id = new.assignee_id and global_role is not null
  ) then
    raise exception '담당자는 해당 사업장 구성원이어야 합니다.' using errcode = '23514';
  end if;
  if new.process_id is not null and not exists (
    select 1 from dw_processes where id = new.process_id and project_id = new.project_id
  ) then
    raise exception '다른 사업장의 공정은 선택할 수 없습니다.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.assigned_by := coalesce(auth.uid(), new.assigned_by);
  elsif new.project_id <> old.project_id then
    raise exception '업무의 사업장은 변경할 수 없습니다.' using errcode = '42501';
  end if;
  if new.status = 'done' then
    new.progress := 100;
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
    if new.progress = 100 then
      new.status := 'done';
      new.completed_at := now();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists dw_tasks_before_write on public.dw_tasks;
create trigger dw_tasks_before_write before insert or update on public.dw_tasks
  for each row execute function public.dw_tasks_before_write();

create or replace function public.dw_tasks_notify() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.assignee_id <> old.assignee_id then
    perform public.dw_notify(
      new.assignee_id, new.project_id, 'task_assigned',
      '새 업무가 배정되었습니다', new.title, '/tasks'
    );
  end if;
  return null;
end $$;

drop trigger if exists dw_tasks_notify on public.dw_tasks;
create trigger dw_tasks_notify after insert or update on public.dw_tasks
  for each row execute function public.dw_tasks_notify();

-- ---------------------------------------------------------------------------
-- 공정률
-- ---------------------------------------------------------------------------
-- 계획 공정률: 계획 기간 대비 경과일의 선형 값
create or replace function public.dw_planned_progress(p_start date, p_end date, p_as_of date)
returns numeric
language sql immutable
as $$
  select case
    when p_as_of < p_start then 0
    when p_as_of >= p_end then 100
    else round(((p_as_of - p_start + 1)::numeric / (p_end - p_start + 1)) * 100, 2)
  end
$$;

-- 공정 실적률이 바뀌면 기록을 남긴다 (승인 반영 시에는 작업일을 기록일로 쓴다)
create or replace function public.dw_processes_log_progress() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_date text := nullif(current_setting('app.progress_log_date', true), '');
  v_report text := nullif(current_setting('app.progress_report_id', true), '');
begin
  if tg_op = 'INSERT' and new.progress = 0 then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.progress = old.progress then
    return null;
  end if;
  insert into dw_process_progress_logs (project_id, process_id, log_date, progress, source_report_id, recorded_by)
  values (new.project_id, new.id, coalesce(v_date::date, public.dw_kst_today()), new.progress, v_report::uuid, auth.uid());
  return null;
end $$;

drop trigger if exists dw_processes_log_progress on public.dw_processes;
create trigger dw_processes_log_progress after insert or update on public.dw_processes
  for each row execute function public.dw_processes_log_progress();

-- 특정 일자 기준 공정 실적률 (기록이 없으면 0)
create or replace function public.dw_process_progress_at(p_process uuid, p_as_of date)
returns numeric
language sql stable
as $$
  select coalesce((
    select l.progress from public.dw_process_progress_logs l
    where l.process_id = p_process and l.log_date <= p_as_of
    order by l.log_date desc, l.created_at desc
    limit 1
  ), 0)
$$;

-- 전체 공정률 = Σ(가중치 × 공정률) ÷ Σ가중치
create or replace function public.dw_project_progress(p_project uuid, p_as_of date default null)
returns table (actual numeric, planned numeric, total_weight numeric)
language sql stable
as $$
  with d as (select coalesce(p_as_of, public.dw_kst_today()) as as_of),
  rows as (
    select
      p.weight,
      case when d.as_of >= public.dw_kst_today() then p.progress
           else public.dw_process_progress_at(p.id, d.as_of) end as actual,
      public.dw_planned_progress(p.planned_start, p.planned_end, d.as_of) as planned
    from public.dw_processes p, d
    where p.project_id = p_project
  )
  select
    coalesce(round(sum(weight * actual) / nullif(sum(weight), 0), 2), 0),
    coalesce(round(sum(weight * planned) / nullif(sum(weight), 0), 2), 0),
    coalesce(sum(weight), 0)
  from rows
$$;

-- 공정별 현황 (계획률, 지연 여부 포함)
create or replace view public.dw_process_status
with (security_invoker = true) as
select
  p.*,
  public.dw_planned_progress(p.planned_start, p.planned_end, public.dw_kst_today()) as planned_progress,
  (
    p.progress < 100 and (
      p.planned_end < public.dw_kst_today()
      or public.dw_planned_progress(p.planned_start, p.planned_end, public.dw_kst_today()) - p.progress >= 10
    )
  ) as is_delayed
from public.dw_processes p;

-- ---------------------------------------------------------------------------
-- 통합 작업일보
-- ---------------------------------------------------------------------------
create or replace function public.dw_build_consolidated_snapshot(p_project uuid, p_date date)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with approved as (
    select r.*, p.full_name, p.company, p.position,
      coalesce(pm.role, case when p.global_role is not null then 'executive' end) as member_role
    from dw_daily_reports r
    join dw_profiles p on p.id = r.author_id
    left join dw_project_members pm on pm.project_id = r.project_id and pm.user_id = r.author_id
    where r.project_id = p_project and r.work_date = p_date and r.status = 'approved'
  ),
  items as (
    select i.*, a.full_name, pr.name as process_name, pr.sort_order as process_order, t.title as task_title
    from dw_report_items i
    join approved a on a.id = i.report_id
    left join dw_processes pr on pr.id = i.process_id
    left join dw_tasks t on t.id = i.task_id
  )
  select jsonb_build_object(
    'report_date', p_date,
    'worker_count', (select count(*) from approved),
    'total_work_minutes', (select coalesce(sum(work_minutes), 0) from approved),
    'progress', (select jsonb_build_object('actual', pp.actual, 'planned', pp.planned)
                 from public.dw_project_progress(p_project, p_date) pp),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'report_id', a.id,
        'author_id', a.author_id,
        'author_name', a.full_name,
        'company', a.company,
        'role', a.member_role,
        'start_time', to_char(a.start_time, 'HH24:MI'),
        'end_time', to_char(a.end_time, 'HH24:MI'),
        'break_minutes', a.break_minutes,
        'work_minutes', a.work_minutes,
        'notes', a.notes,
        'support_request', a.support_request,
        'next_day_plan', a.next_day_plan,
        'photo_count', (select count(*) from dw_report_photos ph where ph.report_id = a.id),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'process_name', i.process_name,
            'task_title', i.task_title,
            'content', i.content,
            'result', i.result,
            'quantity', i.quantity,
            'unit', i.unit,
            'status', i.status,
            'process_progress', i.process_progress
          ) order by i.sort_order, i.created_at)
          from items i where i.report_id = a.id
        ), '[]'::jsonb)
      ) order by a.full_name)
      from approved a
    ), '[]'::jsonb),
    'by_process', coalesce((
      select jsonb_agg(g.obj order by g.process_order nulls last, g.process_name)
      from (
        select
          min(i.process_order) as process_order,
          coalesce(i.process_name, '공정 미지정') as process_name,
          jsonb_build_object(
            'process_id', i.process_id,
            'process_name', coalesce(i.process_name, '공정 미지정'),
            'worker_count', count(distinct i.report_id),
            'items', jsonb_agg(jsonb_build_object(
              'author_name', i.full_name,
              'content', i.content,
              'result', i.result,
              'quantity', i.quantity,
              'unit', i.unit,
              'status', i.status
            ) order by i.full_name, i.sort_order)
          ) as obj
        from items i
        group by i.process_id, i.process_name
      ) g
    ), '[]'::jsonb),
    'issues', coalesce((
      select jsonb_agg(jsonb_build_object('author_name', a.full_name, 'text', a.notes) order by a.full_name)
      from approved a where nullif(btrim(a.notes), '') is not null
    ), '[]'::jsonb),
    'support_requests', coalesce((
      select jsonb_agg(jsonb_build_object('author_name', a.full_name, 'text', a.support_request) order by a.full_name)
      from approved a where nullif(btrim(a.support_request), '') is not null
    ), '[]'::jsonb),
    'next_day_plans', coalesce((
      select jsonb_agg(jsonb_build_object('author_name', a.full_name, 'text', a.next_day_plan) order by a.full_name)
      from approved a where nullif(btrim(a.next_day_plan), '') is not null
    ), '[]'::jsonb)
  )
$$;

-- 확정되지 않은 통합 작업일보를 최신 승인 내용으로 다시 취합한다.
create or replace function public.dw_refresh_consolidated_report(p_project uuid, p_date date)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into dw_consolidated_reports (project_id, report_date, snapshot, generated_at)
  values (p_project, p_date, public.dw_build_consolidated_snapshot(p_project, p_date), now())
  on conflict (project_id, report_date) do update
    set snapshot = excluded.snapshot, generated_at = now()
    where not dw_consolidated_reports.is_finalized;
end $$;

-- 관리자: 날씨·종합 의견 저장 및 확정/확정 해제
create or replace function public.dw_save_consolidated_report(
  p_project uuid, p_date date, p_weather text, p_summary text, p_finalize boolean
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.dw_is_project_manager(p_project) then
    raise exception '통합 작업일보는 관리자만 저장할 수 있습니다.' using errcode = '42501';
  end if;
  -- 확정 해제 후 재취합할 수 있도록 먼저 확정 상태를 푼다
  update dw_consolidated_reports
    set is_finalized = false, finalized_by = null, finalized_at = null
    where project_id = p_project and report_date = p_date and is_finalized and not p_finalize;
  perform public.dw_refresh_consolidated_report(p_project, p_date);
  update dw_consolidated_reports
    set weather = nullif(btrim(p_weather), ''),
        summary = nullif(btrim(p_summary), ''),
        is_finalized = p_finalize,
        finalized_by = case when p_finalize then auth.uid() end,
        finalized_at = case when p_finalize then now() end
    where project_id = p_project and report_date = p_date
    returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 작업일보 제출 / 검토 / 수정 요청
-- ---------------------------------------------------------------------------
create or replace function public.dw_submit_report(p_report uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  r dw_daily_reports;
  v_name text;
begin
  select * into r from dw_daily_reports where id = p_report for update;
  if r.id is null or r.author_id <> auth.uid() or not public.dw_is_project_member(r.project_id) then
    raise exception '본인의 작업일보만 제출할 수 있습니다.' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'revision_requested') then
    raise exception '이미 제출된 작업일보입니다.' using errcode = 'P0001';
  end if;
  if r.work_date > public.dw_kst_today() then
    raise exception '미래 날짜의 작업일보는 제출할 수 없습니다.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from dw_report_items where report_id = r.id) then
    raise exception '작업내역을 1건 이상 입력해야 제출할 수 있습니다.' using errcode = 'P0001';
  end if;

  perform set_config('app.status_change', 'on', true);
  update dw_daily_reports
    set status = 'submitted', submitted_at = now(), approved_at = null, approved_by = null
    where id = r.id;
  perform set_config('app.status_change', '', true);

  insert into dw_report_reviews (report_id, project_id, actor_id, action)
  values (r.id, r.project_id, auth.uid(),
          case when r.status = 'revision_requested' then 'resubmitted' else 'submitted' end);

  select full_name into v_name from dw_profiles where id = r.author_id;
  perform public.dw_notify_managers(
    r.project_id, 'report_submitted', '작업일보가 제출되었습니다',
    v_name || ' · ' || to_char(r.work_date, 'YYYY-MM-DD'), '/reports/' || r.id
  );
end $$;

-- p_decision: 'approved' | 'revision_requested'
create or replace function public.dw_review_report(p_report uuid, p_decision text, p_comment text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r dw_daily_reports;
  it dw_report_items;
  v_new_progress numeric;
begin
  select * into r from dw_daily_reports where id = p_report for update;
  if r.id is null or not public.dw_is_project_manager(r.project_id) then
    raise exception '작업일보를 검토할 권한이 없습니다.' using errcode = '42501';
  end if;
  if r.author_id = auth.uid() then
    raise exception '본인이 작성한 작업일보는 직접 검토할 수 없습니다.' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'revision_requested') then
    raise exception '잘못된 검토 결과입니다.' using errcode = 'P0001';
  end if;
  if r.status <> 'submitted' then
    raise exception '제출 상태의 작업일보만 검토할 수 있습니다.' using errcode = 'P0001';
  end if;
  if p_decision = 'revision_requested' and nullif(btrim(coalesce(p_comment, '')), '') is null then
    raise exception '보완 요청 사유를 입력해 주세요.' using errcode = 'P0001';
  end if;

  perform set_config('app.status_change', 'on', true);
  if p_decision = 'approved' then
    update dw_daily_reports set status = 'approved', approved_at = now(), approved_by = auth.uid()
      where id = r.id;
  else
    update dw_daily_reports set status = 'revision_requested', approved_at = null, approved_by = null
      where id = r.id;
  end if;
  perform set_config('app.status_change', '', true);

  insert into dw_report_reviews (report_id, project_id, actor_id, action, comment)
  values (r.id, r.project_id, auth.uid(), p_decision, nullif(btrim(coalesce(p_comment, '')), ''));

  if p_decision = 'approved' then
    -- 승인된 작업내역을 업무·공정 실적에 반영한다
    perform set_config('app.progress_log_date', r.work_date::text, true);
    perform set_config('app.progress_report_id', r.id::text, true);
    for it in select * from dw_report_items where report_id = r.id order by sort_order, created_at loop
      if it.task_id is not null then
        update dw_tasks set
          progress = case
            when it.status = 'completed' then 100
            else coalesce(it.task_progress, progress) end,
          status = case
            when it.status = 'completed' or it.task_progress = 100 then 'done'
            when it.status = 'on_hold' then 'on_hold'
            else 'in_progress' end
        where id = it.task_id;
      end if;
      if it.process_id is not null then
        -- 이후 작업일의 실적이 이미 반영되어 있으면 실적률은 덮어쓰지 않는다
        v_new_progress := case
          when it.process_progress is not null and not exists (
            select 1 from dw_process_progress_logs l
            where l.process_id = it.process_id and l.log_date > r.work_date
          ) then it.process_progress
        end;
        update dw_processes set
          actual_start = least(coalesce(actual_start, r.work_date), r.work_date),
          progress = coalesce(v_new_progress, progress),
          actual_end = case
            when coalesce(v_new_progress, progress) >= 100 then coalesce(actual_end, r.work_date)
            else null end
        where id = it.process_id;
      end if;
    end loop;
    perform set_config('app.progress_log_date', '', true);
    perform set_config('app.progress_report_id', '', true);
    perform public.dw_refresh_consolidated_report(r.project_id, r.work_date);
    perform public.dw_notify(
      r.author_id, r.project_id, 'report_approved', '작업일보가 승인되었습니다',
      to_char(r.work_date, 'YYYY-MM-DD') || ' 작업일보', '/reports/' || r.id
    );
  else
    perform public.dw_notify(
      r.author_id, r.project_id, 'report_revision_requested', '작업일보 보완 요청',
      to_char(r.work_date, 'YYYY-MM-DD') || ' · ' || btrim(p_comment), '/reports/' || r.id
    );
  end if;
end $$;

-- 승인 완료된 작업일보의 수정 요청
create or replace function public.dw_request_report_change(p_report uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  r dw_daily_reports;
  v_id uuid;
  v_name text;
begin
  select * into r from dw_daily_reports where id = p_report for update;
  if r.id is null or r.author_id <> auth.uid() or not public.dw_is_project_member(r.project_id) then
    raise exception '본인의 작업일보만 수정 요청할 수 있습니다.' using errcode = '42501';
  end if;
  if r.status <> 'approved' then
    raise exception '승인 완료된 작업일보만 수정 요청할 수 있습니다.' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception '수정 요청 사유를 입력해 주세요.' using errcode = 'P0001';
  end if;
  if exists (select 1 from dw_change_requests where report_id = r.id and status = 'pending') then
    raise exception '이미 처리 대기 중인 수정 요청이 있습니다.' using errcode = 'P0001';
  end if;

  insert into dw_change_requests (report_id, project_id, requester_id, reason)
  values (r.id, r.project_id, auth.uid(), btrim(p_reason))
  returning id into v_id;
  insert into dw_report_reviews (report_id, project_id, actor_id, action, comment)
  values (r.id, r.project_id, auth.uid(), 'change_requested', btrim(p_reason));

  select full_name into v_name from dw_profiles where id = r.author_id;
  perform public.dw_notify_managers(
    r.project_id, 'change_requested', '승인된 작업일보 수정 요청',
    v_name || ' · ' || to_char(r.work_date, 'YYYY-MM-DD'), '/reports/' || r.id
  );
  return v_id;
end $$;

create or replace function public.dw_review_change_request(
  p_request uuid, p_approve boolean, p_comment text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  c dw_change_requests;
  r dw_daily_reports;
begin
  select * into c from dw_change_requests where id = p_request for update;
  if c.id is null or not public.dw_is_project_manager(c.project_id) then
    raise exception '수정 요청을 처리할 권한이 없습니다.' using errcode = '42501';
  end if;
  if c.requester_id = auth.uid() then
    raise exception '본인의 수정 요청은 직접 처리할 수 없습니다.' using errcode = '42501';
  end if;
  if c.status <> 'pending' then
    raise exception '이미 처리된 수정 요청입니다.' using errcode = 'P0001';
  end if;
  select * into r from dw_daily_reports where id = c.report_id for update;

  update dw_change_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        reviewer_id = auth.uid(),
        review_comment = nullif(btrim(coalesce(p_comment, '')), ''),
        reviewed_at = now()
    where id = c.id;
  insert into dw_report_reviews (report_id, project_id, actor_id, action, comment)
  values (c.report_id, c.project_id, auth.uid(),
          case when p_approve then 'change_approved' else 'change_rejected' end,
          nullif(btrim(coalesce(p_comment, '')), ''));

  if p_approve then
    perform set_config('app.status_change', 'on', true);
    update dw_daily_reports set status = 'revision_requested', approved_at = null, approved_by = null
      where id = c.report_id;
    perform set_config('app.status_change', '', true);
    -- 승인이 풀린 작업일보는 재승인 전까지 통합 작업일보에서 빠진다
    perform public.dw_refresh_consolidated_report(r.project_id, r.work_date);
  end if;

  perform public.dw_notify(
    c.requester_id, c.project_id,
    case when p_approve then 'change_approved' else 'change_rejected' end,
    case when p_approve then '수정 요청이 승인되었습니다' else '수정 요청이 반려되었습니다' end,
    to_char(r.work_date, 'YYYY-MM-DD') || ' 작업일보', '/reports/' || c.report_id
  );
end $$;

-- 작업일보와 작업내역을 한 번에(한 트랜잭션으로) 저장한다.
-- 호출자 권한으로 실행되므로 RLS 와 보호 트리거가 그대로 적용된다.
-- p_data: { work_date, start_time, end_time, break_minutes, notes, support_request, next_day_plan,
--           items: [{ id?, process_id, task_id, content, result, quantity, unit, status, task_progress, process_progress }] }
create or replace function public.dw_save_report(p_project uuid, p_report uuid, p_data jsonb) returns uuid
language plpgsql set search_path = public
as $$
declare
  v_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_index integer := 0;
  v_keep uuid[] := '{}';
begin
  if p_report is null then
    insert into dw_daily_reports (
      project_id, author_id, work_date, start_time, end_time, break_minutes, notes, support_request, next_day_plan
    ) values (
      p_project, auth.uid(),
      (p_data ->> 'work_date')::date, (p_data ->> 'start_time')::time, (p_data ->> 'end_time')::time,
      (p_data ->> 'break_minutes')::integer,
      nullif(btrim(p_data ->> 'notes'), ''), nullif(btrim(p_data ->> 'support_request'), ''),
      nullif(btrim(p_data ->> 'next_day_plan'), '')
    ) returning id into v_id;
  else
    update dw_daily_reports set
      work_date = (p_data ->> 'work_date')::date,
      start_time = (p_data ->> 'start_time')::time,
      end_time = (p_data ->> 'end_time')::time,
      break_minutes = (p_data ->> 'break_minutes')::integer,
      notes = nullif(btrim(p_data ->> 'notes'), ''),
      support_request = nullif(btrim(p_data ->> 'support_request'), ''),
      next_day_plan = nullif(btrim(p_data ->> 'next_day_plan'), '')
    where id = p_report and author_id = auth.uid()
    returning id into v_id;
    if v_id is null then
      raise exception '수정할 수 없는 작업일보입니다. 이미 제출되었거나 권한이 없습니다.' using errcode = '42501';
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_data -> 'items', '[]'::jsonb)) loop
    if nullif(v_item ->> 'id', '') is not null then
      update dw_report_items set
        process_id = nullif(v_item ->> 'process_id', '')::uuid,
        task_id = nullif(v_item ->> 'task_id', '')::uuid,
        sort_order = v_index,
        content = v_item ->> 'content',
        result = nullif(btrim(v_item ->> 'result'), ''),
        quantity = nullif(v_item ->> 'quantity', '')::numeric,
        unit = nullif(btrim(v_item ->> 'unit'), ''),
        status = v_item ->> 'status',
        task_progress = nullif(v_item ->> 'task_progress', '')::integer,
        process_progress = nullif(v_item ->> 'process_progress', '')::numeric
      where id = (v_item ->> 'id')::uuid and report_id = v_id
      returning id into v_item_id;
      if v_item_id is null then
        raise exception '작업내역을 찾을 수 없습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.' using errcode = 'P0001';
      end if;
    else
      insert into dw_report_items (
        report_id, project_id, process_id, task_id, sort_order, content, result, quantity, unit,
        status, task_progress, process_progress
      ) values (
        v_id, p_project,
        nullif(v_item ->> 'process_id', '')::uuid, nullif(v_item ->> 'task_id', '')::uuid, v_index,
        v_item ->> 'content', nullif(btrim(v_item ->> 'result'), ''),
        nullif(v_item ->> 'quantity', '')::numeric, nullif(btrim(v_item ->> 'unit'), ''),
        v_item ->> 'status',
        nullif(v_item ->> 'task_progress', '')::integer, nullif(v_item ->> 'process_progress', '')::numeric
      ) returning id into v_item_id;
    end if;
    v_keep := v_keep || v_item_id;
    v_index := v_index + 1;
  end loop;

  delete from dw_report_items where report_id = v_id and not (id = any (v_keep));
  return v_id;
end $$;

-- 담당자가 본인 업무의 진행상태를 갱신한다
create or replace function public.dw_update_my_task(p_task uuid, p_status text, p_progress integer)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  t dw_tasks;
begin
  select * into t from dw_tasks where id = p_task for update;
  if t.id is null or t.assignee_id <> auth.uid() or not public.dw_is_project_member(t.project_id) then
    raise exception '본인에게 배정된 업무만 변경할 수 있습니다.' using errcode = '42501';
  end if;
  update dw_tasks set status = p_status, progress = p_progress where id = p_task;
end $$;

-- ---------------------------------------------------------------------------
-- 작업일보 제출 현황 (해당 일자, 현장관리자·현장팀 기준)
-- ---------------------------------------------------------------------------
create or replace function public.dw_submission_status(p_project uuid, p_date date)
returns table (
  user_id uuid, full_name text, company text, role text, report_id uuid, status text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.dw_is_internal_member(p_project) then
    raise exception '제출 현황을 조회할 권한이 없습니다.' using errcode = '42501';
  end if;
  return query
    select pm.user_id, p.full_name, p.company, pm.role, r.id, r.status
    from dw_project_members pm
    join dw_profiles p on p.id = pm.user_id and p.is_active
    left join dw_daily_reports r
      on r.project_id = pm.project_id and r.author_id = pm.user_id and r.work_date = p_date
    where pm.project_id = p_project and pm.role in ('site_manager', 'site_worker')
    order by p.full_name;
end $$;


-- ---------------------------------------------------------------------------
-- 초대 · 수락 (이식본 신규 — 원본의 "관리자가 계정을 직접 생성"을 대신한다)
-- 계정의 이메일은 dw_profiles.email 이 아니라 auth.users.email 을 기준으로 찾는다
-- (shrimp365 에서 이메일을 바꾼 계정이 옛 주소로 온 초대에 잘못 연결되지 않게).
-- ---------------------------------------------------------------------------

-- 사업장 구성원 초대.
-- 권한: 회장/대표이사, 또는 해당 사업장 현장관리자(현장관리자 지정은 회장/대표이사만).
-- 반환: 'added'   — 이미 현장관리 구성원인 계정이라 사업장에 바로 추가(이미 소속이면 역할 갱신)
--       'invited' — 초대 등록(같은 이메일·사업장 초대가 있으면 갱신). 본인이 로그인해 수락한다.
create or replace function public.dw_invite_member(
  p_project uuid, p_email text, p_role text,
  p_full_name text default null, p_phone text default null,
  p_company text default null, p_position text default null
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_exec boolean := public.dw_is_executive();
  v_target dw_profiles;
  v_existing_role text;
begin
  if p_project is null or not (v_exec or public.dw_is_project_manager(p_project)) then
    raise exception '구성원을 초대할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('site_manager', 'site_worker', 'partner') then
    raise exception '잘못된 역할입니다.' using errcode = 'P0001';
  end if;
  if p_role = 'site_manager' and not v_exec then
    raise exception '현장관리자 지정은 회장·대표이사만 할 수 있습니다.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception '이메일 형식이 올바르지 않습니다.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from dw_projects where id = p_project) then
    raise exception '사업장을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;

  select p.* into v_target
  from dw_profiles p
  join auth.users u on u.id = p.id
  where lower(u.email) = v_email;

  if v_target.id is not null then
    if not v_target.is_active then
      raise exception '사용이 중지된 계정입니다.' using errcode = 'P0001';
    end if;
    if v_target.global_role is not null then
      raise exception '회장·대표이사는 사업장에 추가할 필요가 없습니다.' using errcode = 'P0001';
    end if;
    select role into v_existing_role
    from dw_project_members where project_id = p_project and user_id = v_target.id;
    -- 원본 project_members RLS 와 같은 제한: 현장관리자 행은 회장/대표이사만 바꾼다
    if v_existing_role = 'site_manager' and not v_exec then
      raise exception '현장관리자의 역할은 회장·대표이사만 변경할 수 있습니다.' using errcode = '42501';
    end if;
    insert into dw_project_members (project_id, user_id, role)
    values (p_project, v_target.id, p_role)
    on conflict (project_id, user_id) do update set role = excluded.role;
    delete from dw_invites where lower(email) = v_email and project_id = p_project;
    return 'added';
  end if;

  if not v_exec and exists (
    select 1 from dw_invites
    where lower(email) = v_email and project_id = p_project and role = 'site_manager'
  ) then
    raise exception '현장관리자의 역할은 회장·대표이사만 변경할 수 있습니다.' using errcode = '42501';
  end if;
  insert into dw_invites (email, full_name, phone, company, position, project_id, role, invited_by)
  values (
    v_email, nullif(btrim(p_full_name), ''), nullif(btrim(p_phone), ''),
    nullif(btrim(p_company), ''), nullif(btrim(p_position), ''), p_project, p_role, auth.uid()
  )
  on conflict (lower(email), project_id) where project_id is not null do update
    set role = excluded.role,
        full_name = coalesce(excluded.full_name, dw_invites.full_name),
        phone = coalesce(excluded.phone, dw_invites.phone),
        company = coalesce(excluded.company, dw_invites.company),
        position = coalesce(excluded.position, dw_invites.position),
        invited_by = excluded.invited_by;
  return 'invited';
end $$;

-- 전사 역할(회장·대표이사) 초대. 회장/대표이사만 할 수 있다.
-- 반환: 'added' — 이미 구성원인 계정의 전사 역할을 갱신 / 'invited' — 초대 등록(있으면 갱신)
create or replace function public.dw_invite_executive(
  p_email text, p_global_role text, p_full_name text default null
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_target uuid;
begin
  if not public.dw_is_executive() then
    raise exception '전사 역할은 회장·대표이사만 지정할 수 있습니다.' using errcode = '42501';
  end if;
  if p_global_role is null or p_global_role not in ('chairman', 'ceo') then
    raise exception '잘못된 역할입니다.' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception '이메일 형식이 올바르지 않습니다.' using errcode = 'P0001';
  end if;

  select p.id into v_target
  from dw_profiles p
  join auth.users u on u.id = p.id
  where lower(u.email) = v_email;

  if v_target is not null then
    if v_target = auth.uid() then
      raise exception '본인의 전사 역할은 변경할 수 없습니다.' using errcode = '42501';
    end if;
    update dw_profiles set global_role = p_global_role where id = v_target;
    delete from dw_invites where lower(email) = v_email and project_id is null;
    return 'added';
  end if;

  insert into dw_invites (email, full_name, global_role, invited_by)
  values (v_email, nullif(btrim(p_full_name), ''), p_global_role, auth.uid())
  on conflict (lower(email)) where project_id is null do update
    set global_role = excluded.global_role,
        full_name = coalesce(excluded.full_name, dw_invites.full_name),
        invited_by = excluded.invited_by;
  return 'invited';
end $$;

-- 로그인한 사용자가 자기 이메일 앞으로 온 초대를 모두 수락한다. 수락 건수를 돌려준다.
-- 이메일 인증(auth.users.email_confirmed_at)이 끝난 계정만 수락할 수 있다 —
-- 인증하지 않은 주소로 가입해 남의 초대를 가로채는 것을 막는다.
-- 프로필이 이미 있는 사용자가 불러도 안전하다(추가 초대만 수락).
create or replace function public.dw_accept_invites() returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_raw_email text;
  v_email text;
  v_confirmed timestamptz;
  v_invites dw_invites[];
  v_global text;
begin
  if v_uid is null then
    return 0;
  end if;
  select u.email, u.email_confirmed_at into v_raw_email, v_confirmed
  from auth.users u where u.id = v_uid;
  v_email := lower(btrim(coalesce(v_raw_email, '')));
  if v_email = '' or v_confirmed is null then
    return 0;
  end if;

  -- 수락할 초대를 꺼내면서 지운다(동시에 두 번 불려도 한 번만 처리된다)
  with taken as (
    delete from dw_invites where lower(email) = v_email returning *
  )
  select array_agg(t order by t.created_at, t.id) into v_invites from taken t;
  if v_invites is null then
    return 0;
  end if;

  select i.global_role into v_global
  from unnest(v_invites) i where i.global_role is not null limit 1;

  insert into dw_profiles (id, email, full_name, phone, company, position, global_role)
  values (
    v_uid, v_email,
    coalesce(
      (select nullif(btrim(i.full_name), '') from unnest(v_invites) i
       where nullif(btrim(i.full_name), '') is not null limit 1),
      split_part(v_email, '@', 1)
    ),
    (select i.phone from unnest(v_invites) i where i.phone is not null limit 1),
    (select i.company from unnest(v_invites) i where i.company is not null limit 1),
    (select i.position from unnest(v_invites) i where i.position is not null limit 1),
    v_global
  )
  on conflict (id) do nothing;

  -- 이미 프로필이 있던 사용자가 전사 역할 초대를 받은 경우
  if v_global is not null then
    update dw_profiles set global_role = v_global
    where id = v_uid and global_role is distinct from v_global;
  end if;

  insert into dw_project_members (project_id, user_id, role)
  select i.project_id, v_uid, i.role
  from unnest(v_invites) i
  where i.project_id is not null
  on conflict (project_id, user_id) do nothing;

  return array_length(v_invites, 1);
end $$;

-- 최초 관리자 지정용. SQL Editor(postgres) 또는 service_role 만 실행할 수 있다
-- (아래 권한 절에서 authenticated/anon 실행 권한을 주지 않는다).
-- 해당 이메일로 가입해 이메일 인증을 마친 계정이 있으면 프로필을 만들고 전사 역할을 준다('added').
-- 계정이 없거나 아직 인증 전이면 전사 역할 초대를 등록한다('invited') — 인증 후 수락된다.
create or replace function public.dw_bootstrap_executive(
  p_email text, p_global_role text, p_full_name text default null
) returns text
language plpgsql set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user uuid;
begin
  if auth.uid() is not null then
    raise exception '이 함수는 SQL Editor 에서만 실행할 수 있습니다.' using errcode = '42501';
  end if;
  if p_global_role is null or p_global_role not in ('chairman', 'ceo') then
    raise exception '잘못된 역할입니다. chairman 또는 ceo 를 지정해 주세요.' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception '이메일 형식이 올바르지 않습니다.' using errcode = 'P0001';
  end if;

  select u.id into v_user
  from auth.users u
  where lower(u.email) = v_email and u.email_confirmed_at is not null;

  if v_user is not null then
    insert into dw_profiles (id, email, full_name, global_role)
    values (
      v_user, v_email,
      coalesce(nullif(btrim(p_full_name), ''), split_part(v_email, '@', 1)),
      p_global_role
    )
    on conflict (id) do update set global_role = excluded.global_role, is_active = true;
    delete from dw_invites where lower(email) = v_email and project_id is null;
    return 'added';
  end if;

  insert into dw_invites (email, full_name, global_role)
  values (v_email, nullif(btrim(p_full_name), ''), p_global_role)
  on conflict (lower(email)) where project_id is null do update
    set global_role = excluded.global_role,
        full_name = coalesce(excluded.full_name, dw_invites.full_name);
  return 'invited';
end $$;

-- 대상이 p_project 가 아닌 다른 사업장에서 현장관리자인지 답한다.
-- (원본 화면의 canManage 가 service_role 로 하던 조회 — 현장관리자가 다른 사업장의
--  현장관리자 계정을 건드리지 못하게 하는 확인이다.)
-- 호출자가 p_project 의 관리자(회장/대표이사/현장관리자)가 아니면 예외.
-- 현장관리자는 자기 사업장 구성원에 대해서만 물을 수 있다(그 밖의 계정은 예외).
create or replace function public.dw_is_site_manager_elsewhere(p_user uuid, p_project uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  if p_user is null or p_project is null or not public.dw_is_project_manager(p_project) then
    raise exception '이 작업을 수행할 권한이 없습니다.' using errcode = '42501';
  end if;
  if not public.dw_is_executive() and not exists (
    select 1 from dw_project_members where project_id = p_project and user_id = p_user
  ) then
    raise exception '이 작업을 수행할 권한이 없습니다.' using errcode = '42501';
  end if;
  return exists (
    select 1 from dw_project_members
    where user_id = p_user and role = 'site_manager' and project_id <> p_project
  );
end $$;

-- ===========================================================================
-- 3. 행 수준 보안(RLS): 사업장별 권한을 데이터베이스에서 검증한다.
-- ===========================================================================

alter table public.dw_profiles enable row level security;
alter table public.dw_projects enable row level security;
alter table public.dw_project_members enable row level security;
alter table public.dw_processes enable row level security;
alter table public.dw_process_progress_logs enable row level security;
alter table public.dw_tasks enable row level security;
alter table public.dw_schedule_events enable row level security;
alter table public.dw_daily_reports enable row level security;
alter table public.dw_report_items enable row level security;
alter table public.dw_report_photos enable row level security;
alter table public.dw_report_reviews enable row level security;
alter table public.dw_change_requests enable row level security;
alter table public.dw_consolidated_reports enable row level security;
alter table public.dw_notifications enable row level security;
alter table public.dw_audit_logs enable row level security;
alter table public.dw_invites enable row level security;

-- (테이블 권한은 파일 끝 '권한' 절에서 dw_ 테이블마다 건다.)

-- profiles ------------------------------------------------------------------
drop policy if exists dw_profiles_select on public.dw_profiles;
create policy dw_profiles_select on public.dw_profiles for select to authenticated
  using (id = auth.uid() or public.dw_is_executive() or public.dw_shares_project_with(id));
drop policy if exists dw_profiles_update on public.dw_profiles;
create policy dw_profiles_update on public.dw_profiles for update to authenticated
  using (id = auth.uid() or public.dw_is_executive())
  with check (id = auth.uid() or public.dw_is_executive());

-- projects ------------------------------------------------------------------
drop policy if exists dw_projects_select on public.dw_projects;
create policy dw_projects_select on public.dw_projects for select to authenticated
  using (public.dw_is_project_member(id));
drop policy if exists dw_projects_insert on public.dw_projects;
create policy dw_projects_insert on public.dw_projects for insert to authenticated
  with check (public.dw_is_executive());
drop policy if exists dw_projects_update on public.dw_projects;
create policy dw_projects_update on public.dw_projects for update to authenticated
  using (public.dw_is_executive()) with check (public.dw_is_executive());
drop policy if exists dw_projects_delete on public.dw_projects;
create policy dw_projects_delete on public.dw_projects for delete to authenticated
  using (public.dw_is_executive());

-- project_members -----------------------------------------------------------
-- 현장관리자는 현장팀·협력업체만 관리할 수 있고, 현장관리자 지정은 회장/대표이사만 한다.
drop policy if exists dw_project_members_select on public.dw_project_members;
create policy dw_project_members_select on public.dw_project_members for select to authenticated
  using (user_id = auth.uid() or public.dw_is_internal_member(project_id));
drop policy if exists dw_project_members_insert on public.dw_project_members;
create policy dw_project_members_insert on public.dw_project_members for insert to authenticated
  with check (
    public.dw_is_executive()
    or (public.dw_is_project_manager(project_id) and role <> 'site_manager')
  );
drop policy if exists dw_project_members_update on public.dw_project_members;
create policy dw_project_members_update on public.dw_project_members for update to authenticated
  using (
    public.dw_is_executive()
    or (public.dw_is_project_manager(project_id) and role <> 'site_manager')
  )
  with check (
    public.dw_is_executive()
    or (public.dw_is_project_manager(project_id) and role <> 'site_manager')
  );
drop policy if exists dw_project_members_delete on public.dw_project_members;
create policy dw_project_members_delete on public.dw_project_members for delete to authenticated
  using (
    public.dw_is_executive()
    or (public.dw_is_project_manager(project_id) and role <> 'site_manager')
  );

-- processes -----------------------------------------------------------------
drop policy if exists dw_processes_select on public.dw_processes;
create policy dw_processes_select on public.dw_processes for select to authenticated
  using (public.dw_is_project_member(project_id));
drop policy if exists dw_processes_insert on public.dw_processes;
create policy dw_processes_insert on public.dw_processes for insert to authenticated
  with check (public.dw_is_project_manager(project_id));
drop policy if exists dw_processes_update on public.dw_processes;
create policy dw_processes_update on public.dw_processes for update to authenticated
  using (public.dw_is_project_manager(project_id))
  with check (public.dw_is_project_manager(project_id));
drop policy if exists dw_processes_delete on public.dw_processes;
create policy dw_processes_delete on public.dw_processes for delete to authenticated
  using (public.dw_is_project_manager(project_id));

drop policy if exists dw_process_progress_logs_select on public.dw_process_progress_logs;
create policy dw_process_progress_logs_select on public.dw_process_progress_logs for select to authenticated
  using (public.dw_is_internal_member(project_id));

-- tasks: 협력업체는 본인에게 배정된 업무만 본다 ---------------------------------
drop policy if exists dw_tasks_select on public.dw_tasks;
create policy dw_tasks_select on public.dw_tasks for select to authenticated
  using (
    public.dw_is_internal_member(project_id)
    or (assignee_id = auth.uid() and public.dw_is_project_member(project_id))
  );
drop policy if exists dw_tasks_insert on public.dw_tasks;
create policy dw_tasks_insert on public.dw_tasks for insert to authenticated
  with check (public.dw_is_project_manager(project_id));
drop policy if exists dw_tasks_update on public.dw_tasks;
create policy dw_tasks_update on public.dw_tasks for update to authenticated
  using (public.dw_is_project_manager(project_id))
  with check (public.dw_is_project_manager(project_id));
drop policy if exists dw_tasks_delete on public.dw_tasks;
create policy dw_tasks_delete on public.dw_tasks for delete to authenticated
  using (public.dw_is_project_manager(project_id));

-- schedule_events -----------------------------------------------------------
-- 전체 일정(owner_id null)은 내부 구성원이 조회, 개인 일정은 본인과 관리자만 조회
drop policy if exists dw_schedule_events_select on public.dw_schedule_events;
create policy dw_schedule_events_select on public.dw_schedule_events for select to authenticated
  using (
    (owner_id is null and public.dw_is_internal_member(project_id))
    or (owner_id = auth.uid() and public.dw_is_project_member(project_id))
    or public.dw_is_project_manager(project_id)
  );
drop policy if exists dw_schedule_events_insert on public.dw_schedule_events;
create policy dw_schedule_events_insert on public.dw_schedule_events for insert to authenticated
  with check (
    public.dw_is_project_manager(project_id)
    or (owner_id = auth.uid() and public.dw_is_project_member(project_id))
  );
drop policy if exists dw_schedule_events_update on public.dw_schedule_events;
create policy dw_schedule_events_update on public.dw_schedule_events for update to authenticated
  using (
    public.dw_is_project_manager(project_id)
    or (owner_id = auth.uid() and public.dw_is_project_member(project_id))
  )
  with check (
    public.dw_is_project_manager(project_id)
    or (owner_id = auth.uid() and public.dw_is_project_member(project_id))
  );
drop policy if exists dw_schedule_events_delete on public.dw_schedule_events;
create policy dw_schedule_events_delete on public.dw_schedule_events for delete to authenticated
  using (
    public.dw_is_project_manager(project_id)
    or (owner_id = auth.uid() and public.dw_is_project_member(project_id))
  );

-- daily_reports -------------------------------------------------------------
-- 조회: 본인, 관리자, 그리고 내부 구성원은 승인된 일보
-- 작성/수정: 본인이 작성중·보완 요청 상태일 때만. 상태 변경은 함수로만 가능(트리거로 차단).
drop policy if exists dw_daily_reports_select on public.dw_daily_reports;
create policy dw_daily_reports_select on public.dw_daily_reports for select to authenticated
  using (
    (author_id = auth.uid() and public.dw_is_project_member(project_id))
    or public.dw_is_project_manager(project_id)
    or (status = 'approved' and public.dw_is_internal_member(project_id))
  );
drop policy if exists dw_daily_reports_insert on public.dw_daily_reports;
create policy dw_daily_reports_insert on public.dw_daily_reports for insert to authenticated
  with check (author_id = auth.uid() and public.dw_is_project_member(project_id));
drop policy if exists dw_daily_reports_update on public.dw_daily_reports;
create policy dw_daily_reports_update on public.dw_daily_reports for update to authenticated
  using (
    author_id = auth.uid() and public.dw_is_project_member(project_id)
    and status in ('draft', 'revision_requested')
  )
  with check (author_id = auth.uid() and public.dw_is_project_member(project_id));
drop policy if exists dw_daily_reports_delete on public.dw_daily_reports;
create policy dw_daily_reports_delete on public.dw_daily_reports for delete to authenticated
  using (author_id = auth.uid() and public.dw_is_project_member(project_id) and status = 'draft');

-- 작성자가 수정 가능한 상태의 작업일보인지 확인
create or replace function public.dw_can_edit_report(p_report uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from dw_daily_reports r
    where r.id = p_report and r.author_id = auth.uid()
      and r.status in ('draft', 'revision_requested')
      and public.dw_is_project_member(r.project_id)
  )
$$;

-- report_items / report_photos: 조회는 작업일보 조회 권한을 따른다 ----------------
drop policy if exists dw_report_items_select on public.dw_report_items;
create policy dw_report_items_select on public.dw_report_items for select to authenticated
  using (exists (select 1 from public.dw_daily_reports r where r.id = report_id));
drop policy if exists dw_report_items_insert on public.dw_report_items;
create policy dw_report_items_insert on public.dw_report_items for insert to authenticated
  with check (public.dw_can_edit_report(report_id));
drop policy if exists dw_report_items_update on public.dw_report_items;
create policy dw_report_items_update on public.dw_report_items for update to authenticated
  using (public.dw_can_edit_report(report_id)) with check (public.dw_can_edit_report(report_id));
drop policy if exists dw_report_items_delete on public.dw_report_items;
create policy dw_report_items_delete on public.dw_report_items for delete to authenticated
  using (public.dw_can_edit_report(report_id));

drop policy if exists dw_report_photos_select on public.dw_report_photos;
create policy dw_report_photos_select on public.dw_report_photos for select to authenticated
  using (exists (select 1 from public.dw_daily_reports r where r.id = report_id));
drop policy if exists dw_report_photos_insert on public.dw_report_photos;
create policy dw_report_photos_insert on public.dw_report_photos for insert to authenticated
  with check (public.dw_can_edit_report(report_id));
drop policy if exists dw_report_photos_update on public.dw_report_photos;
create policy dw_report_photos_update on public.dw_report_photos for update to authenticated
  using (public.dw_can_edit_report(report_id)) with check (public.dw_can_edit_report(report_id));
drop policy if exists dw_report_photos_delete on public.dw_report_photos;
create policy dw_report_photos_delete on public.dw_report_photos for delete to authenticated
  using (public.dw_can_edit_report(report_id));

drop policy if exists dw_report_reviews_select on public.dw_report_reviews;
create policy dw_report_reviews_select on public.dw_report_reviews for select to authenticated
  using (exists (select 1 from public.dw_daily_reports r where r.id = report_id));

drop policy if exists dw_change_requests_select on public.dw_change_requests;
create policy dw_change_requests_select on public.dw_change_requests for select to authenticated
  using (
    (requester_id = auth.uid() and public.dw_is_project_member(project_id))
    or public.dw_is_project_manager(project_id)
  );

-- consolidated_reports ------------------------------------------------------
drop policy if exists dw_consolidated_reports_select on public.dw_consolidated_reports;
create policy dw_consolidated_reports_select on public.dw_consolidated_reports for select to authenticated
  using (public.dw_is_internal_member(project_id));

-- notifications -------------------------------------------------------------
drop policy if exists dw_notifications_select on public.dw_notifications;
create policy dw_notifications_select on public.dw_notifications for select to authenticated
  using (user_id = auth.uid());
drop policy if exists dw_notifications_update on public.dw_notifications;
create policy dw_notifications_update on public.dw_notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- audit_logs ----------------------------------------------------------------
drop policy if exists dw_audit_logs_select on public.dw_audit_logs;
create policy dw_audit_logs_select on public.dw_audit_logs for select to authenticated
  using (
    public.dw_is_executive()
    or (project_id is not null and public.dw_is_project_manager(project_id))
  );

-- invites (이식본 신규) -------------------------------------------------------
-- 조회·취소: 회장/대표이사, 또는 그 사업장의 관리자(현장관리자 초대는 회장/대표이사만 취소).
-- 등록·변경은 dw_invite_member / dw_invite_executive 로만 한다.
drop policy if exists dw_invites_select on public.dw_invites;
create policy dw_invites_select on public.dw_invites for select to authenticated
  using (
    public.dw_is_executive()
    or (project_id is not null and public.dw_is_project_manager(project_id))
  );
drop policy if exists dw_invites_delete on public.dw_invites;
create policy dw_invites_delete on public.dw_invites for delete to authenticated
  using (
    public.dw_is_executive()
    or (project_id is not null and public.dw_is_project_manager(project_id) and role <> 'site_manager')
  );

-- ===========================================================================
-- 4. 현장 사진 저장소 (비공개 버킷 dw-report-photos)
-- ===========================================================================
-- 경로 규칙: {project_id}/{report_id}/{파일명}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dw-report-photos', 'dw-report-photos', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 조회: 해당 작업일보를 볼 수 있는 사용자 (daily_reports RLS 적용)
drop policy if exists dw_report_photos_object_select on storage.objects;
create policy dw_report_photos_object_select on storage.objects for select to authenticated
  using (
    bucket_id = 'dw-report-photos'
    and exists (
      select 1 from public.dw_daily_reports r
      where r.id::text = (storage.foldername(name))[2]
        and r.project_id::text = (storage.foldername(name))[1]
    )
  );

-- 업로드/삭제: 작성중·보완 요청 상태인 본인 작업일보에만
drop policy if exists dw_report_photos_object_insert on storage.objects;
create policy dw_report_photos_object_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dw-report-photos'
    and exists (
      select 1 from public.dw_daily_reports r
      where r.id::text = (storage.foldername(name))[2]
        and r.project_id::text = (storage.foldername(name))[1]
        and public.dw_can_edit_report(r.id)
    )
  );

drop policy if exists dw_report_photos_object_delete on storage.objects;
create policy dw_report_photos_object_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'dw-report-photos'
    and exists (
      select 1 from public.dw_daily_reports r
      where r.id::text = (storage.foldername(name))[2]
        and r.project_id::text = (storage.foldername(name))[1]
        and public.dw_can_edit_report(r.id)
    )
  );

-- ===========================================================================
-- 5. 권한
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 권한 — `dw_` 객체 하나하나에만 건다(스키마 전체 grant/revoke 금지).
-- Supabase 는 public 스키마의 새 테이블·함수에 anon/authenticated 권한을 자동으로 주므로
-- 먼저 전부 걷어 낸 뒤 필요한 것만 준다.
-- ---------------------------------------------------------------------------

-- 테이블: 비로그인(anon)은 접근 불가, 로그인 사용자는 RLS 범위 안에서만 접근
do $$
declare
  t text;
begin
  foreach t in array array[
    'dw_profiles', 'dw_projects', 'dw_project_members', 'dw_processes', 'dw_process_progress_logs',
    'dw_tasks', 'dw_schedule_events', 'dw_daily_reports', 'dw_report_items', 'dw_report_photos',
    'dw_report_reviews', 'dw_change_requests', 'dw_consolidated_reports', 'dw_notifications',
    'dw_audit_logs', 'dw_invites'
  ] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

-- 이력·알림·검토 기록은 함수와 트리거로만 기록한다
revoke insert, update, delete on public.dw_audit_logs from authenticated;
revoke insert, update, delete on public.dw_report_reviews from authenticated;
revoke insert, update, delete on public.dw_change_requests from authenticated;
revoke insert, update, delete on public.dw_process_progress_logs from authenticated;
revoke insert, update, delete on public.dw_consolidated_reports from authenticated;
revoke insert, delete on public.dw_notifications from authenticated;
-- 프로필은 초대 수락 함수가 만든다
revoke insert, delete on public.dw_profiles from authenticated;
-- 초대 등록·변경은 초대 함수로만. 조회와 취소(delete)만 RLS 범위 안에서 직접 한다
revoke insert, update on public.dw_invites from authenticated;

-- 뷰(security_invoker — 조회자의 RLS 가 그대로 적용된다)
revoke all on table public.dw_process_status from public, anon, authenticated;
grant select on table public.dw_process_status to authenticated, service_role;

-- 변경 이력 번호 시퀀스: 기록은 dw_audit_row(security definer)가 하므로 사용자에게는 주지 않는다
revoke all on sequence public.dw_audit_logs_id_seq from public, anon, authenticated;
grant usage, select on sequence public.dw_audit_logs_id_seq to service_role;

-- 함수: 전부 걷어 낸 뒤, 로그인 사용자가 부르는 것만 authenticated 에 준다.
do $$
declare
  f text;
  -- 화면이 부르는 RPC, RLS 정책·뷰가 호출하는 권한/계산 함수
  v_callable text[] := array[
    'dw_kst_today()',
    'dw_is_executive()',
    'dw_project_role(uuid)',
    'dw_is_project_member(uuid)',
    'dw_is_project_manager(uuid)',
    'dw_is_internal_member(uuid)',
    'dw_shares_project_with(uuid)',
    'dw_can_edit_report(uuid)',
    'dw_planned_progress(date, date, date)',
    'dw_process_progress_at(uuid, date)',
    'dw_project_progress(uuid, date)',
    'dw_save_consolidated_report(uuid, date, text, text, boolean)',
    'dw_submit_report(uuid)',
    'dw_review_report(uuid, text, text)',
    'dw_request_report_change(uuid, text)',
    'dw_review_change_request(uuid, boolean, text)',
    'dw_save_report(uuid, uuid, jsonb)',
    'dw_update_my_task(uuid, text, integer)',
    'dw_submission_status(uuid, date)',
    'dw_invite_member(uuid, text, text, text, text, text, text)',
    'dw_invite_executive(text, text, text)',
    'dw_accept_invites()',
    'dw_is_site_manager_elsewhere(uuid, uuid)'
  ];
  -- 트리거 함수(실행 권한은 트리거를 만들 때만 확인된다)와 내부 전용 함수.
  -- dw_bootstrap_executive 는 SQL Editor(postgres)·service_role 전용이다.
  v_internal text[] := array[
    'dw_set_updated_at()',
    'dw_profiles_guard()',
    'dw_audit_row()',
    'dw_daily_reports_guard()',
    'dw_report_items_guard()',
    'dw_report_photos_guard()',
    'dw_tasks_before_write()',
    'dw_tasks_notify()',
    'dw_processes_log_progress()',
    'dw_notify(uuid, uuid, text, text, text, text)',
    'dw_notify_managers(uuid, text, text, text, text)',
    'dw_build_consolidated_snapshot(uuid, date)',
    'dw_refresh_consolidated_report(uuid, date)',
    'dw_bootstrap_executive(text, text, text)'
  ];
begin
  foreach f in array v_callable || v_internal loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array v_callable loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
