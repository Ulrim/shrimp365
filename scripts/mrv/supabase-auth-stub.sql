-- Supabase 의 auth 평면을 흉내 내는 최소 스텁 — 검증 전용(운영 DB 에 실행하지 말 것).
--
-- `supabase/migrations/mrv_platform.sql` 의 RLS 정책은 auth.uid() 와 auth.users 에 의존한다.
-- 그 둘은 Supabase 가 제공하므로 로컬 Postgres 에는 없다. 이 파일이 그 자리를 채워
-- scripts/mrv/verify-rls.sql 을 아무 Postgres 16 에서나 돌릴 수 있게 한다.
-- auth.uid() 는 `set request.jwt.claim.sub = '<uuid>'` 로 사용자를 흉내 낸다.

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then
    create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin; end if;
end $$;
grant usage on schema public to authenticated, service_role, anon;
grant usage on schema auth to authenticated, service_role, anon;
grant execute on function auth.uid() to authenticated, service_role, anon;
grant select on auth.users to authenticated, service_role;
