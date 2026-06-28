-- 신규 가입자 기본 플랜 'free'로 변경
-- 이전: plan='pro', plan_expires_at=NULL (영구 Pro)
-- 이후: plan='free', plan_expires_at=NULL (광고 기반 무료 서비스)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, plan, plan_expires_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'operator',
    'free',
    NULL
  );
  RETURN NEW;
END;
$$;
