-- 신규 가입자에게 Pro 3개월 무료 체험 자동 부여
-- 기존 트리거 함수 교체
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, plan, plan_expires_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'operator',
    'pro',
    NOW() + INTERVAL '3 months'
  );
  RETURN NEW;
END;
$$;
