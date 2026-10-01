-- 성장 샘플의 표본수·총중량을 nullable 로 완화
--
-- 배경: growth_samples(production_management.sql:28)는 sample_count 와
--   total_weight_g 를 NOT NULL 로 받는다. 그런데 천황수산 실데이터의 성장
--   관측 78건에는 **개체중(body_weight_g)만** 있고 표본수·총중량이 없다
--   (평가서 6절 F-5).
--
--   NOT NULL 을 그대로 두면 이 데이터를 넣으려는 사람은 둘 중 하나를 한다 —
--   **데이터를 포기하거나, 값을 지어낸다.** 후자가 일어나는 순간 이 데이터셋의
--   가장 큰 미덕(빈칸을 0으로 채우지 않고 가상관측을 넣지 않음, 평가서 1-2)이
--   우리 DB 에 들어오면서 사라진다. 그리고 지어낸 표본수는 생존율 계산에
--   그대로 흘러들어가 조용히 틀린 숫자를 만든다. 제약을 완화하는 쪽이 맞다
--   (평가서 6-2).
--
-- **abw_g 는 건드리지 않는다.** 실데이터의 body_weight_g 가 그대로 ABW 로
--   들어가므로 NOT NULL 유지가 맞고, 범위도 넓히지 않는다. ABW 가 없는
--   성장 샘플은 성장 샘플이 아니다 — 엔진 1이 보는 값이 이것뿐이다(평가서 2-6).
--
-- 실행 순서: 이 배치의 5번. 다른 파일과 독립이다.
-- 재실행 안전(이미 nullable 이면 아무 일도 하지 않는다).
-- Supabase SQL Editor 에서 실행한다(사람 몫).
--
-- ⚠ 앱 쪽은 아직 표본수를 요구한다 — lib/db.ts 의 createGrowthSample 이
--   sample_count 로 abw_g 를 나눠 구하고 1 이상을 강제한다. 개체중만 있는
--   데이터를 **웹 폼으로** 넣으려면 그 경로도 고쳐야 한다. 이번 작업은 스키마만
--   열어 두고(= 반입 스크립트·SQL 로는 바로 넣을 수 있다), 앱 작업은 별건이다.

ALTER TABLE public.growth_samples
  ALTER COLUMN sample_count   DROP NOT NULL;

ALTER TABLE public.growth_samples
  ALTER COLUMN total_weight_g DROP NOT NULL;

COMMENT ON COLUMN public.growth_samples.sample_count IS
  '표본 마리수. NULL 허용 — 개체중만 기록된 관측이 실제로 있다(천황수산 78건). 모르는 값을 지어내 채우지 말 것.';

COMMENT ON COLUMN public.growth_samples.total_weight_g IS
  '표본 총중량(g). NULL 허용 — 개체중만 기록된 관측이 있다. abw_g 가 주 값이고 이 칸은 그 근거일 뿐이다.';

COMMENT ON COLUMN public.growth_samples.abw_g IS
  '개체 평균중량(g). NOT NULL 유지 — 엔진 1(성장곡선)이 보는 유일한 값이고, 이것이 없는 행은 성장 관측이 아니다. 유통 규격에서 역산된 개체중(production_events.weight_g_per_shrimp)을 여기 넣지 말 것(평가서 3-3).';

-- API 스키마 캐시 갱신 (제약이 바뀐 것을 웹이 알아야 한다)
NOTIFY pgrst, 'reload schema';
