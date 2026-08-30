import type { Metadata } from "next"
import { ko } from "@/lib/i18n"
import { BoardListView } from "@/components/board/board-list-view"
import { BASE, hreflangMap } from "@/lib/marketing-locale"

export const metadata: Metadata = {
  alternates: {
    canonical: `${BASE}/board`,
    languages: hreflangMap("/board", ["ko", "en", "vi", "id"]),
  },
}

// 한국어 목록. 다른 언어는 /[lang]/board 가 담당한다(언어는 주소로 고정).
export default async function BoardPage() {
  return <BoardListView locale="ko" t={ko} />
}
