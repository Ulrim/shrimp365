// 화면에 내보낼지 말지를 한곳에서 정하는 스위치.
//
// 카드뉴스·게시판을 다시 연다. 메뉴(사이드바·하단바·랜딩 머리말·바닥글)에
// 다시 나오고, 검색엔진 안내(robots·sitemap)에도 다시 포함된다.
//
// 감출 때는 이 값을 false 로 바꾸기만 하면 된다 — 코드를 지우지 않는 이유다.
// false 로 두어도 주소를 직접 치면 페이지 자체는 열린다. 운영자가 미리 보고
// 관리할 수 있어야 하기 때문이다(완전 차단이 필요하면 따로 막는다).
export const SHOW_CARDNEWS = true
export const SHOW_BOARD = true

// 카드뉴스를 감출 언어. 한국어판은 메뉴에서 내리고 영어·베트남어·
// 인도네시아어는 그대로 둔다 — 같은 글이 언어마다 다른 판단을 받는다.
//
// 여기서 뺀 언어는 메뉴뿐 아니라 sitemap·hreflang·robots 에서도 빠진다.
// 검색엔진에 "이 언어판이 있다"고 알려 놓고 메뉴에서만 감추면
// 검색 결과로는 그대로 들어오기 때문이다.
const CARDNEWS_HIDDEN_LOCALES: readonly string[] = ["ko"]

/** 이 언어에서 카드뉴스를 내보낼지. SHOW_CARDNEWS 가 꺼져 있으면 언어와 무관하게 감춘다. */
export function showCardNews(locale: string): boolean {
  return SHOW_CARDNEWS && !CARDNEWS_HIDDEN_LOCALES.includes(locale)
}

/** 카드뉴스를 내보내는 언어 목록. sitemap·hreflang 에서 대상 언어를 거를 때 쓴다. */
export function visibleCardNewsLocales(locales: readonly string[]): string[] {
  return locales.filter(showCardNews)
}

// 컬리버 탄소 MRV 플랫폼 진입 주소. 비어 있으면 진입 버튼을 렌더하지 않는다
// (culiver 배포 전까지는 비워 두는 것이 정상 — 깨진 링크를 실서비스에 노출하지 않는다).
// NEXT_PUBLIC_* 는 빌드타임 정적 치환이라 반드시 리터럴로 직접 참조해야 한다(동적 인덱싱 금지).
export const MRV_PLATFORM_URL = process.env.NEXT_PUBLIC_MRV_PLATFORM_URL ?? ""
