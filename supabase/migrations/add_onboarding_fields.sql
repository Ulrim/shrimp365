-- 양식장 대표자 이름 추가
ALTER TABLE public.farms
  ADD COLUMN IF NOT EXISTS owner_name TEXT DEFAULT '';

-- 수조 유형 추가 (노지 / 실내 / 반실내)
ALTER TABLE public.tanks
  ADD COLUMN IF NOT EXISTS tank_type TEXT DEFAULT '노지'
  CHECK (tank_type IN ('노지', '실내', '반실내'));
