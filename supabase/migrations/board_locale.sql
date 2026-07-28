-- ============================================================
-- 게시판 언어 분리
--
-- 목적: 한국어 사용자에게는 한국어 글만, 영어 사용자에게는 영어 글만 보이게 한다.
--       작성자가 언어를 고르지 않아도 되도록, 글 저장 시 앱이 본문을 판별해
--       locale 값을 자동으로 채운다. 이 마이그레이션은 컬럼 추가 + 기존 글 백필.
--
-- 실행 위치: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. 컬럼 추가 ------------------------------------------------
alter table public.board_posts
  add column if not exists locale text not null default 'ko';

alter table public.board_posts
  drop constraint if exists board_posts_locale_check;
alter table public.board_posts
  add constraint board_posts_locale_check check (locale in ('ko','en','vi','id'));

-- 목록 조회는 항상 (locale, 최신순)이므로 복합 인덱스로 대체
create index if not exists idx_board_posts_locale_created
  on public.board_posts (locale, created_at desc);

-- 2. 기존 글 백필 ---------------------------------------------
-- 문자 체계로 판별한다. 한글/베트남어 성조 문자는 확실한 신호이고,
-- 영어와 인도네시아어는 문자가 같으므로 인도네시아어 고빈도 단어로 구분한다.
update public.board_posts
set locale = case
  -- 한글 음절이 하나라도 있으면 한국어
  when (title || ' ' || content) ~ '[가-힣]' then 'ko'
  -- 베트남어 고유 문자(성조 포함)
  when (title || ' ' || content) ~* '[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]' then 'vi'
  -- 인도네시아어 고빈도 기능어
  when (' ' || lower(title || ' ' || content) || ' ') ~ ' (yang|dan|untuk|tidak|dengan|adalah|saya|ini|itu|dari|akan|sudah|bisa|udang|tambak) ' then 'id'
  -- 라틴 문자만 있고 위 조건에 모두 해당하지 않으면 영어
  when (title || ' ' || content) ~ '[A-Za-z]' then 'en'
  else 'ko'
end;

-- 3. 참고 -----------------------------------------------------
-- RLS 정책은 그대로 둔다. 언어 필터링은 애플리케이션 질의(.eq('locale', …))에서
-- 수행한다 — 정책으로 막으면 사용자가 언어를 바꿨을 때 본인 글이 사라져 혼란스럽다.
