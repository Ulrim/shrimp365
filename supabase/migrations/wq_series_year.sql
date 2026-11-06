-- ============================================================
-- 그래프 기간을 1년까지 — wq_series 의 최대 기간 60일 → 366일
--
-- 웹 환경·기상 카드의 기간 단추(6시간·12시간·24시간·일주일·한 달·1년) 중 1년이
-- 60일에서 잘리지 않게 한다. 점 수는 그대로(p_max_points, 기본 240)라 기간이 길수록
-- 구간 평균의 칸이 넓어질 뿐 화면으로 오는 행 수는 같다.
--
-- canopy_temp.sql 다음에 실행한다(같은 함수를 그 판 위에 다시 만든다). 재실행 안전.
-- 실행 전에도 웹은 멈추지 않는다 — 1년을 고르면 60일까지만 보일 뿐이다.
--
-- 실행 위치: Supabase Dashboard → SQL Editor
-- ============================================================

DROP FUNCTION IF EXISTS public.wq_series(uuid, int, uuid, int);

CREATE FUNCTION public.wq_series(
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
  conductivity float8,
  flow_rate float8,
  diff_pressure float8,
  air_temp float8, humidity float8, soil_moisture float8, soil_temp float8,
  wind_speed float8, wind_gust float8, wind_dir float8,
  rain_day float8, rain_rate float8, solar float8, uv_index float8, pressure float8,
  canopy_temp float8,
  sample_count int
)
LANGUAGE sql STABLE AS $$
  WITH w AS (
    SELECT GREATEST(60, CEIL(p_hours * 3600.0 / GREATEST(LEAST(p_max_points, 500), 50))::int) AS sec
  )
  SELECT
    to_timestamp(FLOOR(EXTRACT(epoch FROM r.recorded_at) / w.sec) * w.sec) AS recorded_at,
    r.device_id,
    AVG(r.temperature)::float8, AVG(r.ph)::float8, AVG(r.do_level)::float8, AVG(r.salinity)::float8,
    AVG(r.ammonia)::float8, AVG(r.nitrite)::float8, AVG(r.nitrate)::float8,
    AVG(r.alkalinity)::float8, AVG(r.turbidity)::float8,
    AVG(r.conductivity)::float8,
    AVG(r.flow_rate)::float8,
    AVG(r.diff_pressure)::float8,
    AVG(r.air_temp)::float8, AVG(r.humidity)::float8,
    AVG(r.soil_moisture)::float8, AVG(r.soil_temp)::float8,
    AVG(r.wind_speed)::float8, AVG(r.wind_gust)::float8,
    CASE WHEN COUNT(r.wind_dir) = 0 THEN NULL ELSE
      (DEGREES(ATAN2(AVG(SIN(RADIANS(r.wind_dir))), AVG(COS(RADIANS(r.wind_dir))))) + 360)::numeric % 360
    END::float8,
    (ARRAY_AGG(r.rain_day ORDER BY r.recorded_at DESC) FILTER (WHERE r.rain_day IS NOT NULL))[1]::float8,
    AVG(r.rain_rate)::float8, AVG(r.solar)::float8, AVG(r.uv_index)::float8, AVG(r.pressure)::float8,
    AVG(r.canopy_temp)::float8,
    COUNT(*)::int
  FROM public.water_quality_readings r, w
  WHERE r.tank_id = p_tank
    AND r.recorded_at > now() - make_interval(hours => LEAST(GREATEST(p_hours, 1), 24 * 366))
    AND (p_device IS NULL OR r.device_id = p_device)
  GROUP BY 1, 2, w.sec
  ORDER BY 1 ASC
$$;

REVOKE ALL ON FUNCTION public.wq_series(uuid, int, uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wq_series(uuid, int, uuid, int) TO authenticated;

-- API 스키마 캐시 갱신
NOTIFY pgrst, 'reload schema';
