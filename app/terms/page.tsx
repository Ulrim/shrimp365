import type { Metadata } from "next"
import { PublicHeader, PublicFooter } from "@/components/layout/public-header"
import { TermsBody } from "@/components/legal/terms-body"
import { BASE, hreflangMap } from "@/lib/marketing-locale"

export const metadata: Metadata = {
  alternates: {
    canonical: `${BASE}/terms`,
    languages: hreflangMap("/terms", ["ko", "en", "vi", "id"]),
  },
}

// 한국어. 다른 언어는 /[lang]/terms 이 담당한다.
export default async function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader maxWidth="max-w-3xl" />
      <TermsBody lang="ko" />
      <PublicFooter maxWidth="max-w-3xl" />
    </div>
  )
}
