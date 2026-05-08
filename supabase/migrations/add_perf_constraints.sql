-- Unique constraint: prevent duplicate Stripe customer IDs
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_stripe_customer_unique
  ON public.profiles(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- Composite index for water quality time-range queries (reports, chart)
CREATE INDEX IF NOT EXISTS idx_wqr_tank_recorded_at
  ON public.water_quality_readings(tank_id, recorded_at DESC);

-- Index for journal entries date filtering
CREATE INDEX IF NOT EXISTS idx_journal_tank_date
  ON public.journal_entries(tank_id, entry_date DESC);

-- Index for diagnosis results date filtering
CREATE INDEX IF NOT EXISTS idx_diagnosis_tank_tested_at
  ON public.diagnosis_results(tank_id, tested_at DESC);
