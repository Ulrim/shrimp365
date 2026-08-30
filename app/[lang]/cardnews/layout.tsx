import { notFound } from "next/navigation"
import { CardNewsChrome } from "@/app/cardnews/cardnews-chrome"
import { isMarketingLocale } from "@/lib/marketing-locale"

/**
 * 언어별 카드뉴스 주소(/en/cardnews …)의 셸.
 * 화면 자체는 한국어 경로와 동일한 컴포넌트를 쓴다 — 다른 것은 주소뿐이다.
 * 언어는 root layout의 I18nProvider가 미들웨어가 넣어 준 x-locale 헤더로 적용한다.
 */
export default async function LocaleCardNewsLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  if (!isMarketingLocale(lang)) notFound()
  return <CardNewsChrome>{children}</CardNewsChrome>
}
