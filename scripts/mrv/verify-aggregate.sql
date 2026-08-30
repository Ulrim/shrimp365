-- 시계열 집계 함수 검증 — mrv_aggregate_readings 가 원본 Python 집계와 같은 규칙을 쓰는지.
--
-- 원본(apps/api/app/services/readings_service.py::_query_aggregated)의 규칙:
--   · 버킷 = date_trunc('hour'|'day', time)
--   · 값   = power 는 SUM, 그 외 타입은 AVG
--   · 품질 = bad 하나라도 있으면 bad, 아니면 suspect 하나라도 있으면 suspect, 전부면 ok
--   · 기간 = [from, to) 반열림
--   · 정렬 = bucket, meter_id
--
-- 기대: 모든 줄이 PASS.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

-- --- 픽스처 ---------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000ff', 'agg@example.com') on conflict do nothing;
insert into public.mrv_organizations (id, name, plan)
  values ('org-agg', '집계 검증', 'PRO') on conflict do nothing;
insert into public.mrv_users (id, org_id, email, role, supabase_user_id)
  values ('u-agg', 'org-agg', 'agg@example.com', 'owner',
          '00000000-0000-4000-8000-0000000000ff') on conflict do nothing;
insert into public.mrv_sites (id, org_id, name)
  values ('site-agg', 'org-agg', '집계 사이트') on conflict do nothing;
insert into public.mrv_meters (id, site_id, org_id, type, unit, is_aeration) values
  ('mp', 'site-agg', 'org-agg', 'power', 'kWh_interval', false),
  ('md', 'site-agg', 'org-agg', 'do',    'mg_l',         false)
  on conflict do nothing;

-- 전력계: 10시대에 3건(합 6.0), 11시대에 2건(합 10.0). 품질이 섞여 있다.
insert into public.mrv_readings ("time", meter_id, org_id, value, quality_flag) values
  (timestamptz '2026-05-01 10:00:00+00', 'mp', 'org-agg', 1.0, 'ok'),
  (timestamptz '2026-05-01 10:20:00+00', 'mp', 'org-agg', 2.0, 'suspect'),
  (timestamptz '2026-05-01 10:40:00+00', 'mp', 'org-agg', 3.0, 'ok'),
  (timestamptz '2026-05-01 11:10:00+00', 'mp', 'org-agg', 4.0, 'ok'),
  (timestamptz '2026-05-01 11:50:00+00', 'mp', 'org-agg', 6.0, 'bad'),
  -- 다음 날(일별 버킷 확인용)
  (timestamptz '2026-05-02 09:00:00+00', 'mp', 'org-agg', 5.0, 'ok')
  on conflict do nothing;

-- DO 계측기: 10시대 3건(평균 (4+6+8)/3 = 6.0), 전부 ok.
insert into public.mrv_readings ("time", meter_id, org_id, value, quality_flag) values
  (timestamptz '2026-05-01 10:05:00+00', 'md', 'org-agg', 4.0, 'ok'),
  (timestamptz '2026-05-01 10:25:00+00', 'md', 'org-agg', 6.0, 'ok'),
  (timestamptz '2026-05-01 10:45:00+00', 'md', 'org-agg', 8.0, 'ok')
  on conflict do nothing;

-- --- 1. 시간별 SUM(power) + 품질 우선순위 --------------------------------
select case when count(*) = 2
                 and max(case when bucket = timestamptz '2026-05-01 10:00:00+00'
                              then value end) = 6.0
                 and max(case when bucket = timestamptz '2026-05-01 11:00:00+00'
                              then value end) = 10.0
            then 'PASS  1. 시간별 power 는 구간 합(6.0 / 10.0)'
            else 'FAIL  1. 시간별 power 합이 틀림'
       end
from public.mrv_aggregate_readings(array['mp'], timestamptz '2026-05-01 00:00:00+00',
                                   timestamptz '2026-05-02 00:00:00+00', 'hourly', true);

-- 10시대는 ok+suspect+ok → suspect, 11시대는 ok+bad → bad.
select case when max(case when bucket = timestamptz '2026-05-01 10:00:00+00'
                          then quality_flag end) = 'suspect'
                 and max(case when bucket = timestamptz '2026-05-01 11:00:00+00'
                              then quality_flag end) = 'bad'
            then 'PASS  2. 품질은 bad > suspect > ok 우선순위로 접힘'
            else 'FAIL  2. 품질 집계 규칙이 틀림'
       end
from public.mrv_aggregate_readings(array['mp'], timestamptz '2026-05-01 00:00:00+00',
                                   timestamptz '2026-05-02 00:00:00+00', 'hourly', true);

-- --- 3. 시간별 AVG(비-power) ---------------------------------------------
select case when count(*) = 1 and min(value) = 6.0
            then 'PASS  3. 시간별 DO 는 구간 평균(6.0)'
            else 'FAIL  3. DO 평균이 틀림 = ' || coalesce(min(value)::text, '(없음)')
       end
from public.mrv_aggregate_readings(array['md'], timestamptz '2026-05-01 00:00:00+00',
                                   timestamptz '2026-05-02 00:00:00+00', 'hourly', false);

-- --- 4. 일별 버킷 ---------------------------------------------------------
select case when count(*) = 2
                 and max(case when bucket = timestamptz '2026-05-01 00:00:00+00'
                              then value end) = 16.0
                 and max(case when bucket = timestamptz '2026-05-02 00:00:00+00'
                              then value end) = 5.0
            then 'PASS  4. 일별 버킷이 하루 단위로 접힘(16.0 / 5.0)'
            else 'FAIL  4. 일별 버킷이 틀림'
       end
from public.mrv_aggregate_readings(array['mp'], timestamptz '2026-05-01 00:00:00+00',
                                   timestamptz '2026-05-03 00:00:00+00', 'daily', true);

-- --- 5. 기간은 [from, to) 반열림 — 상한 시각의 값은 빠져야 한다 ----------
-- to = 11:00 이면 11:10, 11:50 건은 빠지고 10시대만 남는다.
select case when count(*) = 1 and min(value) = 6.0
            then 'PASS  5. 상한(to)은 미포함 — 반열림 규약이 KPI 엔진과 같다'
            else 'FAIL  5. 반열림이 아님(상한 시각 값이 섞였다)'
       end
from public.mrv_aggregate_readings(array['mp'], timestamptz '2026-05-01 00:00:00+00',
                                   timestamptz '2026-05-01 11:00:00+00', 'hourly', true);

-- 하한(from)은 포함돼야 한다.
select case when count(*) = 1 and min(value) = 6.0
            then 'PASS  6. 하한(from)은 포함'
            else 'FAIL  6. 하한 시각 값이 누락됨'
       end
from public.mrv_aggregate_readings(array['mp'], timestamptz '2026-05-01 10:00:00+00',
                                   timestamptz '2026-05-01 11:00:00+00', 'hourly', true);

-- --- 7. 여러 계측기를 한 번에 — 계측기별로 나뉘어 나와야 한다 ------------
select case when count(*) = 3
                 and count(distinct meter_id) = 2
            then 'PASS  7. 복수 계측기가 meter_id 별로 분리돼 나옴'
            else 'FAIL  7. 복수 계측기 분리 실패 (행 ' || count(*) || ')'
       end
from public.mrv_aggregate_readings(array['mp','md'], timestamptz '2026-05-01 00:00:00+00',
                                   timestamptz '2026-05-02 00:00:00+00', 'hourly', true);

-- --- 8. 대상 계측기가 없으면 빈 결과 -------------------------------------
select case when count(*) = 0
            then 'PASS  8. 없는 계측기 조회는 빈 결과'
            else 'FAIL  8. 없는 계측기인데 행이 나옴'
       end
from public.mrv_aggregate_readings(array['nope'], timestamptz '2026-05-01 00:00:00+00',
                                   timestamptz '2026-05-02 00:00:00+00', 'hourly', true);
