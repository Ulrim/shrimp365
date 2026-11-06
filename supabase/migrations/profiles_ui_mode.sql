-- 계정 기본 화면 모드(profiles.ui_mode) — 설계서 docs/plans/mode-split.md 2-1
--
-- 양식장(shrimp) / 스마트팜(agriculture) 두 모드 중 이 계정이 로그인 뒤 어느
-- 화면으로 착지하는가를 저장한다. 전환 스위치가 이 값을 갱신한다.
-- 렌더링 판정은 계속 URL(/daumlabs/**)이 하고, 이 컬럼은 착지와 저장값 둘만 맡는다.
--
-- 이 파일은 Supabase SQL Editor 에서 실행한다(사람 몫). 실행 전에도 웹은
-- 동작한다 — fetchProfile 이 컬럼 부재를 만나면 'shrimp' 로 보고, 전환 저장은
-- 경고만 남기고 넘어간다(화면 이동은 그대로 된다).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ui_mode TEXT NOT NULL DEFAULT 'shrimp';
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_ui_mode_check
    CHECK (ui_mode IN ('shrimp', 'agriculture'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- 기존 농업 전용 계정은 농업 모드로 시작하게 한다(농장이 전부 agriculture 인 사용자).
UPDATE public.profiles p SET ui_mode = 'agriculture'
WHERE EXISTS (SELECT 1 FROM public.farms f WHERE f.user_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM public.farms f WHERE f.user_id = p.id AND f.farm_type <> 'agriculture');
-- API 스키마 캐시 갱신 (이걸 빼먹으면 웹이 새 컬럼을 못 본다)
NOTIFY pgrst, 'reload schema';
