import type { Metadata } from "next"
import { getServerDict } from "@/lib/i18n-server"
import { BoardListView } from "@/components/board/board-list-view"
import { BASE, hreflangMap } from "@/lib/marketing-locale"

export const metadata: Metadata = {
  alternates: {
    canonical: `${BASE}/board`,
    languages: hreflangMap("/board", ["ko", "en", "vi", "id"]),
  },
}

// 한국어 목록. 다른 언어는 /[lang]/board 가 담당한다.
export default async function BoardPage() {
  const { t, locale } = await getServerDict()
  return <BoardListView locale={locale} t={t} />
}
