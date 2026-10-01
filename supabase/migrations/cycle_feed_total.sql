-- FCR 산출 경로 복구 — total_feed_kg 컬럼 + 일지-사이클 연결 + 합산 함수
--
-- ── 문제 ─────────────────────────────────────────────────────
-- production_cycles.total_feed_kg 가 **마이그레이션에 없다.** types/index.ts:213
-- 과 lib/mock-data.ts 에만 있는 유령 칸이다. 그래서
-- app/(dashboard)/production/page.tsx:343 의 FCR 이
--
--     cycle.total_feed_kg ? (cycle.total_feed_kg / totalHarvestKg) : null
--
-- 이므로 **실계정에서는 항상 null** 이고 목업 계정에서만 숫자가 나온다.
-- 화면에 FCR 칸이 있는데 진짜 사용자에게는 영원히 '—' 로 보인다.
--
-- ── 왜 컬럼만 추가해서는 안 채워지는가 ───────────────────────
-- 급이량은 journal_entries.feeding_amount(새우 모드 kg/일)에 쌓인다. 그걸 사이클
-- 기간으로 합산해야 total_feed_kg 가 되는데, **journal_entries 에는 cycle_id 가
-- 없다.** growth_samples·cycle_costs·cycle_harvests 셋은 cycle_id 를 가지고 있어
-- 설계가 어긋나 있다. 일지만 사이클과 끊어져 있다.
--
-- ── 판단: 컬럼 + 함수 둘 다 둔다. 뷰는 쓰지 않는다 ───────────
-- 셋을 비교했다.
--
--   ① 생성 컬럼(GENERATED ALWAYS AS) — **불가능하다.** Postgres 의 생성 컬럼은
--      같은 행의 다른 칸만 참조할 수 있고 다른 테이블을 합산할 수 없다.
--
--   ② 뷰 — 계산은 깔끔하지만 **이번 작업에서 쓸 수 없다.** 웹은
--      lib/db.ts 의 getProductionCycles 가 production_cycles 를
--      `select("*, tanks(...)")` 로 읽는다. 뷰에 만든 칸은 그 `*` 에 안 들어오므로
--      앱 코드를 고쳐야 하는데, 이번 작업은 스키마만 손대기로 했다.
--      (추가로 뷰는 PG15 미만에서 security_invoker 를 못 써 RLS 를 우회할 위험이
--      있다. 소유자 권한으로 도는 뷰를 만드는 것은 이 저장소의 선을 넘는다.)
--
--   ③ 트리거로 캐시 컬럼 유지 — 거부한다. journal_entries 의 insert/update/delete
--      셋에 트리거를 달아야 하고, 아래 cycle_id 백필이 끝나기 전에는 **틀린 합계를
--      조용히 써 넣는다.** 움직이는 부품을 늘려 틀린 값을 자동 생산하는 구조다.
--
-- 그래서 **역할을 나눈다** —
--   • total_feed_kg 컬럼 = **사람이 아는 값**(종이 장부 이관, 일괄 반입, 보정).
--     add_initial_weight_to_cycles.sql·add_pl_species.sql 과 같은 방식의 단순
--     nullable 컬럼이라 `select("*")` 에 그대로 실려 앱 수정 없이 FCR 이 살아난다.
--   • cycle_feed_summary() 함수 = **일지에서 합산한 값**(파생). wq_series 와 같은
--     SECURITY INVOKER sql 함수라 RLS 가 그대로 적용된다.
--
-- 어느 쪽이 이기는가 — **수동 입력값(컬럼)이 먼저다.** 즉 앱은 나중에
--   COALESCE(total_feed_kg, 함수값) 로 읽어야 한다. 이유: 일지 합산은 그 사이클의
--   모든 날짜가 cycle_id 로 연결됐을 때만 완전하고, 일부만 연결되면 **실제보다
--   작은 합계**가 나온다. 급이량이 작게 잡히면 FCR 이 실제보다 좋아 보인다 —
--   오차가 농장에 유리한 방향으로 기울어 아무도 의심하지 않는다. 그래서 함수는
--   합계와 함께 **연결된 일지 일수**를 돌려주고, 화면은 그 일수를 보여 주고 나서
--   숫자를 믿게 해야 한다.
--
-- 실행 순서: 이 배치의 6번. 다른 파일과 독립이다.
-- 전부 재실행 안전(멱등)이고 전부 추가(additive)다 — 기존 값을 쓰거나 지우는
-- 구문은 없다. Supabase SQL Editor 에서 실행한다(사람 몫).

-- ── 1) total_feed_kg 컬럼 ────────────────────────────────────
-- NULL = 미입력. 0 으로 채우지 않는다 — 급이 0 kg 과 미입력은 다른 사건이고,
-- 0 을 넣으면 FCR 이 0 으로 계산돼 화면에 거짓 숫자가 뜬다.
ALTER TABLE public.production_cycles
  ADD COLUMN IF NOT EXISTS total_feed_kg numeric;

DO $$ BEGIN
  ALTER TABLE public.production_cycles ADD CONSTRAINT production_cycles_total_feed_kg_range
    CHECK (total_feed_kg IS NULL OR total_feed_kg >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.production_cycles.total_feed_kg IS
  '사이클 누적 급이량(kg). 사람이 아는 값을 적는 칸이다(장부 이관·일괄 반입·보정). NULL = 미입력이며 0 과 구분한다. 일지에서 자동 합산한 값은 cycle_feed_summary() 가 돌려준다 — 둘이 다르면 이 칸이 우선이다.';

-- ── 2) journal_entries.cycle_id ──────────────────────────────
-- nullable 이다. 사이클 밖의 일지(수조 정비 기간 등)가 정상적으로 존재한다.
-- 사이클을 지워도 일지는 남긴다 — 일지는 그날 실제로 한 일의 기록이고
-- 사이클은 그 위의 묶음일 뿐이다. 그래서 CASCADE 가 아니라 SET NULL.
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.production_cycles(id) ON DELETE SET NULL;

-- 당분간 대부분 NULL 이므로 부분 인덱스로 둔다(add_perf_constraints.sql 패턴).
CREATE INDEX IF NOT EXISTS idx_journal_entries_cycle
  ON public.journal_entries(cycle_id)
  WHERE cycle_id IS NOT NULL;

COMMENT ON COLUMN public.journal_entries.cycle_id IS
  '소속 생산 사이클. nullable — 사이클 밖의 일지가 있고, 자동 백필을 하지 않으므로 기존 행은 전부 NULL 이다. 수조+날짜로 추정해 넣지 말 것(사이클이 겹치거나 비는 구간에서 잘못 붙는다).';

-- 일지 쓰기 정책을 다시 만든다. USING 조건은 schema.sql 의 je_all_own 과
-- **글자 그대로 같다** — 기존 동작은 바뀌지 않는다. WITH CHECK 만 명시해
-- 새로 생긴 cycle_id 가 남의 사이클을 가리키지 못하게 막는다. USING 만 두면
-- 쓰기 때 cycle_id 는 검사되지 않아, 남의 사이클 id 를 적어 넣을 수 있다.
-- (읽기 권한이 새지는 않지만, 남의 id 가 섞인 일지는 급이 합산을 오염시킨다.)
DROP POLICY IF EXISTS "je_all_own" ON public.journal_entries;
CREATE POLICY "je_all_own" ON public.journal_entries FOR ALL
  USING (tank_id IN (
    SELECT t.id FROM public.tanks t
    JOIN public.farms f ON f.id = t.farm_id
    WHERE f.user_id = auth.uid()
  ))
  WITH CHECK (
    tank_id IN (
      SELECT t.id FROM public.tanks t
      JOIN public.farms f ON f.id = t.farm_id
      WHERE f.user_id = auth.uid()
    )
    AND (cycle_id IS NULL OR cycle_id IN (
      SELECT c.id FROM public.production_cycles c WHERE c.user_id = auth.uid()
    ))
  );

-- ── 3) 일지 급이 합산 함수 ───────────────────────────────────
-- SECURITY INVOKER(기본)라 RLS 가 그대로 적용된다 — 자기 일지만 합산된다
-- (wq_series.sql 과 같은 원칙).
--
-- 합계가 **0 이 아니라 NULL** 로 나오는 경우가 있다: 연결된 일지가 한 건도
-- 없을 때다. 연결된 일지가 없는 것과 급이 0 kg 은 다른 사건이므로 구분한다
-- (평가서 1-2 의 원칙 — 빈칸을 0 으로 채우지 않는다).
--
-- linked_days 는 "이 사이클에 연결된 일지가 며칠치인가"다. 사이클 기간보다
-- 훨씬 적으면 합계를 믿어서는 안 된다. 화면은 이 숫자를 함께 보여 준다.
DROP FUNCTION IF EXISTS public.cycle_feed_summary(uuid);

CREATE FUNCTION public.cycle_feed_summary(p_cycle uuid)
RETURNS TABLE (
  total_feed_kg numeric,
  linked_days   int
)
LANGUAGE sql STABLE AS $$
  SELECT SUM(j.feeding_amount)::numeric, COUNT(*)::int
  FROM public.journal_entries j
  WHERE j.cycle_id = p_cycle
$$;

-- 로그인 사용자만 쓰면 된다(어차피 RLS 로 자기 일지만 합산된다).
REVOKE ALL ON FUNCTION public.cycle_feed_summary(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cycle_feed_summary(uuid) TO authenticated;

COMMENT ON FUNCTION public.cycle_feed_summary(uuid) IS
  'journal_entries.feeding_amount(새우 모드 kg/일)를 cycle_id 로 합산한다. 연결된 일지가 없으면 total_feed_kg 가 NULL — 0 과 구분한다. linked_days 가 사이클 기간보다 짧으면 합계는 과소추정이고, 과소추정된 급이량은 FCR 을 실제보다 좋게 보이게 한다.';

-- ── 4) cycle_id 백필 — **여기서는 실행하지 않는다** ──────────
-- 자동 백필을 넣지 않는 이유: 한 수조에서 사이클이 **겹치거나 비는 구간**이
-- 있으면 tank_id + 날짜 범위로는 잘못 붙는다. 그리고 잘못 붙은 일지는 FCR 을
-- 틀린 값으로 만들면서 화면에는 정상적인 숫자로 보인다 — 발견되지 않는 오류다.
-- 그래서 아래는 **전부 주석이다.** 사람이 ① 로 확인한 뒤 ③ 을 수조 하나씩
-- 직접 돌린다.
--
-- ─ ① 먼저 겹침을 확인한다. 행이 나오는 수조는 자동 백필 금지 대상이다.
--
--   SELECT a.tank_id,
--          a.id AS cycle_a, a.name AS name_a,
--          a.stocking_date AS a_start,
--          COALESCE(a.actual_harvest_date, a.target_harvest_date, CURRENT_DATE) AS a_end,
--          b.id AS cycle_b, b.name AS name_b,
--          b.stocking_date AS b_start,
--          COALESCE(b.actual_harvest_date, b.target_harvest_date, CURRENT_DATE) AS b_end
--     FROM public.production_cycles a
--     JOIN public.production_cycles b
--       ON b.tank_id = a.tank_id
--      AND b.id > a.id
--    WHERE daterange(a.stocking_date,
--                    COALESCE(a.actual_harvest_date, a.target_harvest_date, CURRENT_DATE), '[]')
--       && daterange(b.stocking_date,
--                    COALESCE(b.actual_harvest_date, b.target_harvest_date, CURRENT_DATE), '[]')
--    ORDER BY a.tank_id, a_start;
--
-- ─ ② 어느 수조에 미연결 일지가 얼마나 쌓여 있는지 본다.
--
--   SELECT j.tank_id, COUNT(*) AS unlinked_days,
--          MIN(j.date) AS first_date, MAX(j.date) AS last_date
--     FROM public.journal_entries j
--    WHERE j.cycle_id IS NULL
--    GROUP BY j.tank_id
--    ORDER BY unlinked_days DESC;
--
-- ─ ③ ① 에서 겹침이 없다고 확인된 수조만, **한 번에 한 수조씩** 붙인다.
--     tank_id 를 직접 적는다. WHERE 절에서 수조를 빼고 전체를 한 번에 돌리지 말 것.
--     (겹치는 사이클이 있으면 아래 조인은 둘 중 하나를 임의로 고른다 —
--      그게 ① 을 먼저 해야 하는 이유다.)
--
--   UPDATE public.journal_entries j
--      SET cycle_id = c.id
--     FROM public.production_cycles c
--    WHERE j.cycle_id IS NULL
--      AND c.tank_id = j.tank_id
--      AND j.date >= c.stocking_date
--      AND j.date <= COALESCE(c.actual_harvest_date, c.target_harvest_date, CURRENT_DATE)
--      AND j.tank_id = '여기에-수조-uuid'::uuid;
--
-- ─ ④ 붙인 뒤 합계를 눈으로 확인한다. linked_days 가 사이클 기간과 맞는지 본다.
--
--   SELECT c.id, c.name, c.stocking_date, s.total_feed_kg, s.linked_days
--     FROM public.production_cycles c,
--          LATERAL public.cycle_feed_summary(c.id) s
--    WHERE c.tank_id = '여기에-수조-uuid'::uuid
--    ORDER BY c.stocking_date;

-- API 스키마 캐시 갱신 (이걸 빼먹으면 웹이 새 칸·새 함수를 못 본다)
NOTIFY pgrst, 'reload schema';
