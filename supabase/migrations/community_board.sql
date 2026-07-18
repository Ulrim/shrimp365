-- ─────────────────────────────────────────────────────────────
-- 커뮤니티 게시판 (글 + 댓글 + 이미지)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.board_posts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name text NOT NULL DEFAULT '',
  title       text NOT NULL,
  content     text NOT NULL DEFAULT '',
  image_url   text,
  view_count  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.board_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid NOT NULL REFERENCES public.board_posts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name text NOT NULL DEFAULT '',
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_board_posts_created  ON public.board_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_board_comments_post  ON public.board_comments(post_id, created_at);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.board_posts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_comments ENABLE ROW LEVEL SECURITY;

-- 글: 로그인 사용자 모두 열람, 본인만 작성/수정/삭제 (관리자는 모두 삭제 가능)
DROP POLICY IF EXISTS board_posts_select ON public.board_posts;
CREATE POLICY board_posts_select ON public.board_posts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS board_posts_insert ON public.board_posts;
CREATE POLICY board_posts_insert ON public.board_posts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS board_posts_update ON public.board_posts;
CREATE POLICY board_posts_update ON public.board_posts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS board_posts_delete ON public.board_posts;
CREATE POLICY board_posts_delete ON public.board_posts
  FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- 댓글: 동일 정책
DROP POLICY IF EXISTS board_comments_select ON public.board_comments;
CREATE POLICY board_comments_select ON public.board_comments
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS board_comments_insert ON public.board_comments;
CREATE POLICY board_comments_insert ON public.board_comments
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS board_comments_delete ON public.board_comments;
CREATE POLICY board_comments_delete ON public.board_comments
  FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- ── 조회수 증가 RPC (열람자 누구나 호출 가능) ────────────────
CREATE OR REPLACE FUNCTION public.increment_post_view(p_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.board_posts SET view_count = view_count + 1 WHERE id = p_id;
$$;

-- ── Storage: 게시판 이미지 버킷 ──────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('post-images', 'post-images', true)
ON CONFLICT (id) DO NOTHING;

-- 공개 읽기
DROP POLICY IF EXISTS post_images_read ON storage.objects;
CREATE POLICY post_images_read ON storage.objects
  FOR SELECT USING (bucket_id = 'post-images');

-- 로그인 사용자 업로드
DROP POLICY IF EXISTS post_images_insert ON storage.objects;
CREATE POLICY post_images_insert ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'post-images');

-- 본인이 올린 파일만 삭제
DROP POLICY IF EXISTS post_images_delete ON storage.objects;
CREATE POLICY post_images_delete ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'post-images' AND owner = auth.uid());
