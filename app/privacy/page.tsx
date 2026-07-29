import type { Metadata } from "next"
import { getServerDict } from "@/lib/i18n-server"
import { PublicHeader, PublicFooter } from "@/components/layout/public-header"
import { PrivacyBody } from "@/components/legal/privacy-body"
import { BASE, hreflangMap } from "@/lib/marketing-locale"

export const metadata: Metadata = {
  alternates: {
    canonical: `${BASE}/privacy`,
    languages: hreflangMap("/privacy", ["ko", "en", "vi", "id"]),
  },
}

// 한국어. 다른 언어는 /[lang]/privacy 이 담당한다.
export default async function PrivacyPage() {
  const { locale } = await getServerDict()
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader maxWidth="max-w-3xl" />
      <PrivacyBody lang={locale} />
      <PublicFooter maxWidth="max-w-3xl" />
    </div>
  )
}
