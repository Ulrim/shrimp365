---
name: cardnews-publish
description: 완성된 Shrimp365 카드뉴스를 발행하는 방법 — 시드 SQL 마이그레이션 작성, DB 필드 제약, 커밋, 다국어 확장, SNS 업로드 인계. 카드 이미지와 문구가 준비된 뒤 실제로 게시할 때 사용한다. Use when publishing a finished Shrimp365 card news post — writing the seed SQL migration, committing, or handing off for SNS upload.
---

# 카드뉴스 발행

카드뉴스는 두 곳에 올라간다. **경로가 다르고, 자동화 수준도 다르다.**

| 대상 | 방법 | 누가 |
|---|---|---|
| 자사 사이트 `/cardnews/<slug>` | 시드 SQL을 Supabase에서 실행 | SQL은 에이전트가 작성, 실행은 사람 |
| 인스타그램·스레드 등 SNS | PNG 8장 업로드 | 사람 (API 연동 없음) |

## 발행 경로

이 저장소에서 카드뉴스를 DB에 넣는 길은 셋인데, 에이전트가 쓸 수 있는 건 하나다.

1. **시드 SQL 마이그레이션** ← 이걸 쓴다. `supabase/migrations/`에 커밋하면 리뷰가 남고 되돌리기 쉽다
2. `/cardnews/new` 관리자 폼 — 사람이 브라우저에서
3. `POST /api/cardnews` — 관리자 세션 쿠키가 필요하다. 에이전트는 못 쓴다

**DB 쓰기는 `SUPABASE_SERVICE_ROLE_KEY`가 필요하고 이 저장소에는 그 키가 없다.** `card_news` 테이블의 RLS는 `published = true`인 행의 익명 SELECT만 허용하고 쓰기 정책은 아예 없다.

## 시드 SQL

`supabase/migrations/card_news_seed_<slug>.sql`. 기존 `card_news_seed_ko.sql`을 그대로 따른다.

```sql
-- ============================================================
-- 카드뉴스 — <주제> (ko)
--
-- 이미지는 Storage가 아니라 앱의 정적 경로(/cardnews/…)를 쓴다.
-- 파일이 저장소 public/cardnews/ 에 있으므로 별도 업로드가 필요 없다.
--
-- 실행 조건: card_news.sql 을 먼저 실행해 테이블이 있어야 한다.
-- 재실행 안전: 같은 (slug, locale)이 있으면 내용을 덮어쓴다.
-- ============================================================

insert into public.card_news
  (slug, locale, title, summary, body, images, cover_url, tags, published, published_at)
values (
  $cn$my-slug$cn$,
  $cn$ko$cn$,
  $cn$제목$cn$,
  $cn$요약$cn$,
  $cn$본문…$cn$,
  array[$cn$/cardnews/my-slug/01.png$cn$, …]::text[],
  $cn$/cardnews/my-slug/01.png$cn$,
  array[$cn$수질관리$cn$, $cn$흰다리새우$cn$]::text[],
  true,
  now()
)
on conflict (slug, locale) do update set
  title        = excluded.title,
  summary      = excluded.summary,
  body         = excluded.body,
  images       = excluded.images,
  cover_url    = excluded.cover_url,
  tags         = excluded.tags,
  published    = excluded.published,
  published_at = excluded.published_at,
  updated_at   = now();
```

지켜야 할 것:

- **`$cn$…$cn$` 달러 인용.** 본문에 작은따옴표가 들어가므로 필수다. 본문에 `$cn$`이 나올 일은 없다
- **`on conflict (slug, locale) do update`** — 재실행 안전해야 한다. 유니크 인덱스가 `(slug, locale)`에 걸려 있다
- `images` 경로는 `/cardnews/<slug>/NN.png`. `npm run cardnews`가 마지막에 이 배열을 출력해 준다
- `cover_url`은 `images[0]`
- `view_count`·`like_count`는 넣지 않는다 (기본값 0). 재실행 시 조회수를 날리지 않도록 `do update`에서도 제외

### 필드 제약 — API와 동일하게 지킨다

SQL 경로는 `app/api/cardnews/route.ts`의 `normalize()`를 우회한다. 그래서 **직접 지켜야 한다.** 어기면 에러가 아니라 화면이 깨진다.

| 필드 | 제약 |
|---|---|
| `slug` | ≤80자, 영문 kebab-case |
| `locale` | `ko` `en` `vi` `id` 중 하나 |
| `title` | ≤200자 |
| `summary` | ≤300자 |
| `body` | ≤20,000자 |
| `images` | ≤30장. 각 항목은 `/`로 시작하거나 `https://`로 시작 (`isSafeUrl`) |
| `tags` | ≤12개, `#` 없이 |

## 커밋

```bash
git add public/cardnews/<slug> \
        scripts/cardnews/data/<slug>.json \
        supabase/migrations/card_news_seed_<slug>.sql
git commit -m "카드뉴스 — <주제>"
git push -u origin <작업브랜치>
```

- **PNG가 `git add`에 안 잡히면 `.gitignore`를 본다.** `*.png`가 전역으로 막혀 있고 `!public/cardnews/**/*.png`만 예외다
- 지정된 작업 브랜치 밖으로 푸시하지 않는다
- 푸시가 네트워크 오류로 실패하면 2s → 4s → 8s → 16s로 최대 4회 재시도

## "게시 완료"라고 말하지 마라

SQL을 커밋한 것은 발행이 아니다. 마지막 보고에 반드시 넣는다:

> `supabase/migrations/card_news_seed_<slug>.sql`을 Supabase SQL Editor에서 실행하셔야 사이트에 올라갑니다.
> 실행 후 `/cardnews`에 반영되기까지 최대 5분 걸립니다 (ISR `revalidate = 300`).

## 발행 후 확인 (사람이 실행한 뒤)

- `/cardnews` 목록에 새 글이 뜨는가
- `/cardnews/<slug>` 상세에서 카드 8장이 넘겨지는가
- OG 이미지·제목·설명이 맞는가 (`cover_url` 기준)
- `/sitemap.xml`에 들어갔는가

한국어 상세 페이지는 `locale !== 'ko'`이면 404다. 다른 언어는 `/[lang]/cardnews/<slug>`에 있다.

## 다국어 확장

**같은 `slug`에 다른 `locale`**로 행을 추가한다. 그래야 `hreflangMap()`이 언어 간 링크를 만든다.

- 이미지도 언어별로 따로 렌더한다 → `public/cardnews/<lang>/<slug>/NN.png`
- 번역이 아니라 현지 독자에게 맞게 다시 쓰되, **수치는 반드시 동일해야 한다**
- 기존 다국어 시드는 `card_news_seed_multilang.sql` 참고

## SNS 업로드

**이 저장소에 인스타그램·스레드·페이스북 API 연동은 없다.** 스케줄러도 크로스포스팅도 없다. 만들어 낸 척하지 않는다.

사람에게 넘길 것:

```
이미지: public/cardnews/<slug>/01.png … 08.png  (순서대로 8장)
캡션:   <summary>

        #태그1 #태그2 …
링크:   https://shrimp365.kr/cardnews/<slug>
```
