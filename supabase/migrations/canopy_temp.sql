-- ============================================================
-- 초관부 온도 칸 — 2m 기온(기상센서)과 지상 10cm 초관부 온도(지그비 온습도계)를 따로 둔다
--
-- environment_readings.sql 의 air_temp 는 "2m 기온, 없으면 초관부 온도" 한 칸이었다.
-- 기상센서와 초관부 센서를 함께 단 농장에서는 air_temp 가 2m 를 쓰므로 초관부 값이
-- 웹 어디에도 남지 않았다. 장비(raspberry-pi/field_env.py)는 둘 다 있을 때
-- canopy_temp 를 따로 올린다(1.9.4+). 둘 중 하나만 있으면 지금처럼 air_temp 한 칸이다.
--
-- 실행 전에도 장비는 멈추지 않는다 — 서버가 canopy_temp 칸만 빼고 저장한다.
-- environment_readings.sql 다음에 실행한다(wq_series 를 그 판 위에 다시 만든다). 재실행 안전.
--
-- 실행 위치: Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE public.water_quality_readings
  ADD COLUMN IF NOT EXISTS canopy_temp double precision;  -- 초관부 온도(지상 10cm), °C

-- 값 범위 — 서버 수신(lib/env-params.ts ENV_PARAMS)과 같은 값.
DO $$ BEGIN
  ALTER TABLE public.water_quality_readings ADD CONSTRAINT wqr_canopy_range CHECK (
    canopy_temp IS NULL OR canopy_temp BETWEEN -50 AND 70
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── wq_series 재정의 ── environment_readings.sql 판에 canopy_temp 한 칸을 더한다.
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
    AND r.recorded_at > now() - make_interval(hours => LEAST(GREATEST(p_hours, 1), 24 * 60))
    AND (p_device IS NULL OR r.device_id = p_device)
  GROUP BY 1, 2, w.sec
  ORDER BY 1 ASC
$$;

REVOKE ALL ON FUNCTION public.wq_series(uuid, int, uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wq_series(uuid, int, uuid, int) TO authenticated;

-- API 스키마 캐시 갱신 (이걸 빼먹으면 서버가 새 칸을 못 본다)
-- API 스키마 캐시 갱신
NOTIFY pgrst, 'reload schema';
