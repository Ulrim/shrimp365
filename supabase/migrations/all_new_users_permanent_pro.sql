-- 신규 가입자 영구 Pro 부여 (만료일 없음)
-- 기존 3개월 체험 → 영구 Pro로 전환
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, plan, plan_expires_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'operator',
    'pro',
    NULL
  );
  RETURN NEW;
END;
$$;

-- 기존 가입자 중 plan_expires_at이 설정된 Pro 사용자도 영구 Pro로 전환
UPDATE public.profiles
SET plan_expires_at = NULL
WHERE plan = 'pro'
  AND plan_expires_at IS NOT NULL;
