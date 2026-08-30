-- 수질 기록에 전도도(EC) 추가
--
-- 배경: 같은 EC 센서로 염도와 전도도 둘 다 낼 수 있다. 양액·민물처럼 EC 자체가
-- 관리 대상인 곳에서는 염도 환산값이 뜻을 흐려, 장비에서 측정 항목을 고를 수
-- 있게 했다(ec_mode). 그런데 수질 기록에는 EC 칸이 없어 웹 그래프·이력에
-- 남지 않았다. 칸을 만들어 염도와 같은 격으로 다룬다.
--
-- 단위는 uS/cm 로 통일한다(장비가 보내는 원값). mS/cm 표시는 화면에서 나눈다.
-- Supabase SQL Editor 에서 실행한다(사람 몫).

ALTER TABLE public.water_quality_readings
  ADD COLUMN IF NOT EXISTS conductivity double precision;

-- 값 범위 — 바닷물이 약 50,000 uS/cm. 넉넉히 잡되 말이 안 되는 값은 막는다.
DO $$ BEGIN
  ALTER TABLE public.water_quality_readings
    ADD CONSTRAINT wqr_conductivity_range
    CHECK (conductivity IS NULL OR (conductivity >= 0 AND conductivity <= 200000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 그래프용 구간 평균 함수에 전도도를 더한다(wq_series.sql 의 갱신판).
-- 이 파일만 실행해도 되도록 함수 전체를 다시 만든다.
--
-- 돌려주는 항목이 늘었으므로 CREATE OR REPLACE 로는 안 된다(42P13).
-- 먼저 지우고 새로 만든다. 지운 잠깐 사이에는 웹이 폴백 경로(최신 1,000행)로
-- 그리므로 화면이 멈추지는 않는다.
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

-- API 스키마 캐시 갱신 (이걸 빼먹으면 웹이 새 칸을 못 본다)
NOTIFY pgrst, 'reload schema';
