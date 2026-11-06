-- ============================================================
-- 환경·기상 측정 칸 — 스마트팜 장비가 수질 값과 같은 줄로 올린다
--
-- 장비(raspberry-pi/field_env.py)가 같은 파이의 노지 수집기 파일을 읽어
-- 지그비 온습도·토양수분과 기상센서(WS90) 값을 /api/sensors/data 로 함께 보낸다.
-- 따로 테이블을 두지 않고 water_quality_readings 에 칸을 더한 이유:
--   · 장비는 한 번에 한 줄을 보낸다. 줄을 둘로 나누면 재전송 큐·중복 처리를 두 벌 둬야 한다.
--   · 웹 그래프가 수질과 환경을 같은 시간축으로 겹쳐 볼 수 있다.
-- 안 재는 장비는 모두 null 이다(새우 장비 포함 — 화면·알림은 그대로).
--
-- 실행 전에도 장비는 멈추지 않는다 — 서버가 환경 칸만 빼고 수질 값을 저장한다.
-- 재실행 안전(멱등).
--
-- 실행 위치: Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE public.water_quality_readings
  ADD COLUMN IF NOT EXISTS air_temp      double precision,  -- 기온(2m) 또는 초관부 온도(지상 10cm), °C
  ADD COLUMN IF NOT EXISTS humidity      double precision,  -- 상대습도, %
  ADD COLUMN IF NOT EXISTS soil_moisture double precision,  -- 토양 체적함수율, %
  ADD COLUMN IF NOT EXISTS soil_temp     double precision,  -- 지온, °C
  ADD COLUMN IF NOT EXISTS wind_speed    double precision,  -- 평균 풍속, m/s
  ADD COLUMN IF NOT EXISTS wind_gust     double precision,  -- 돌풍(WS90 은 28초 창 최댓값), m/s
  ADD COLUMN IF NOT EXISTS wind_dir      double precision,  -- 풍향, 도(0=북, 시계방향)
  ADD COLUMN IF NOT EXISTS rain_day      double precision,  -- 장비 현지 자정부터의 강수 누계, mm
  ADD COLUMN IF NOT EXISTS rain_rate     double precision,  -- 강우강도, mm/h
  ADD COLUMN IF NOT EXISTS solar         double precision,  -- 일사, W/m²
  ADD COLUMN IF NOT EXISTS uv_index      double precision,  -- 자외선 지수
  ADD COLUMN IF NOT EXISTS pressure      double precision;  -- 해면기압, hPa

-- 값 범위 — 서버 수신 화이트리스트(route.ts ENV_RANGE)와 같은 값.
DO $$ BEGIN
  ALTER TABLE public.water_quality_readings ADD CONSTRAINT wqr_env_range CHECK (
        (air_temp      IS NULL OR air_temp      BETWEEN -50  AND 70)
    AND (humidity      IS NULL OR humidity      BETWEEN 0    AND 100)
    AND (soil_moisture IS NULL OR soil_moisture BETWEEN 0    AND 100)
    AND (soil_temp     IS NULL OR soil_temp     BETWEEN -30  AND 70)
    AND (wind_speed    IS NULL OR wind_speed    BETWEEN 0    AND 80)
    AND (wind_gust     IS NULL OR wind_gust     BETWEEN 0    AND 100)
    AND (wind_dir      IS NULL OR wind_dir      BETWEEN 0    AND 360)
    AND (rain_day      IS NULL OR rain_day      BETWEEN 0    AND 1000)
    AND (rain_rate     IS NULL OR rain_rate     BETWEEN 0    AND 500)
    AND (solar         IS NULL OR solar         BETWEEN 0    AND 2000)
    AND (uv_index      IS NULL OR uv_index      BETWEEN 0    AND 20)
    AND (pressure      IS NULL OR pressure      BETWEEN 800  AND 1100)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── wq_series 재정의 ─────────────────────────────────────────
-- 웹 그래프·대시보드는 원본 행이 아니라 이 구간 평균 함수로 읽는다(lib/db.ts
-- getWaterQuality). 환경 칸을 돌려주지 않으면 값이 저장돼도 웹 "환경·기상" 카드가
-- 영영 비어 보인다. agriculture_mode.sql 판에 환경 칸 12개를 더한다.
--   · 풍향은 각도라 산술평균이 틀린다(350°·10° → 180°). 단위벡터 평균으로 낸다.
--   · 오늘 강수(rain_day)는 자정에 0 으로 돌아가는 누계라 평균·최대가 아니라
--     구간의 마지막 값을 쓴다.
-- 돌려주는 칸이 늘었으므로 CREATE OR REPLACE 로는 안 된다(42P13). 지우고 새로 만든다.
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
NOTIFY pgrst, 'reload schema';
