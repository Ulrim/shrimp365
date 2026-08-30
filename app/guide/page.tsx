import type { Metadata } from "next"
import { PublicHeader, PublicFooter } from "@/components/layout/public-header"
import { GuideBody } from "@/components/guide/guide-body"
import { GUIDE } from "@/lib/content/guide"
import { BASE, hreflangMap } from "@/lib/marketing-locale"

export const metadata: Metadata = {
  alternates: {
    canonical: `${BASE}/guide`,
    languages: hreflangMap("/guide", ["ko", "en", "vi", "id"]),
  },
}

// 한국어. 다른 언어는 /[lang]/guide 가 담당한다.
export default async function GuidePage() {
  const g = GUIDE.ko
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader maxWidth="max-w-4xl" />
      <GuideBody g={g} />
      <PublicFooter maxWidth="max-w-4xl" />
    </div>
  )
}
