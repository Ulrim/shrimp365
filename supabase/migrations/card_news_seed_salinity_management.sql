-- ============================================================
-- 카드뉴스 — 염도 관리 (ko) · 2026-08-18
--
-- 이미지: public/cardnews/salinity-management/01..08.png
--
-- 실행 조건: card_news.sql 을 먼저 실행해 테이블이 있어야 한다.
-- 재실행 안전: 같은 (slug, locale)이 있으면 내용을 덮어쓴다.
--              published_at 은 갱신하지 않는다 — 조회수·좋아요도 그대로다.
-- ============================================================

insert into public.card_news
  (slug, locale, title, summary, body, images, cover_url, tags, published, published_at)
values (
  $cn$salinity-management$cn$,
  $cn$ko$cn$,
  $cn$흰다리새우 염도 관리 — 비 온 다음 날 염도를 재세요$cn$,
  $cn$흰다리새우는 0.5~45 ppt에서 살지만 잘 크는 구간은 따로 있습니다. 안정 염도 15~25 ppt, 하루 변동 5 ppt 이내를 기준으로 비와 증발에 대응하는 방법을 정리했습니다.$cn$,
  $cn$비가 한 번 오고 나면 양식장 물이 달라집니다. 겉보기에는 그대로인데 새우가 덜 먹고, 탈피한 개체가 늘고, 며칠 뒤 폐사가 옵니다. 염도가 흔들렸기 때문입니다.

■ 넓은 범위, 좁은 구간

흰다리새우는 염도 적응 폭이 아주 넓은 종입니다. 0.5 ppt에 가까운 저염에서도, 45 ppt에 가까운 고염에서도 살아남습니다. 이 넓은 범위가 이 종이 세계 곳곳에서 길러지는 이유이기도 합니다.

살아남는 것과 잘 크는 것은 다릅니다. 성장이 안정적인 구간은 15~25 ppt 부근입니다. 이 범위를 벗어날수록 새우는 삼투압을 맞추는 데 에너지를 더 씁니다. 그 에너지는 성장에 쓰였어야 할 몫입니다.

■ 문제는 값이 아니라 변화 속도입니다

18 ppt에서 잘 크던 새우가 25 ppt에서도 잘 큽니다. 그런데 18에서 25로 하루 만에 옮기면 문제가 생깁니다.

기준은 하루 5 ppt 이내입니다. 그 이상 흔들리면 탈피 주기가 어긋나고 면역이 떨어집니다. 종묘를 옮길 때는 더 조심해야 합니다. 어린 개체일수록 급변에 약해서, 큰 폭으로 바꿔야 할 때는 며칠에 걸쳐 2 ppt씩 나눠 옮깁니다.

■ 비 온 뒤 — 표층만 싱거워집니다

빗물은 가볍습니다. 양식장에 들어온 빗물은 섞이지 않고 위에 층으로 뜹니다.

이때 표층에서 잰 염도는 실제 새우가 있는 층의 염도가 아닙니다. 숫자만 보고 "많이 내려갔다"고 판단하면 틀립니다. 반대로 표층에 담수층이 오래 남아 있으면 산소 교환이 막히고 아래층이 나빠집니다.

할 일은 하나입니다. 수차를 돌려 섞으십시오. 층을 깨면 염도도 산소도 함께 고르게 됩니다. 태풍이나 집중호우 뒤라면 유입량 자체가 크므로 배수도 함께 봅니다.

■ 여름 — 반대 방향으로도 움직입니다

비만 문제가 아닙니다. 한여름에는 증발로 염도가 계속 올라갑니다. 물은 나가고 소금은 남기 때문입니다.

보충수 없이 몇 주가 지나면 입식 때보다 훨씬 높은 염도가 됩니다. 고염 자체보다 고염과 고수온이 겹치는 상황이 부담입니다. 보충수 계획을 미리 세워 두십시오.

■ 재는 법을 고정하십시오

같은 자리, 같은 시각, 같은 깊이에서 잽니다. 표층이 아니라 중층입니다.

굴절계를 쓴다면 정기적으로 증류수로 영점을 확인합니다. 값이 조금씩 밀리는 기기가 흔합니다.

■ 기록이 원인을 찾아 줍니다

염도 한 번 값은 아무것도 말해 주지 않습니다. 강우량과 함께 나란히 놓았을 때 비로소 "비 온 다음 날 몇 ppt가 내려가는 양식장"이라는 사실이 보입니다. 그다음 비부터는 미리 대응할 수 있습니다.

■ 저염 양식장은 다르게 봅니다

염도가 낮은 물에서 기르는 양식장이라면 염도 숫자만 봐서는 안 됩니다. 저염수에는 칼슘·마그네슘·칼륨 같은 이온이 함께 부족한 경우가 많습니다.

새우는 탈피할 때마다 껍질을 새로 만들어야 하는데, 이 이온이 모자라면 껍질이 제대로 굳지 않습니다. 탈피 실패로 죽는 개체가 늘고, 겉으로는 원인 모를 폐사처럼 보입니다.

염도계 값이 목표 범위 안에 있어도 알칼리도와 경도를 함께 확인하십시오. 두 숫자를 같이 봐야 물의 상태가 보입니다.

Shrimp365는 염도와 수온, 산소를 수조별로 날짜와 함께 기록해 이런 흐름을 남겨 드립니다. 무료로 사용하실 수 있습니다.$cn$,
  array[
    $cn$/cardnews/salinity-management/01.png$cn$, $cn$/cardnews/salinity-management/02.png$cn$,
    $cn$/cardnews/salinity-management/03.png$cn$, $cn$/cardnews/salinity-management/04.png$cn$,
    $cn$/cardnews/salinity-management/05.png$cn$, $cn$/cardnews/salinity-management/06.png$cn$,
    $cn$/cardnews/salinity-management/07.png$cn$, $cn$/cardnews/salinity-management/08.png$cn$
  ]::text[],
  $cn$/cardnews/salinity-management/01.png$cn$,
  array[
    $cn$염도$cn$, $cn$수질관리$cn$, $cn$흰다리새우$cn$, $cn$새우양식$cn$,
    $cn$강우$cn$, $cn$양식장관리$cn$, $cn$탈피$cn$
  ]::text[],
  true,
  $cn$2026-08-18 09:00:00+09$cn$::timestamptz
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
