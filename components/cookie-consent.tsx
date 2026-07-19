"use client"

import { useState, useEffect } from "react"
import { X, Cookie } from "lucide-react"
import { useT } from "@/lib/i18n-context"

const CONSENT_KEY = "shrimp365_cookie_consent"

export function CookieConsent() {
  const { t } = useT()
  const c = t.cookie
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(CONSENT_KEY)) setVisible(true)
    } catch {}
  }, [])

  function accept() {
    try { localStorage.setItem(CONSENT_KEY, "accepted") } catch {}
    setVisible(false)
  }

  function dismiss() {
    try { localStorage.setItem(CONSENT_KEY, "dismissed") } catch {}
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      aria-live="polite"
      className="fixed bottom-0 left-0 right-0 z-50 p-4 md:bottom-4 md:left-4 md:right-auto md:max-w-sm"
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Cookie className="w-4 h-4 text-ocean-500 shrink-0 mt-0.5" />
            <p className="text-sm font-semibold text-foreground">{c.title}</p>
          </div>
          <button
            onClick={dismiss}
            aria-label={c.close}
            className="text-muted-foreground hover:text-foreground transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {c.message}{" "}
          <a href="/privacy" className="text-ocean-500 hover:underline">{c.privacyLink}</a>
        </p>
        <div className="flex gap-2">
          <button
            onClick={accept}
            className="flex-1 bg-ocean-500 hover:bg-ocean-600 text-white text-xs font-medium py-2 px-3 rounded-lg transition-colors"
          >
            {c.acceptAll}
          </button>
          <button
            onClick={dismiss}
            className="flex-1 border border-border hover:bg-muted text-muted-foreground text-xs py-2 px-3 rounded-lg transition-colors"
          >
            {c.essentialOnly}
          </button>
        </div>
      </div>
    </div>
  )
}
