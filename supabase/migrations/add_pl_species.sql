-- =====================================================
--  production_cycles 테이블에 흰다리새우 종류 컬럼 추가
-- =====================================================

ALTER TABLE production_cycles
  ADD COLUMN IF NOT EXISTS pl_species text;
