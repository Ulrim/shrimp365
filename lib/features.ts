// 화면에 내보낼지 말지를 한곳에서 정하는 스위치.
//
// 카드뉴스·게시판은 당분간 감춰 둔다. 메뉴(사이드바·하단바·랜딩 머리말·
// 바닥글)에서 빠지고, 검색엔진 안내(robots·sitemap)에서도 빠진다.
// 다시 열 때는 이 값을 true 로 바꾸기만 하면 된다 — 코드를 지우지 않는 이유다.
//
// 주소를 직접 치면 페이지 자체는 열린다. 운영자가 카드뉴스를 미리 보고
// 관리할 수 있어야 하기 때문이다(완전 차단이 필요하면 따로 막는다).
export const SHOW_CARDNEWS = false
export const SHOW_BOARD = false

// 컬리버 탄소 MRV 플랫폼 진입 주소.
//
// 플랫폼은 이제 이 앱 안(/mrv)에 있으므로 기본값이 내부 경로다. 환경변수로 절대 URL을
// 넣으면 그쪽으로 보낸다 — 별도 도메인에 따로 배포하는 경우를 위한 탈출구다.
// 빈 문자열로 두면 진입 버튼 자체를 감춘다(운영 중 잠시 내리고 싶을 때).
//
// NEXT_PUBLIC_* 는 빌드타임 정적 치환이라 반드시 리터럴로 직접 참조해야 한다(동적 인덱싱 금지).
export const MRV_PLATFORM_URL = process.env.NEXT_PUBLIC_MRV_PLATFORM_URL ?? "/mrv"

/** 진입 주소가 이 앱 내부 경로인지(= next/link 로 이동하고 새 탭을 열지 않는지). */
export const MRV_PLATFORM_IS_INTERNAL = MRV_PLATFORM_URL.startsWith("/")
