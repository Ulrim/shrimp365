-- 수확 기록에 판매 채널과 유통 규격 추가
--
-- 배경: cycle_harvests(production_management.sql:56)는 price_per_kg 단일 단가만
--   가진다. 그런데 천황수산 실데이터의 2024년 실거래를 보면 채널이 5종이고
--   채널별 단가 중앙값이 이렇게 갈린다(평가서 3-1·3-4) —
--
--     도매      wholesale      17,000 원/kg
--     소매 활새우 retail_live    26,500 원/kg   ← 도매보다 +56%
--     소매 냉동  retail_frozen  18,000 원/kg
--
--   **같은 새우를 어느 채널로 내보내는가가 수익성에 성장 몇 주치보다 크게
--   작용한다.** 성장 예측 오차가 20 g 기준 14% 인데 채널 차이는 56% 다.
--   채널을 기록하지 않으면 이 레버가 데이터에 남지 않는다.
--
--   size_count_per_kg(마리수/kg)은 크기-단가 관계를 보기 위한 칸이다. 실데이터로는
--   크기-단가 쌍이 앵커 1점(35미/kg @ 17,000원)뿐이어서 곡선을 그릴 수 없지만
--   (평가서 3-2), 우리 DB 에 이 칸이 있으면 앞으로 쌓인다.
--
-- 실행 순서: 이 배치의 2번. 다른 파일과 독립이므로 순서는 편의상이다.
-- 전부 재실행 안전(멱등)이다. Supabase SQL Editor 에서 실행한다(사람 몫).

-- ── 1) 판매 채널 ─────────────────────────────────────────────
-- 기존 행은 DEFAULT 로 전부 wholesale 이 된다(production_cycles.status 와 같은
-- 패턴). **기존 행의 실제 채널이 도매가 아니었다면 사람이 고쳐야 한다** —
-- 새 칸을 기본값으로 채우는 것이지 알고 있는 값을 덮어쓰는 것이 아니다.
ALTER TABLE public.cycle_harvests
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'wholesale';

-- 5종 — 실데이터의 채널 어휘를 그대로 쓴다. freezer 는 자가 냉동고 이동,
-- sample 은 시료·증정이라 매출이 아니다(revenue 0 으로 들어올 수 있다).
DO $$ BEGIN
  ALTER TABLE public.cycle_harvests ADD CONSTRAINT cycle_harvests_channel_check
    CHECK (channel IN ('wholesale', 'retail_live', 'retail_frozen', 'freezer', 'sample'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2) 유통 규격(마리수/kg) ──────────────────────────────────
-- NULL = 규격 미기록. 0 으로 채우지 않는다 — 0마리/kg 은 말이 안 되고,
-- 미기록과 0 을 섞으면 크기-단가 분석이 조용히 망가진다.
ALTER TABLE public.cycle_harvests
  ADD COLUMN IF NOT EXISTS size_count_per_kg numeric(8,2);

-- 값 범위 — wqr_*_range 와 같은 패턴. 넉넉히 잡되 말이 안 되는 값은 막는다.
-- 1,000마리/kg = 개체 1 g 으로 치어 수준 하한, 1마리/kg = 1 kg 짜리 상한.
DO $$ BEGIN
  ALTER TABLE public.cycle_harvests ADD CONSTRAINT cycle_harvests_size_range
    CHECK (size_count_per_kg IS NULL OR (size_count_per_kg > 0 AND size_count_per_kg <= 1000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3) 칸 설명 ───────────────────────────────────────────────
COMMENT ON COLUMN public.cycle_harvests.channel IS
  '판매 채널. 2024년 실거래 중앙값 — wholesale 17,000 / retail_live 26,500 / retail_frozen 18,000 원/kg. 도매 대비 소매 활새우가 +56%(평가서 3-4). freezer 는 자가 냉동고 이동, sample 은 시료·증정으로 매출이 아닐 수 있다.';

COMMENT ON COLUMN public.cycle_harvests.size_count_per_kg IS
  '유통 규격(마리수/kg). NULL = 미기록. price_per_kg 와 짝으로 쌓이면 크기-단가 곡선의 재료가 된다 — 실데이터로는 앵커 1점(35미/kg @ 17,000원)뿐이어서 엔진 3이 막혀 있다(평가서 3-2).';

-- API 스키마 캐시 갱신 (이걸 빼먹으면 웹이 새 칸을 못 본다)
NOTIFY pgrst, 'reload schema';
