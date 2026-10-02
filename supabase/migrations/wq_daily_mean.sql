-- 일별 평균 수질 — 엔진 1(성장곡선)의 시간축을 만들기 위한 집계
--
-- 배경: 엔진 1 은 적산수온(TGC) 축 위에 곡선을 얹는다. 그러려면 **사이클 전
--   구간의 날짜별 평균 수온**이 필요한데, 지금 조회 경로로는 그것을 못 얻는다.
--
--   · wq_series(wq_series.sql) 는 p_hours 를 `LEAST(..., 24 * 60)` 으로 자른다.
--     1,440시간 = **60일**이 상한이다. 천황수산 사이클은 2024-03-12 ~ 12-05 로
--     268일이라 함수가 구간을 아예 덮지 못한다.
--   · 버킷도 달력일이 아니라 epoch 초를 나눈 것이라, 같은 날이 두 버킷으로
--     갈리거나 두 날이 한 버킷에 묶인다. 적산수온은 날짜 단위로 더해야 한다.
--   · 원자료를 그대로 받으면 60초 간격 × 268일 × 수조 = 수십만 행이고,
--     Supabase API 는 요청당 1,000행이다.
--
--   그래서 **달력일 기준 평균**을 돌려주는 함수를 따로 둔다. wq_series 를
--   고치지 않는 이유 — 그쪽은 그래프용이고 짧은 구간을 조밀하게 보는 것이
--   목적이다. 상한을 늘리면 그래프가 느려진다. 쓰임이 다르면 함수도 나눈다.
--
-- 시간대: **Asia/Seoul 기준으로 날짜를 가른다.** recorded_at 은 timestamptz 라
--   UTC 로 저장되는데, UTC 자정으로 자르면 한국 시각 오전 9시에 날짜가 바뀌어
--   하루치가 이틀로 쪼개진다. 데이터 제작자도 같은 가정을 썼다(README: "시간대는
--   원본에 없으므로 한국 현장 기록이라는 작업 가정으로 Asia/Seoul 을 적용").
--
-- SECURITY INVOKER(기본)라 RLS 가 그대로 적용된다 — 자기 수조만 조회된다.
-- 실행 순서: 다른 파일과 독립이다. 재실행 안전(CREATE OR REPLACE).
-- Supabase SQL Editor 에서 실행한다(사람 몫).

CREATE OR REPLACE FUNCTION public.wq_daily_mean(
  p_tank  uuid,
  p_from  date,
  p_to    date
)
RETURNS TABLE (
  day              date,
  temperature      float8,
  ph               float8,
  do_level         float8,
  salinity         float8,
  sample_count     int
)
LANGUAGE sql STABLE AS $$
  SELECT
    (r.recorded_at AT TIME ZONE 'Asia/Seoul')::date AS day,
    AVG(r.temperature)::float8,
    AVG(r.ph)::float8,
    AVG(r.do_level)::float8,
    AVG(r.salinity)::float8,
    COUNT(*)::int
  FROM public.water_quality_readings r
  WHERE r.tank_id = p_tank
    AND (r.recorded_at AT TIME ZONE 'Asia/Seoul')::date >= p_from
    AND (r.recorded_at AT TIME ZONE 'Asia/Seoul')::date <= p_to
  GROUP BY 1
  ORDER BY 1 ASC
$$;

COMMENT ON FUNCTION public.wq_daily_mean(uuid, date, date) IS
  '수조 하나의 달력일(Asia/Seoul) 평균 수질. 엔진 1 의 적산수온 축을 만드는 용도다. wq_series 는 60일 상한이라 사이클 전 구간을 못 덮어 따로 둔다. 측정이 없는 날은 행이 아예 없다 — 0 으로 채우지 않으므로 호출자가 결측으로 다루고, lib/growth 의 cumulativeDegreeDays 가 평균 증분으로 메운 뒤 filledDays 로 알린다.';

REVOKE ALL ON FUNCTION public.wq_daily_mean(uuid, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wq_daily_mean(uuid, date, date) TO authenticated;

-- 날짜 범위 조회가 기본이므로 (tank_id, recorded_at) 인덱스를 확인해 둔다.
-- schema.sql 의 idx_wqr_tank_recorded 가 (tank_id, recorded_at DESC) 라 그대로 쓰인다.

NOTIFY pgrst, 'reload schema';
