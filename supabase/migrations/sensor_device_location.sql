-- 장비(센서 기기)별 위치 좌표
--
-- 배경: 장비에는 GPS 가 없다. 대신 기기 연결(페어링)은 반드시 현장에서
-- 휴대폰으로 하므로, 그 순간 휴대폰의 위치(GPS급, 수 m 정확도)를 받아
-- 장비 위치로 기록한다. 관제센터 지도에서 장비별 마커로 쓴다.
--
-- 이 파일은 Supabase SQL Editor 에서 실행한다(사람 몫). 실행 전에도 페어링은
-- 정상 동작하며(좌표만 생략), 실행 후 새로 연결하는 장비부터 위치가 남는다.

ALTER TABLE public.sensor_devices
  ADD COLUMN IF NOT EXISTS latitude   double precision,
  ADD COLUMN IF NOT EXISTS longitude  double precision,
  ADD COLUMN IF NOT EXISTS located_at timestamptz;

-- 위도·경도 범위 제약 (NULL 은 통과)
DO $$ BEGIN
  ALTER TABLE public.sensor_devices
    ADD CONSTRAINT sensor_devices_lat_range CHECK (latitude  IS NULL OR (latitude  BETWEEN -90  AND 90));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.sensor_devices
    ADD CONSTRAINT sensor_devices_lng_range CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- API 스키마 캐시 갱신 (이걸 빼먹으면 웹이 새 컬럼을 못 본다)
NOTIFY pgrst, 'reload schema';
