import type { Metadata } from "next"
import { cookies } from "next/headers"
import "./globals.css"
import { AuthProvider } from "@/lib/auth-context"
import { I18nProvider } from "@/lib/i18n-context"
import { type Locale, LOCALES } from "@/lib/i18n"
import { VersionWatcher } from "@/components/version-watcher"

export const metadata: Metadata = {
  title: "Shrimp365 — Smart Shrimp Aquaculture Platform",
  description: "AI-powered shrimp aquaculture management platform",
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const stored = cookieStore.get("shrimp365_lang")?.value
  const defaultLocale: Locale =
    stored && LOCALES.includes(stored as Locale) ? (stored as Locale) : "ko"

  return (
    <html lang={defaultLocale} suppressHydrationWarning>
      <body className="antialiased">
        <I18nProvider defaultLocale={defaultLocale}>
          <AuthProvider>{children}</AuthProvider>
          <VersionWatcher />
        </I18nProvider>
      </body>
    </html>
  )
}
