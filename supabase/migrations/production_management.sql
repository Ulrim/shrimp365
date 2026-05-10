-- =====================================================
--  Shrimp365 생산 관리 테이블
--  Supabase SQL Editor에 통째로 붙여넣기 후 실행
-- =====================================================

-- 1. 생산 사이클
CREATE TABLE IF NOT EXISTS production_cycles (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tank_id                 uuid NOT NULL REFERENCES tanks(id) ON DELETE CASCADE,
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                    text NOT NULL,
  status                  text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  stocking_date           date NOT NULL,
  stocking_count          integer NOT NULL,
  pl_source               text,
  pl_stage                text,
  target_weight_g         numeric(8,2),
  target_harvest_date     date,
  actual_harvest_date     date,
  actual_harvest_weight_kg numeric(10,3),
  actual_harvest_count    integer,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- 2. 성장 샘플링
CREATE TABLE IF NOT EXISTS growth_samples (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id              uuid NOT NULL REFERENCES production_cycles(id) ON DELETE CASCADE,
  tank_id               uuid NOT NULL REFERENCES tanks(id) ON DELETE CASCADE,
  sampled_at            date NOT NULL,
  sample_count          integer NOT NULL,
  total_weight_g        numeric(10,2) NOT NULL,
  abw_g                 numeric(8,3) NOT NULL,
  survival_rate         numeric(5,2),
  estimated_population  integer,
  estimated_biomass_kg  numeric(10,3),
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- 3. 사이클 비용
CREATE TABLE IF NOT EXISTS cycle_costs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id     uuid NOT NULL REFERENCES production_cycles(id) ON DELETE CASCADE,
  category     text NOT NULL CHECK (category IN ('pl','feed','electricity','labor','chemicals','other')),
  label        text NOT NULL,
  amount       numeric(12,0) NOT NULL,
  recorded_at  date NOT NULL DEFAULT CURRENT_DATE,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 4. 수확 기록
CREATE TABLE IF NOT EXISTS cycle_harvests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id      uuid NOT NULL REFERENCES production_cycles(id) ON DELETE CASCADE,
  harvested_at  date NOT NULL,
  weight_kg     numeric(10,3) NOT NULL,
  count         integer,
  price_per_kg  numeric(8,0) NOT NULL,
  revenue       numeric(12,0) NOT NULL,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── RLS 활성화 ────────────────────────────────────────────────────────────
ALTER TABLE production_cycles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_samples     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle_costs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cycle_harvests     ENABLE ROW LEVEL SECURITY;

-- ─── RLS 정책: 본인 데이터만 CRUD ─────────────────────────────────────────
DROP POLICY IF EXISTS "own_cycles"   ON production_cycles;
DROP POLICY IF EXISTS "own_samples"  ON growth_samples;
DROP POLICY IF EXISTS "own_costs"    ON cycle_costs;
DROP POLICY IF EXISTS "own_harvests" ON cycle_harvests;
CREATE POLICY "own_cycles"   ON production_cycles  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own_samples"  ON growth_samples     FOR ALL USING (auth.uid() = (SELECT user_id FROM production_cycles WHERE id = cycle_id));
CREATE POLICY "own_costs"    ON cycle_costs        FOR ALL USING (auth.uid() = (SELECT user_id FROM production_cycles WHERE id = cycle_id));
CREATE POLICY "own_harvests" ON cycle_harvests     FOR ALL USING (auth.uid() = (SELECT user_id FROM production_cycles WHERE id = cycle_id));

-- ─── 인덱스 ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_production_cycles_user    ON production_cycles(user_id);
CREATE INDEX IF NOT EXISTS idx_production_cycles_tank    ON production_cycles(tank_id);
CREATE INDEX IF NOT EXISTS idx_growth_samples_cycle      ON growth_samples(cycle_id);
CREATE INDEX IF NOT EXISTS idx_cycle_costs_cycle         ON cycle_costs(cycle_id);
CREATE INDEX IF NOT EXISTS idx_cycle_harvests_cycle      ON cycle_harvests(cycle_id);
