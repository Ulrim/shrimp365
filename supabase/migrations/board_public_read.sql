-- ─────────────────────────────────────────────────────────────
-- 게시판 공개 열람: 비로그인(anon)도 글/댓글을 읽을 수 있게 허용.
-- (SEO 색인 + 다른 사용자 공개 읽기)  작성/수정/삭제는 여전히 로그인 필요.
-- ─────────────────────────────────────────────────────────────

-- 글: 누구나 열람
DROP POLICY IF EXISTS board_posts_select ON public.board_posts;
CREATE POLICY board_posts_select ON public.board_posts
  FOR SELECT TO anon, authenticated USING (true);

-- 댓글: 누구나 열람
DROP POLICY IF EXISTS board_comments_select ON public.board_comments;
CREATE POLICY board_comments_select ON public.board_comments
  FOR SELECT TO anon, authenticated USING (true);

-- 조회수 증가 RPC를 비로그인 방문자도 호출 가능하게
GRANT EXECUTE ON FUNCTION public.increment_post_view(uuid) TO anon;

-- (insert/update/delete 정책은 기존대로 authenticated 전용 — anon 쓰기 불가)
