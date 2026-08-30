-- ============================================================
-- 카드뉴스 — 비브리오 관리 (ko) · 2026-08-09
--
-- 이미지는 Storage가 아니라 앱의 정적 경로(/cardnews/…)를 사용한다.
-- 파일은 저장소 public/cardnews/vibrio-monitoring/ 에 포함되어 있다.
--
-- 실행 조건: card_news.sql 을 먼저 실행해 테이블이 있어야 한다.
-- 재실행 안전: 같은 (slug, locale)이 있으면 내용을 덮어쓴다.
--              published_at 은 갱신하지 않는다 — 조회수·좋아요도 그대로다.
--
-- 게시 보류: 사용자 요청으로 이 편은 공개하지 않는다.
-- published 를 false 로 두었으므로 이 파일을 실행해도 노출되지 않는다.
-- 나중에 공개하려면 아래 published 값을 true 로 바꾸거나
--   update public.card_news set published = true where slug = 'vibrio-monitoring';
-- 를 실행한다.
-- ============================================================

insert into public.card_news
  (slug, locale, title, summary, body, images, cover_url, tags, published, published_at)
values (
  $cn$vibrio-monitoring$cn$,
  $cn$ko$cn$,
  $cn$비브리오 관리 — 밤에 물이 빛나고 있다면$cn$,
  $cn$비브리오는 없앨 수 있는 균이 아니라 수를 관리하는 균입니다. 총 비브리오 10³ CFU/mL 기준과 초록 집락의 의미, 발광 현상이 알려 주는 것을 정리했습니다.$cn$,
  $cn$밤에 양식장에 나갔는데 물이 푸르스름하게 빛나 보인 적이 있다면, 그것은 발광 비브리오입니다. 이미 상당히 늘어난 상태라는 뜻이기도 합니다.

■ 없애는 균이 아니라 세는 균입니다

비브리오는 바닷물에 원래 있는 균입니다. 양식장에서 완전히 없앨 수 없고, 없애는 것이 목표도 아닙니다.

문제는 수입니다. 평소에 적은 수로 있을 때는 아무 일도 일어나지 않다가, 조건이 맞아 급격히 늘면 병이 됩니다. 그래서 비브리오는 있느냐 없느냐가 아니라 얼마나 있느냐로 봅니다.

■ 기준 — 10³ CFU/mL

물 1 mL에 들어 있는 총 비브리오 수로 판단합니다.

10² CFU/mL 아래면 안전 구간입니다. 10²에서 10³ 사이는 경고 구간으로, 이때부터 대응을 시작해야 합니다. 10³을 넘으면 위험 구간이고 감염 위험이 뚜렷하게 올라갑니다.

측정은 TCBS라는 배지에 물을 배양해 집락 수를 세는 방식입니다. 지자체 수산 관련 기관이나 사료 회사 기술지원팀에서 받을 수 있는 경우가 많으니 확인해 보십시오.

■ 초록 집락이 더 위험합니다

TCBS 배지에서 비브리오는 노란색이나 초록색 집락으로 자랍니다. 색이 갈리는 이유는 당을 분해하는 능력의 차이인데, 실무에서는 색으로 위험도를 나눕니다.

초록 집락 쪽이 더 위험합니다. 그래서 총 수가 같아도 초록의 비율이 높으면 더 나쁜 상황으로 봅니다. 검사 결과를 받을 때 총 수만 보지 말고 색 구성을 함께 확인하십시오.

■ 발광은 유기물 신호입니다

물이 빛나는 것은 발광 비브리오가 늘었다는 뜻이고, 그 균이 늘었다는 것은 먹을 것이 많다는 뜻입니다. 바닥에 쌓인 유기물(사료 찌꺼기와 배설물 같은 것)이 그 먹이입니다.

그래서 발광을 봤을 때 먼저 봐야 할 것은 약이 아니라 바닥과 급이량입니다. 안 먹은 사료가 남고 있지 않은지, 바닥에 찌꺼기가 쌓여 있지 않은지 확인하십시오. 원인을 두고 균만 잡으면 며칠 뒤에 다시 늘어납니다.

■ 여름에 빨라집니다

비브리오는 수온이 올라갈수록 증식 속도가 빨라집니다. 고수온기에 비브리오 관련 사고가 몰리는 이유입니다.

같은 시기에 새우 쪽 사정도 나빠집니다. 34℃를 넘나드는 물에서 새우는 이미 부담을 받고 있고, 33℃가 여러 날 이어지면 간췌장(사람의 간에 해당하는 소화 기관)이 상합니다. 균은 빨리 늘고 새우의 방어는 약해지는 시기가 겹칩니다.

■ 흔한 소견

먹이 반응이 떨어지고, 껍질이 무르고, 몸이 붉게 보이는 개체가 늘어납니다. 폐사가 하루아침에 몰리기보다 며칠에 걸쳐 조금씩 늘어나는 형태가 많습니다.

여기서 급이량 기록이 있으면 판단이 빨라집니다. 사료 섭취량이 며칠째 줄고 있었다면 그 시점이 시작점입니다.

■ 막는 법은 환경입니다

바닥을 덜 더럽히고, 사료를 남기지 않고, 산소를 유지하고, 수온 변동을 줄이는 것. 비브리오 관리라고 부르는 것의 실체는 결국 이 네 가지입니다.

특별한 조치처럼 들리지 않지만, 균 수를 실제로 내리는 것은 이쪽입니다. 소독은 그때 수를 줄일 뿐 조건을 바꾸지 못합니다.

■ 기록이 기준보다 중요합니다

검사를 매주 받기 어렵다면 최소한 급이 섭취량·수온·바닥 상태를 매일 적으십시오. 비브리오가 늘어나는 조건은 이 기록에 먼저 나타납니다. 검사 결과는 그것을 확인해 주는 자료입니다.

Shrimp365는 수온과 급이량, 폐사를 함께 기록해 병이 들어올 조건을 미리 볼 수 있게 해 드립니다. 무료로 사용하실 수 있습니다.$cn$,
  array[
    $cn$/cardnews/vibrio-monitoring/01.png$cn$, $cn$/cardnews/vibrio-monitoring/02.png$cn$,
    $cn$/cardnews/vibrio-monitoring/03.png$cn$, $cn$/cardnews/vibrio-monitoring/04.png$cn$,
    $cn$/cardnews/vibrio-monitoring/05.png$cn$, $cn$/cardnews/vibrio-monitoring/06.png$cn$,
    $cn$/cardnews/vibrio-monitoring/07.png$cn$, $cn$/cardnews/vibrio-monitoring/08.png$cn$
  ]::text[],
  $cn$/cardnews/vibrio-monitoring/01.png$cn$,
  array[
    $cn$비브리오$cn$, $cn$질병관리$cn$, $cn$수온$cn$, $cn$사료관리$cn$,
    $cn$양식장관리$cn$, $cn$폐사$cn$, $cn$흰다리새우$cn$, $cn$새우양식$cn$
  ]::text[],
  false,
  $cn$2026-08-09 09:00:00+09$cn$::timestamptz
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
