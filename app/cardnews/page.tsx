import type { Metadata } from "next"
import { getServerDict } from "@/lib/i18n-server"
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
export default async function CardNewsPage() {
  const { t, locale } = await getServerDict()
  return <CardNewsListView locale={locale} t={t} />
}
