-- ============================================================
-- 관제센터 권한
-- Supabase SQL Editor 에서 실행하세요.
--
-- 권한은 두 단계다.
--   · 총 관리자(admin)  — kjs100184@gmail.com 하나로 고정. 매니저를 선임·해임한다.
--   · 매니저(manager)   — 총 관리자가 선임. 관제센터를 볼 수 있지만 선임은 못 한다.
--
-- 판별은 전부 서버에서 한다. 화면의 역할 표시는 편의일 뿐이고,
-- 실제 데이터는 API 가 세션으로 역할을 확인한 뒤에만 내준다.
-- 자기 role 을 스스로 바꾸는 길은 security_hardening_profiles.sql 에서
-- 이미 막혀 있다(authenticated 는 name 컬럼만 UPDATE 가능).
-- ============================================================

-- 1) role 값을 다섯 가지로 제한한다.
--    지금까지 제약이 없어 어떤 문자열이든 들어갈 수 있었다.
--
--    CHECK 를 걸기 전에 기존 데이터를 먼저 정리한다. 허용값 밖의 role 이
--    하나라도 있으면 제약 추가가 통째로 실패하기 때문이다. NULL 이나
--    예상 밖 값은 기본값인 farmer(양식어가·최소 권한)로 되돌린다.
-- 예전에 컬럼 인라인으로 붙은 profiles_role_check 가 남아 있으면 farmer 를
-- 막으므로 함께 지운다(없어도 오류 안 남).
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_valid;

UPDATE public.profiles
SET role = 'farmer'
WHERE role IS NULL OR role NOT IN ('admin', 'manager', 'operator', 'viewer', 'farmer');

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_valid
    CHECK (role IN ('admin', 'manager', 'operator', 'viewer', 'farmer'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CHECK 는 role IS NULL 을 통과시킨다. 신규 행이 role 없이 들어오는 것을 막고
-- 기본값을 farmer(양식어가·최소 권한)로 고정한다.
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'farmer';
DO $$ BEGIN
  ALTER TABLE public.profiles ALTER COLUMN role SET NOT NULL;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'role 을 NOT NULL 로 바꾸지 못했습니다(%). 기존 NULL 이 남아 있는지 확인하세요.', SQLERRM;
END $$;

-- 2) 총 관리자 지정.
--    이메일로 계정을 찾아 role 을 admin 으로 올린다. 아직 가입 전이면
--    아무 일도 하지 않으므로, 가입 후 이 파일을 다시 실행하면 된다.
UPDATE public.profiles
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'kjs100184@gmail.com')
  AND role IS DISTINCT FROM 'admin';

DO $$
DECLARE
  found int;
BEGIN
  SELECT count(*) INTO found FROM auth.users WHERE email = 'kjs100184@gmail.com';
  IF found = 0 THEN
    RAISE NOTICE '아직 kjs100184@gmail.com 계정이 없습니다. 가입 후 이 파일을 다시 실행하세요.';
  ELSE
    RAISE NOTICE '총 관리자가 지정되었습니다: kjs100184@gmail.com';
  END IF;
END $$;
