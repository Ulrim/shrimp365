import type { Metadata } from "next"
import type { ReactNode } from "react"
import Link from "next/link"

/*
 * 공개 데모 셸.
 *
 * 앱 셸(MrvShell)은 세션과 조직을 조회해 내비를 그리지만, 여기는 **아무것도 조회하지 않는다**.
 * 로그인 없이 열리는 화면이 조직 자료에 닿는 길을 하나라도 가지면 안 되기 때문이다. 상단에
 * "데모" 라는 사실과 실제 플랫폼으로 가는 길만 둔다.
 */

export const metadata: Metadata = {
  title: "컬리버 탄소 MRV 플랫폼 — 공개 데모",
  description:
    "로그인 없이 보는 읽기 전용 시연. 기준선 → 추천/제어 → 로그 → 전후비교 → MRV 증빙의 " +
    "사슬을 가상 양식장 30일 자료로 보여 줍니다.",
  robots: { index: false, follow: false },
}

export default function MrvDemoLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-mrv-bg text-mrv-fg">
      <header className="sticky top-0 z-20 border-b border-mrv-border bg-mrv-surface/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-xs text-mrv-muted hover:text-mrv-fg">
              ← shrimp365
            </Link>
            <span className="text-sm font-bold text-mrv-fg">컬리버 탄소 MRV 플랫폼</span>
            <span className="rounded-full border border-mrv-amber bg-mrv-amber-bg px-2 py-0.5 text-[11px] font-semibold text-mrv-fg">
              공개 데모 · 시연 자료
            </span>
          </div>
          <nav className="flex items-center gap-2 text-sm" aria-label="데모 바깥으로">
            <Link
              href="/login"
              className="rounded-md bg-mrv-primary px-3 py-1.5 font-medium text-white hover:opacity-90"
            >
              로그인해서 실제 플랫폼 열기
            </Link>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="mx-auto w-full max-w-5xl px-6 py-8 text-xs text-mrv-muted">
        이 화면의 숫자는 가상 양식장 자료로 산식 엔진이 낸 값입니다. 실제 고객 자료가 아니며,
        데이터베이스나 API 를 부르지 않습니다. 실제 플랫폼은 조직 초대를 받은 계정으로 로그인해 씁니다.
      </footer>
    </div>
  )
}
