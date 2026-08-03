---
name: cardnews-render
description: Shrimp365 카드뉴스 1080×1080 PNG를 생성하는 방법 — 카드 JSON 스키마, 디자인 토큰, scripts/cardnews/render.mjs 실행, 결과 검수. 카드 이미지를 만들거나 레이아웃을 고치거나 렌더가 깨졌을 때 사용한다. Use when generating or fixing Shrimp365 card news images (카드뉴스 이미지), editing the card template, or debugging render output.
---

# 카드뉴스 이미지 렌더

카드 데이터(JSON) → `scripts/cardnews/template.html` → Chromium 캡처 → `public/cardnews/<slug>/01.png … 08.png`.

```bash
npm run cardnews scripts/cardnews/data/<slug>.json
```

관련 파일은 셋뿐이다:

| 파일 | 무엇 |
|---|---|
| `scripts/cardnews/render.mjs` | 실행 스크립트 (건드릴 일 거의 없음) |
| `scripts/cardnews/template.html` | 레이아웃·디자인. 모양을 바꾸려면 여기 |
| `scripts/cardnews/cards.example.json` | 스키마 예시 |

작업물은 `scripts/cardnews/data/<slug>.json`에 둔다.

## 카드 JSON

```json
{
  "slug": "dawn-oxygen-drop",
  "locale": "ko",
  "cards": [
    { "type": "cover", "label": "…", "title": ["1줄", "2줄"], "subtitle": "…" },
    { "type": "point", "index": "01", "label": "pH", "value": "7.5–8.5", "caption": "…" },
    { "type": "point", "index": "02", "label": "측정 시각",
      "valueStyle": "text", "value": ["낮에 잰 값은", "쓸모가 없습니다"], "caption": "…" },
    { "type": "outro", "title": ["1줄", "2줄"],
      "rows": [["수온", "28–32 ℃"]],
      "ctaTitle": "…", "ctaNote": "…", "ctaUrl": "shrimp365.kr" }
  ]
}
```

- `slug`는 영문 kebab-case, 80자 이내. 그대로 출력 디렉터리 이름이 된다
- `locale`은 `ko`(기본) `en` `vi` `id`. **출력 경로가 달라진다** — `ko`는 `public/cardnews/<slug>/`, 나머지는 `public/cardnews/<locale>/<slug>/`. 기존 발행분과 같은 규칙이다
- 다국어는 **같은 `slug`에 `locale`만 다르게** 만든다. 데이터 파일은 `data/<slug>.json`(ko), `data/<slug>.<locale>.json`
- **`title`과 `value`는 배열로 줄바꿈을 직접 정한다.** 한글 자동 줄바꿈은 어색한 자리에서 끊긴다. 사람이 정하는 게 항상 낫다
- `type` 기본값은 `point`
- `valueStyle: "text"`는 숫자 대신 문장을 크게 쓸 때. 등폭 대신 Pretendard로, 더 작게 렌더된다
- 수치 카드의 `value`는 글자 수에 따라 자동으로 작아진다 (8자 초과 → 축소, 12자 초과 → 더 축소)

## 디자인 토큰 — 바꾸지 않는다

```
남색 배경   #1B3FBF     표지(cover)·마무리(outro)
밝은 배경   #F2F5FB     본론(point)
짙은 남색   #0F1F45     밝은 배경 위 큰 글자
좌측 띠     남색 14px   본론 카드 왼쪽 세로 바
여백        88px        모든 카드 공통
캔버스      1080×1080   deviceScaleFactor 1
```

- 한글: **Pretendard**. `public/fonts/PretendardVariable.woff2`를 렌더 스크립트가 data URI로 심는다
- 숫자·페이지 번호·수치: 등폭(DejaVu Sans Mono)
- 로고 락업: 좌상단, 라운드 사각 + 물방울 아이콘 + `Shrimp365`
- 페이지 번호: 우하단 `01 / 08`
- 표지에만 좌하단 `→`

## 절대 하지 않는 것

- **네트워크 폰트 금지.** Google Fonts CDN을 쓰면 렌더가 비결정적이 되고 오프라인에서 한글이 두부(□)로 나온다. 폰트는 무조건 로컬 임베드
- 그라데이션·그림자·테두리 장식 추가 금지. 이 브랜드는 평면이다
- 카드마다 다른 색 금지. 위 토큰 안에서만
- **글자가 넘칠 때 템플릿을 늘려서 해결하지 않는다.** 글자를 줄인다 (`cardnews-writing` 스킬의 글자 수 표)

## 넘침(overflow)

이 파이프라인의 주된 실패 모드다. 캡처는 1080px에서 잘리기 때문에 **PNG만 봐서는 잘린 걸 못 알아챈다.**

`render.mjs`가 렌더 시점에 검사해서 경고하고 실패시킨다:

```
! 08번 카드가 넘칩니다 (1153px / 1080px) — 글자를 줄이세요
```

이게 뜨면 해당 카드의 글자를 줄인다. 특히 **마무리 카드의 표는 6행이 상한이다** — 그 이상 넣으려면 `template.html`의 `.outro__*` 값을 함께 줄여야 하는데, 그러면 다른 카드뉴스와 모양이 어긋난다. 행을 줄이는 쪽이 맞다.

## 검수 — 건너뛰지 마라

```bash
file public/cardnews/<slug>/*.png     # 8장, 전부 1080 x 1080
```

그리고 **`Read`로 최소 3장(01, 중간 하나, 08)을 실제로 열어서 본다.** 파일 크기로는 아무것도 알 수 없다.

- [ ] 한글이 네모(□)로 나오지 않는가 — 폰트 로드 실패 신호
- [ ] 대제목이 의도한 줄에서 끊겼는가
- [ ] 글자가 카드 밖으로 잘리지 않았는가
- [ ] 밝은 배경 위 보조 텍스트가 읽히는가
- [ ] 페이지 번호가 `01 / 08` ~ `08 / 08`로 순서대로인가
- [ ] **기존 카드와 나란히 놓았을 때 같은 시리즈로 보이는가** — `public/cardnews/water-quality-guide/01.png`가 기준선이다

마지막 항목이 가장 중요하다. 하나만 튀면 SNS 피드에서 브랜드가 무너진다.

## 실행 환경

Chromium은 컨테이너에 미리 설치돼 있다(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). `playwright` 패키지 버전과 설치된 브라우저 빌드 번호가 어긋날 수 있는데, `render.mjs`가 설치된 빌드를 자동으로 찾아 쓴다.

**`npx playwright install`을 실행하지 마라.** 이미 있는 브라우저를 다시 받는다.
