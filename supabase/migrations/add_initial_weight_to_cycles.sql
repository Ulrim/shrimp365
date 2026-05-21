-- production_cycles 에 시작 중량(g) 컬럼 추가
ALTER TABLE public.production_cycles
  ADD COLUMN IF NOT EXISTS initial_weight_g NUMERIC DEFAULT NULL;
