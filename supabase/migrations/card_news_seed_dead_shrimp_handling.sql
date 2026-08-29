-- ============================================================
-- 카드뉴스 — 폐사체 처리와 방역 (ko) · 2026-08-26
--
-- 이미지: public/cardnews/dead-shrimp-handling/01..08.png
--
-- 실행 조건: card_news.sql 을 먼저 실행해 테이블이 있어야 한다.
-- 재실행 안전: 같은 (slug, locale)이 있으면 내용을 덮어쓴다.
--              published_at 은 갱신하지 않는다 — 조회수·좋아요도 그대로다.
-- ============================================================

insert into public.card_news
  (slug, locale, title, summary, body, images, cover_url, tags, published, published_at)
values (
  $cn$dead-shrimp-handling$cn$,
  $cn$ko$cn$,
  $cn$흰다리새우 폐사체 관리 — 건져내는 게 방역입니다$cn$,
  $cn$죽은 새우를 산 새우가 먹으면서 병이 퍼집니다. 매일 아침 수거, 마릿수 기록, 하루 1% 경보선, 양식장 밖 매립, 수조별 전용 도구까지 방역의 기본을 정리했습니다.$cn$,
  $cn$폐사가 조금씩 있는 것은 어느 양식장에나 있습니다. 그래서 대수롭지 않게 넘기기 쉽습니다. 하지만 죽은 새우를 그대로 두는 것은 병을 키우는 가장 빠른 방법입니다.

■ 왜 그날 안에 치워야 하는가

새우는 죽은 동료를 먹습니다. 병으로 죽은 개체라면 그 안에 병원체가 가득합니다. 그걸 먹은 개체가 다시 감염되고, 다시 죽고, 다시 먹힙니다.

흰반점병처럼 전파가 빠른 병에서 이 경로가 결정적입니다. 며칠 사이에 양식장 전체로 번지는 이유가 여기에 있습니다.

부패 자체도 문제입니다. 유기물이 분해되면서 산소를 쓰고 암모니아를 만듭니다. 병에 걸린 새우에게 그 물은 더 나쁩니다.

■ 언제 보는가

매일 아침입니다. 순찰할 때 물가와 수차 주변, 배수구 쪽을 함께 보십시오. 죽은 개체는 대개 물 흐름을 따라 한쪽에 모입니다.

바닥에 가라앉은 개체는 보이지 않습니다. 그래서 눈에 보이는 폐사만으로 전체를 판단하면 항상 과소평가합니다. 먹이대를 들어 올릴 때 함께 확인하십시오.

■ 세는 것이 치우는 것만큼 중요합니다

건져낸 마릿수를 매일 적으십시오. 이게 가장 값싼 진단 도구입니다.

하루 몇 마리씩 꾸준한 폐사는 대개 자연 폐사나 탈피 실패입니다. 반면 어제 5마리에서 오늘 40마리로 뛰었다면 무언가가 시작된 것입니다. 숫자가 아니라 변화가 신호입니다.

경보선은 하루 1%로 잡으십시오. 추정 사육 마릿수의 1%를 넘는 날이 나오면 그날부터 원인을 찾습니다. 수질값을 재고, 죽은 개체의 몸 색과 껍질, 중장선을 살피고, 아가미를 봅니다.

■ 어디에 버리는가

양식장 밖으로 내보내 깊이 묻거나 소각합니다.

물가나 둑에 쌓아 두면 비가 올 때 그대로 다시 들어옵니다. 새나 들짐승이 옮기기도 합니다. 다른 수조 근처에 두는 것도 안 됩니다. 배수로에 버리는 것은 이웃 양식장까지 위험하게 만듭니다.

■ 도구는 수조마다 따로

가장 자주 놓치는 부분입니다.

뜰채와 장화, 양동이를 수조 사이에 그대로 돌려 쓰면 사람이 병을 옮기게 됩니다. 수조별로 전용 도구를 두거나, 옮길 때마다 소독하십시오. 발판 소독조를 두는 것도 방법입니다.

한 수조에서 병이 났을 때 나머지를 지키는 것은 이 습관입니다.

■ 기록이 다음을 바꿉니다

날짜별 폐사 마릿수를 수온, 산소, 급이량과 나란히 놓으면 원인이 드러나는 경우가 많습니다. "환수한 다음 날마다 늘었다"거나 "수온이 28 ℃로 내려온 주에 시작됐다" 같은 것들입니다.

이 연결은 기억으로는 만들어지지 않습니다. 적어야 보입니다.

■ 죽은 개체가 알려 주는 것

건져낸 새우를 그냥 버리지 말고 잠깐 보십시오. 원인을 짚는 가장 빠른 방법입니다.

몸이 붉게 변했는지, 껍질 안쪽에 흰 점이 있는지, 중장선이 비었는지, 아가미가 검게 변했는지. 몸이 물러 껍질이 벗겨지는 개체가 많다면 탈피 실패를 의심합니다.

빈 껍질만 많고 사체가 적다면 그건 폐사가 아니라 탈피입니다. 이 둘을 구분하지 못하면 없는 사고를 쫓게 됩니다.

Shrimp365는 폐사 마릿수와 수질을 날짜별로 함께 기록해 그 연결을 남겨 드립니다. 무료로 사용하실 수 있습니다.$cn$,
  array[
    $cn$/cardnews/dead-shrimp-handling/01.png$cn$, $cn$/cardnews/dead-shrimp-handling/02.png$cn$,
    $cn$/cardnews/dead-shrimp-handling/03.png$cn$, $cn$/cardnews/dead-shrimp-handling/04.png$cn$,
    $cn$/cardnews/dead-shrimp-handling/05.png$cn$, $cn$/cardnews/dead-shrimp-handling/06.png$cn$,
    $cn$/cardnews/dead-shrimp-handling/07.png$cn$, $cn$/cardnews/dead-shrimp-handling/08.png$cn$
  ]::text[],
  $cn$/cardnews/dead-shrimp-handling/01.png$cn$,
  array[
    $cn$폐사$cn$, $cn$질병관리$cn$, $cn$방역$cn$, $cn$흰다리새우$cn$,
    $cn$새우양식$cn$, $cn$양식장관리$cn$
  ]::text[],
  true,
  $cn$2026-08-26 09:00:00+09$cn$::timestamptz
)
on conflict (slug, locale) do update set
  title      = excluded.title,
  summary    = excluded.summary,
  body       = excluded.body,
  images     = excluded.images,
  cover_url  = excluded.cover_url,
  tags       = excluded.tags,
  published  = excluded.published,
  updated_at = now();
