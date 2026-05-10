-- =====================================================
--  Shrimp365 재고 관리 테이블
--  Supabase SQL Editor에 통째로 붙여넣기 후 실행
-- =====================================================

-- 1. 재고 품목
CREATE TABLE IF NOT EXISTS inventory_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category       text NOT NULL CHECK (category IN ('feed','probiotic','chemical','other')),
  name           text NOT NULL,
  unit           text NOT NULL,
  current_stock  numeric(12,3) NOT NULL DEFAULT 0,
  reorder_level  numeric(12,3) NOT NULL DEFAULT 0,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- 2. 입출고 트랜잭션
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('in','out')),
  quantity     numeric(12,3) NOT NULL,
  unit_price   numeric(12,0),
  tank_id      uuid REFERENCES tanks(id) ON DELETE SET NULL,
  supplier     text,
  recorded_at  date NOT NULL DEFAULT CURRENT_DATE,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── RLS 활성화 ────────────────────────────────────────────────────────────
ALTER TABLE inventory_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;

-- ─── RLS 정책: 본인 데이터만 CRUD ─────────────────────────────────────────
DROP POLICY IF EXISTS "own_inventory_items" ON inventory_items;
CREATE POLICY "own_inventory_items" ON inventory_items
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own_inventory_transactions" ON inventory_transactions;
CREATE POLICY "own_inventory_transactions" ON inventory_transactions
  FOR ALL USING (auth.uid() = user_id);

-- ─── 인덱스 ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_inventory_items_user        ON inventory_items(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_category    ON inventory_items(category);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_item ON inventory_transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_user ON inventory_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_date ON inventory_transactions(recorded_at);
