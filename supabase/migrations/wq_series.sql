-- 수질 그래프용 구간 평균 시리즈 함수
--
-- 배경: Supabase API 는 요청당 최대 1,000행만 준다. 센서 여러 대가 분 단위로
-- 값을 올리면 7일치는 수만 행이라, 화면이 "가장 오래된 1,000행"만 받아
-- 최신 값(그리고 센서 표시 device_id)이 영영 안 보이는 문제가 있었다.
--
-- 이 함수는 구간을 시간 버킷으로 나눠 센서별 평균을 돌려준다. 전 구간을
-- 항상 커버하면서 행 수는 상한(기본 240버킷 × 센서 수) 안에 머문다.
--
-- SECURITY INVOKER(기본)라 RLS 가 그대로 적용된다 — 자기 수조만 조회된다.
-- 이 파일은 Supabase SQL Editor 에서 실행한다(사람 몫). 실행 전에도 웹은
-- 폴백(최신 1,000행)으로 동작하지만, 긴 구간 그래프는 이 함수가 있어야 온전하다.

CREATE OR REPLACE FUNCTION public.wq_series(
  p_tank uuid,
  p_hours int,
  p_device uuid DEFAULT NULL,
  p_max_points int DEFAULT 240
)
RETURNS TABLE (
  recorded_at timestamptz,
  device_id uuid,
  temperature float8, ph float8, do_level float8, salinity float8,
  ammonia float8, nitrite float8, nitrate float8, alkalinity float8, turbidity float8,
  sample_count int
)
LANGUAGE sql STABLE AS $$
  WITH w AS (
    -- 버킷 폭(초). 짧은 구간은 원자료 그대로(60초), 긴 구간은 평균으로 압축.
    SELECT GREATEST(60, CEIL(p_hours * 3600.0 / GREATEST(LEAST(p_max_points, 500), 50))::int) AS sec
  )
  SELECT
    to_timestamp(FLOOR(EXTRACT(epoch FROM r.recorded_at) / w.sec) * w.sec) AS recorded_at,
    r.device_id,
    AVG(r.temperature)::float8, AVG(r.ph)::float8, AVG(r.do_level)::float8, AVG(r.salinity)::float8,
    AVG(r.ammonia)::float8, AVG(r.nitrite)::float8, AVG(r.nitrate)::float8,
    AVG(r.alkalinity)::float8, AVG(r.turbidity)::float8,
    COUNT(*)::int
  FROM public.water_quality_readings r, w
  WHERE r.tank_id = p_tank
    AND r.recorded_at > now() - make_interval(hours => LEAST(GREATEST(p_hours, 1), 24 * 60))
    AND (p_device IS NULL OR r.device_id = p_device)
  GROUP BY 1, 2, w.sec
  ORDER BY 1 ASC
$$;

-- 로그인 사용자만 쓰면 된다(어차피 RLS 로 자기 수조만 보인다).
REVOKE ALL ON FUNCTION public.wq_series(uuid, int, uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wq_series(uuid, int, uuid, int) TO authenticated;

-- API 스키마 캐시에 새 함수를 알린다.
NOTIFY pgrst, 'reload schema';
