import type { Metadata } from "next"
import { getServerDict } from "@/lib/i18n-server"
import { PublicHeader, PublicFooter } from "@/components/layout/public-header"
import { PricingBody } from "@/components/pricing/pricing-body"
import { PRICING } from "@/lib/content/pricing"
import { BASE, hreflangMap } from "@/lib/marketing-locale"

export const metadata: Metadata = {
  alternates: {
    canonical: `${BASE}/pricing`,
    languages: hreflangMap("/pricing", ["ko", "en", "vi", "id"]),
  },
}

// 한국어. 다른 언어는 /[lang]/pricing 이 담당한다.
export default async function PricingPage() {
  const { locale } = await getServerDict()
  return (
    <main className="min-h-screen bg-background text-foreground">
      <PublicHeader maxWidth="max-w-3xl" />
      <PricingBody p={PRICING[locale]} locale={locale} />
      <PublicFooter maxWidth="max-w-3xl" />
    </main>
  )
}
