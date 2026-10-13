-- 무안군 담당자(지자체 확인용) 계정에 열람 권한 부여
--
-- 순서 (이 파일은 Supabase SQL Editor 에서 실행한다 — 사람 몫):
--   1) Supabase 대시보드 → Authentication → Users → Add user → Create new user
--      · Email: 담당자에게 전달할 계정용 이메일 (관리자가 받을 수 있는 주소)
--      · Password: 관리자가 직접 정한다 (채팅·저장소에 적지 않는다)
--      · "Auto Confirm User" 체크
--      가입 트리거(handle_new_user)가 profiles 행을 role='farmer' 로 만든다.
--   2) 아래 이메일을 실제 값으로 바꿔 실행한다.
--
-- 권한 선택
--   'manager' (권장) : 관제센터(/control) 열람 — 전체 양식장 지도·수질·상태.
--                      사용자 목록·진단(/admin)은 못 본다.
--   'admin'          : manager 권한 + /admin (전체 사용자 이메일·접속일 등) 열람.
--                      담당자에게는 필요 이상이다. 꼭 필요할 때만 쓴다.
--   총 관리자(매니저 선임·해임)는 role 이 아니라 이메일로 판별하므로
--   어느 쪽을 줘도 그 권한은 넘어가지 않는다.
--
-- 주의: role_farmer.sql 을 다시 실행하면 이 계정이 'farmer' 로 되돌아간다.

UPDATE public.profiles p
SET role = 'manager'            -- 필요하면 'admin' 으로
FROM auth.users u
WHERE u.id = p.id
  AND lower(u.email) = lower('여기에-담당자-계정-이메일');

-- 확인: 1행이 나오고 role 이 의도한 값이어야 한다.
--   SELECT u.email, p.role FROM public.profiles p
--   JOIN auth.users u ON u.id = p.id
--   WHERE lower(u.email) = lower('여기에-담당자-계정-이메일');

-- 회수(열람 종료): 같은 이메일로 role 을 'farmer' 로 되돌리거나 사용자를 삭제한다.
--   UPDATE public.profiles p SET role = 'farmer' FROM auth.users u
--   WHERE u.id = p.id AND lower(u.email) = lower('여기에-담당자-계정-이메일');
