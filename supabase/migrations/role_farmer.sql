-- 양식어가(farmer) 역할 추가 + 기존 사용자 역할 정리
--
-- 배경: 지금까지 신규 가입자가 모두 'operator'(운영자)로 들어가고 있었다.
-- 일반 사용자는 '양식어가'이고, 총관리자(오너)만 예외다.
--
-- 이 파일은 Supabase SQL Editor 에서 service_role 로 직접 실행한다(사람 몫).
-- profiles 에는 이메일이 없으므로 auth.users 와 id 로 이어 판별한다.

-- 1) role 허용값에 'farmer' 를 추가한다. (기존: admin/manager/operator/viewer)
--    profiles 에는 role 관련 CHECK 가 두 개 있을 수 있다:
--      · profiles_role_check  — 테이블 만들 때 컬럼에 인라인으로 붙은 원래 제약
--      · profiles_role_valid  — 이후 마이그레이션에서 따로 추가한 제약
--    둘 다 지우고 farmer 를 포함한 하나로 다시 만든다(둘 다 없어도 오류 안 남).
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_valid;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_valid
  CHECK (role IN ('admin', 'manager', 'operator', 'viewer', 'farmer'));

-- 2) 신규 가입 기본 역할을 양식어가로 바꾼다.
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'farmer';

-- 2-1) 신규 가입 트리거가 role 을 명시적으로 'operator' 로 넣고 있었다.
--      (이것이 "가입자가 다 운영자" 의 진짜 원인이다.) 'farmer' 로 바꾼다.
--      plan 은 기존대로 'free' 를 유지한다.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, plan, plan_expires_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'farmer',
    'free',
    NULL
  );
  RETURN NEW;
END;
$$;

-- 3) 총관리자(kjs100184@gmail.com)는 admin 으로 확정한다.
UPDATE public.profiles p
SET role = 'admin'
FROM auth.users u
WHERE u.id = p.id AND lower(u.email) = 'kjs100184@gmail.com';

-- 4) 그 외 모든 사용자를 양식어가로 바꾼다.
UPDATE public.profiles p
SET role = 'farmer'
FROM auth.users u
WHERE u.id = p.id AND lower(u.email) <> 'kjs100184@gmail.com';

-- 확인용(실행 후 결과를 눈으로 보고 싶을 때):
--   SELECT u.email, p.role FROM public.profiles p
--   JOIN auth.users u ON u.id = p.id ORDER BY p.role, u.email;
