-- ============================================================
-- 양식장 좌표
-- Supabase SQL Editor 에서 실행하세요.
--
-- 지도 표시와 기상 연동(폭우·태풍 경보)에 쓰입니다.
-- 라즈베리파이에 GPS 를 달 필요는 없습니다 — 장비는 수조 옆에 고정되어
-- 움직이지 않으므로, 농장 좌표만 있으면 장비 위치도 정해집니다.
-- 오히려 GPS 는 창고 안에서 위성이 안 잡혀 측위가 되지 않습니다.
-- ============================================================

ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS latitude   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude  DOUBLE PRECISION;

-- 좌표 범위를 벗어난 값이 들어오면 지도가 엉뚱한 곳을 가리키고
-- 기상 예보도 다른 지역 것을 끌어온다.
DO $$ BEGIN
  ALTER TABLE public.farms
    ADD CONSTRAINT farms_latitude_range
    CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.farms
    ADD CONSTRAINT farms_longitude_range
    CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 좌표가 있는 농장만 지도·기상에 태운다.
CREATE INDEX IF NOT EXISTS idx_farms_coords
  ON public.farms(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

DO $$ BEGIN
  RAISE NOTICE '양식장 좌표 컬럼이 추가되었습니다.';
END $$;
