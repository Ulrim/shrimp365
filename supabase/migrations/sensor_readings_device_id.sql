-- 수질 기록을 센서(기기)별로 구분하기 위한 device_id 추가
--
-- 배경: 한 수조에 수질 센서가 여러 대일 수 있는데, 지금까지 water_quality_readings
-- 에는 tank_id 만 있어 어느 센서가 잰 값인지 알 수 없었다. 그래서 센서별 그래프·
-- 이력·비교가 불가능했다. device_id 를 더해 센서별로 나눠 볼 수 있게 한다.
--
-- 이 파일은 Supabase SQL Editor 에서 service_role 로 실행한다(사람 몫).
-- 컬럼은 nullable 이라, 실행 전에 저장된 기존 기록은 device_id = NULL 로 남는다.
-- (그 기록들은 화면에서 "수조 전체(합산)" 로만 보이고, 실행 이후 새 기록부터
--  센서별로 잡힌다. 수집 API 는 컬럼이 생기는 즉시 자동으로 device_id 를 채운다.)

ALTER TABLE public.water_quality_readings
  ADD COLUMN IF NOT EXISTS device_id UUID
  REFERENCES public.sensor_devices(id) ON DELETE SET NULL;

-- 센서별 최신값·이력 조회를 빠르게.
CREATE INDEX IF NOT EXISTS idx_wqr_device_recorded
  ON public.water_quality_readings(device_id, recorded_at DESC);
