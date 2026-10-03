-- MRV 스키마 방어선 검증 — 테넌트 격리(Hard Rule 4)와 baseline 불변성(ADR 0002)이
-- 관례가 아니라 DB 수준에서 실제로 강제되는지 확인한다.
--
-- 실행(임시 Postgres + auth 스텁 위에서):
--   psql -d mrvtest -f supabase/migrations/mrv_platform.sql
--   psql -d mrvtest -f scripts/mrv/verify-rls.sql
--
-- 기대: 모든 줄이 PASS. 하나라도 FAIL 이면 격리가 뚫린 것이다.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

-- --- 픽스처: 서로 다른 두 조직 A/B, 각자 사용자 1명과 사이트 1개 ---
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'a@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'b@example.com')
on conflict do nothing;

insert into public.mrv_organizations (id, name, plan) values
  ('org-a', '조직 A', 'ENTERPRISE'), ('org-b', '조직 B', 'START')
on conflict do nothing;

insert into public.mrv_users (id, org_id, email, role, supabase_user_id) values
  ('u-a', 'org-a', 'a@example.com', 'owner', '00000000-0000-4000-8000-00000000000a'),
  ('u-b', 'org-b', 'b@example.com', 'owner', '00000000-0000-4000-8000-00000000000b')
on conflict do nothing;

insert into public.mrv_sites (id, org_id, name) values
  ('site-a', 'org-a', 'A 사이트'), ('site-b', 'org-b', 'B 사이트')
on conflict do nothing;

insert into public.mrv_kpi_snapshots
  (id, site_id, org_id, period_start, period_end, config_version)
values
  ('snap-a', 'site-a', 'org-a', now() - interval '30 day', now(), '2026.1.0'),
  ('snap-b', 'site-b', 'org-b', now() - interval '30 day', now(), '2026.1.0')
on conflict do nothing;

insert into public.mrv_baselines
  (id, site_id, org_id, period_start, period_end, ei_total, config_version, status, locked_by, locked_at)
values
  ('bl-a', 'site-a', 'org-a', now() - interval '30 day', now(), 4.87, '2026.1.0', 'locked', 'u-a', now())
on conflict do nothing;

-- 정책을 실제로 타려면 테이블 소유자(postgres, BYPASSRLS)가 아닌 역할로 접근해야 한다.
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ============================ 검증 시작 ============================
set role authenticated;

-- 1) 조직 A 계정으로 로그인 — 자기 사이트만 보여야 한다.
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000a';
select case when count(*) = 1 and min(id) = 'site-a'
            then 'PASS  1. org A 는 자기 사이트 1개만 조회'
            else 'FAIL  1. org A 사이트 조회 결과 = ' || coalesce(string_agg(id, ','), '(없음)')
       end from public.mrv_sites;

-- 2) org A 가 org B 의 사이트를 id 로 콕 집어 조회 — 0행이어야 한다.
select case when count(*) = 0
            then 'PASS  2. org A 는 org B 사이트를 id 지정으로도 못 읽음'
            else 'FAIL  2. 테넌트 누수! org A 가 site-b 를 읽음'
       end from public.mrv_sites where id = 'site-b';

-- 3) 계측값·KPI 스냅샷도 같은 격리가 걸려야 한다.
select case when count(*) = 0
            then 'PASS  3. org A 는 org B 의 KPI 스냅샷을 못 읽음'
            else 'FAIL  3. 테넌트 누수! KPI 스냅샷'
       end from public.mrv_kpi_snapshots where org_id = 'org-b';

-- 4) 남의 org 로 행을 밀어 넣기 — WITH CHECK 이 막아야 한다(가장 값비싼 공격).
do $$
begin
  insert into public.mrv_sites (id, org_id, name) values ('site-x', 'org-b', '침입');
  raise notice 'FAIL  4. 테넌트 침입! org A 가 org B 에 사이트를 생성함';
exception when insufficient_privilege or check_violation then
  raise notice 'PASS  4. org A 는 org B 에 행을 삽입할 수 없음';
end $$;

-- 5) 남의 org 사용자 행을 owner 로 밀어 넣기 — 테넌트 탈취 시도.
do $$
begin
  insert into public.mrv_users (id, org_id, email, role) values ('u-x', 'org-b', 'x@e.com', 'owner');
  raise notice 'FAIL  5. 테넌트 탈취! org A 가 org B 에 owner 를 만듦';
exception when insufficient_privilege or check_violation then
  raise notice 'PASS  5. org A 는 org B 에 owner 계정을 만들 수 없음';
end $$;

-- 6) 로그인 직후(org 를 아직 모를 때) 자기 사용자 행은 읽을 수 있어야 한다.
--    이게 막히면 아무도 로그인할 수 없다.
select case when count(*) = 1 and min(org_id) = 'org-a'
            then 'PASS  6. 로그인 직후 자기 mrv_users 행 조회 가능'
            else 'FAIL  6. 자기 사용자 행을 못 읽음 — 로그인 불가'
       end from public.mrv_users where supabase_user_id = auth.uid();

-- 7) 조직 B 계정으로 바꾸면 시야가 정확히 뒤집혀야 한다.
set request.jwt.claim.sub = '00000000-0000-4000-8000-00000000000b';
select case when count(*) = 1 and min(id) = 'site-b'
            then 'PASS  7. org B 는 자기 사이트만 조회(시야 전환 정상)'
            else 'FAIL  7. org B 사이트 조회 결과 = ' || coalesce(string_agg(id, ','), '(없음)')
       end from public.mrv_sites;

-- 8) 미인증(JWT 없음) — 아무것도 보이면 안 된다.
set request.jwt.claim.sub = '';
select case when count(*) = 0
            then 'PASS  8. 미인증 세션은 어떤 사이트도 못 읽음'
            else 'FAIL  8. 미인증인데 ' || count(*) || '건 노출'
       end from public.mrv_sites;

reset role;

-- 9) 잠긴 baseline 은 UPDATE 가 거부돼야 한다 — service_role(RLS 우회)로도 막혀야 한다.
do $$
begin
  update public.mrv_baselines set ei_total = 1.0 where id = 'bl-a';
  raise notice 'FAIL  9. 잠긴 baseline 이 수정됨 (ADR 0002 위반)';
exception when others then
  raise notice 'PASS  9. 잠긴 baseline UPDATE 거부 — %', left(SQLERRM, 60);
end $$;

-- 10) 잠긴 baseline DELETE 도 거부돼야 한다.
do $$
begin
  delete from public.mrv_baselines where id = 'bl-a';
  raise notice 'FAIL 10. 잠긴 baseline 이 삭제됨 (ADR 0002 위반)';
exception when others then
  raise notice 'PASS 10. 잠긴 baseline DELETE 거부';
end $$;

-- 11) 사이트당 잠긴 baseline 은 최대 1개(재잠금 방지).
do $$
begin
  insert into public.mrv_baselines
    (id, site_id, org_id, period_start, period_end, config_version, status)
  values ('bl-a2', 'site-a', 'org-a', now() - interval '10 day', now(), '2026.1.0', 'locked');
  raise notice 'FAIL 11. 같은 사이트에 잠긴 baseline 이 2개 생성됨';
exception when unique_violation then
  raise notice 'PASS 11. 사이트당 잠긴 baseline 은 1개로 제한됨';
end $$;

-- 12) 승인 게이트: 승인자 없이 approved 로 만들 수 없다.
insert into public.mrv_tanks (id, site_id, org_id, name) values ('tank-a','site-a','org-a','A1')
  on conflict do nothing;
insert into public.mrv_recipes (id, site_id, org_id, type) values ('rc-a','site-a','org-a','feed')
  on conflict do nothing;
insert into public.mrv_recipe_versions (id, recipe_id, org_id, version, params_json, rationale, created_by)
  values ('rv-a','rc-a','org-a',1,'{}'::jsonb,'테스트','u-a') on conflict do nothing;
do $$
begin
  insert into public.mrv_control_actions
    (id, tank_id, recipe_version_id, site_id, org_id, status)
  values ('ca-x','tank-a','rv-a','site-a','org-a','approved');
  raise notice 'FAIL 12. 승인자 없이 approved 상태가 만들어짐';
exception when check_violation then
  raise notice 'PASS 12. 승인자 없는 approved 는 CHECK 이 거부';
end $$;

-- 13) 승인 시각 없이 applied 로 만들 수 없다.
do $$
begin
  insert into public.mrv_control_actions
    (id, tank_id, recipe_version_id, site_id, org_id, status, approved_by)
  values ('ca-y','tank-a','rv-a','site-a','org-a','applied','u-a');
  raise notice 'FAIL 13. 승인 시각 없이 applied 상태가 만들어짐';
exception when check_violation then
  raise notice 'PASS 13. 승인 시각 없는 applied 는 CHECK 이 거부';
end $$;
