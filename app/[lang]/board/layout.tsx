import { notFound } from "next/navigation"
import { BoardChrome } from "@/app/board/board-chrome"
import { isMarketingLocale } from "@/lib/marketing-locale"

/** 언어별 게시판 주소(/en/board …)의 셸. 화면은 한국어 경로와 동일한 컴포넌트를 쓴다. */
export default async function LocaleBoardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  if (!isMarketingLocale(lang)) notFound()
  return <BoardChrome>{children}</BoardChrome>
}
