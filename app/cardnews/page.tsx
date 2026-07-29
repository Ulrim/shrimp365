import type { Metadata } from "next"
import { ko } from "@/lib/i18n"
import { CardNewsListView } from "@/components/cardnews/cardnews-list-view"
import { BASE, hreflangMap } from "@/lib/marketing-locale"

// 새 글 등록 시 /api/cardnews가 revalidatePath로 갱신하지만,
// 그와 별개로 5분마다 재생성해 캐시가 오래 굳지 않도록 한다.
export const revalidate = 300

export const metadata: Metadata = {
  alternates: {
    canonical: `${BASE}/cardnews`,
    languages: hreflangMap("/cardnews", ["ko", "en", "vi", "id"]),
  },
}

// 한국어 목록. 다른 언어는 /[lang]/cardnews 가 담당한다.
// 언어를 쿠키가 아니라 주소로 고정한다 — 이 페이지는 캐시되고 hreflang에서
// ko-KR로 광고되므로, 쿠키에 따라 달라지면 영어 캐시가 이 주소로 나갈 수 있다.
export default async function CardNewsPage() {
  return <CardNewsListView locale="ko" t={ko} />
}
