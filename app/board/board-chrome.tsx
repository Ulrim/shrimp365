"use client"

import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"

const DropMark = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2.5c4 4.5 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2-6.5 6-11Z" />
  </svg>
)

/** Public chrome for the community board (readable without login). */
export function BoardChrome({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const { t } = useT()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-card/85 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="w-7 h-7 border-[1.5px] border-[#1E40AF] text-[#1E40AF] rounded-lg flex items-center justify-center">
              <DropMark />
            </span>
            Shrimp365
          </Link>
          <div className="flex items-center gap-2 text-sm">
            {user ? (
              <Link href="/home" className="text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors">
                {t.nav.dashboard}
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-foreground px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors">
                  {t.auth.loginButton}
                </Link>
                <Link href="/signup" className="bg-[#1E40AF] hover:bg-[#3B82F6] text-white px-3 py-1.5 rounded-lg font-semibold transition-colors">
                  {t.common.signup}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="px-4 py-6">{children}</main>
    </div>
  )
}
