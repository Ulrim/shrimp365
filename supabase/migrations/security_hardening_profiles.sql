-- ─────────────────────────────────────────────────────────────
-- 보안 강화: profiles 권한 상승(role/plan 자가 변경) 차단
--
-- 문제: profiles_update_own 정책이 행(본인)만 제한하고 컬럼은 제한하지 않아,
--       로그인한 아무 사용자나 브라우저 콘솔에서
--       supabase.from('profiles').update({ role:'admin' }) 를 실행해
--       관리자로 승격 → /api/admin/stats 등으로 전체 사용자 PII 유출 가능.
--
-- 해결: authenticated/anon 롤의 profiles UPDATE 권한을 회수하고,
--       name 컬럼에 대해서만 UPDATE 를 다시 부여한다.
--       (service_role 은 GRANT 제약을 받지 않으므로 관리 작업은 정상 동작)
-- ─────────────────────────────────────────────────────────────

REVOKE UPDATE ON public.profiles FROM authenticated;
REVOKE UPDATE ON public.profiles FROM anon;

-- 일반 사용자는 표시 이름만 수정 가능
GRANT UPDATE (name) ON public.profiles TO authenticated;

-- 방어 심화: 업데이트 후 행도 반드시 본인 소유여야 함 (WITH CHECK 추가)
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ── 조회수 RPC 보안 보완: search_path 고정 (SECURITY DEFINER 함수 권장사항) ──
CREATE OR REPLACE FUNCTION public.increment_post_view(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.board_posts SET view_count = view_count + 1 WHERE id = p_id;
$$;
