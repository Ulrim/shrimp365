-- 테스트 전용: Supabase 가 기본 제공하는 역할·스키마를 일반 PostgreSQL 에 흉내 낸다.
-- 운영/개발 Supabase 에는 적용하지 않는다.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase 는 public 스키마에 새로 만드는 테이블·함수·시퀀스에 anon/authenticated/service_role
-- 권한을 자동으로 준다. 마이그레이션이 dw_ 객체에서 이 권한을 제대로 걷어 내는지 검증하려고 흉내 낸다.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

-- 실제 auth.users 는 로그인 사용자가 읽을 수 없다(권한을 주지 않는다).
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant all on auth.users to service_role;

create function auth.uid() returns uuid
language sql stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
grant all on storage.objects to service_role;

create function storage.foldername(name text) returns text[]
language sql immutable
as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;

-- ---------------------------------------------------------------------------
-- shrimp365 에 이미 있는 객체를 흉내 낸 더미. 현장관리 마이그레이션이 dw_ 가 아닌
-- 기존 객체의 권한을 건드리지 않는지(스키마 전체 grant/revoke 가 없는지) 확인하는 데 쓴다.
-- 테이블 권한은 Supabase 기본값(위 default privileges)대로 anon/authenticated 에 열려 있다.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key,
  role text not null default 'member'
);
alter table public.profiles enable row level security;
grant select on public.profiles to anon, authenticated;
create policy profiles_read on public.profiles for select to anon, authenticated using (true);
insert into public.profiles (id, role) values ('00000000-0000-0000-0000-000000000001', 'admin');

create sequence public.legacy_seq;

create function public.legacy_public_fn() returns integer
language sql stable
as $$ select 42 $$;
