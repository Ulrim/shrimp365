"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, ChevronDown, ChevronUp, ExternalLink, Download } from "lucide-react"
import { useT } from "@/lib/i18n-context"

// Non-translatable structural metadata (icons, ids, hrefs) stays in code;
// all user-facing text comes from t.help.*
const SECTION_META = [
  { id: "daily", icon: "🗓️" },
  { id: "record", icon: "📝" },
  { id: "monitor", icon: "📊" },
  { id: "ai", icon: "🤖" },
  { id: "farm", icon: "🏠" },
  { id: "inventory", icon: "📦" },
]

const ROUTINE_META: { icon: string; href: string | null }[] = [
  { icon: "📝", href: "/record" },
  { icon: "🔔", href: null },
  { icon: "📊", href: "/dashboard" },
]

const SHORTCUT_KEYS = ["⌘K / Ctrl+K", "ESC", "↑↓ + Enter"]

export default function InAppGuidePage() {
  const router = useRouter()
  const { t } = useT()
  const [activeSection, setActiveSection] = useState<string>("daily")
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  const sections = SECTION_META.map((meta, i) => ({ ...meta, ...t.help.sections[i] }))
  const routine = ROUTINE_META.map((meta, i) => ({ ...meta, ...t.help.daily[i] }))

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-24 lg:pb-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground mb-1">{t.help.title}</h1>
        <p className="text-sm text-muted-foreground">{t.help.subtitle}</p>
      </div>

      {/* Daily routine summary */}
      <div className="bg-gradient-to-br from-ocean-50 to-teal-50 dark:from-ocean-950/30 dark:to-teal-950/30 border border-ocean-200 dark:border-ocean-800 rounded-2xl p-5 mb-6">
        <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
          <span>🗓️</span> {t.help.dailyTitle}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {routine.map((item) => (
            <button
              key={item.step}
              onClick={() => item.href && router.push(item.href)}
              aria-label={item.href ? t.help.navigateAria.replace("{{title}}", item.title).replace("{{desc}}", item.desc) : item.title}
              className={`bg-card rounded-xl border border-border p-4 text-left shadow-sm min-h-[44px] ${item.href ? "hover:border-ocean-300 hover:shadow-md transition-all cursor-pointer" : "cursor-default"}`}
            >
              <div className="text-2xl mb-1">{item.icon}</div>
              <div className="text-xs text-ocean-600 font-semibold">{item.step}</div>
              <div className="font-semibold text-foreground text-sm">{item.title}</div>
              <div className="text-xs text-muted-foreground">{item.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-3 mb-8">
        {sections.map((s) => {
          const isOpen = activeSection === s.id
          return (
            <div key={s.id} className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
              <button
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/40 transition-colors min-h-[44px]"
                onClick={() => setActiveSection(isOpen ? "" : s.id)}
                aria-expanded={isOpen}
                aria-controls={`section-content-${s.id}`}
              >
                <span className="text-2xl shrink-0">{s.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground text-sm">{s.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.desc}</p>
                </div>
                {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
              </button>

              {isOpen && (
                <div id={`section-content-${s.id}`} className="border-t border-border px-4 pb-4 pt-3">
                  <div className="space-y-3 mb-4">
                    {s.content.map((item, i) => (
                      <div key={i} className="flex gap-3">
                        <div className="w-5 h-5 rounded-full bg-ocean-100 text-ocean-700 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">{i + 1}</div>
                        <div>
                          <p className="text-xs font-semibold text-foreground mb-0.5">{item.step}</p>
                          <p className="text-xs text-muted-foreground leading-relaxed">{item.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="bg-ocean-50 dark:bg-ocean-950/30 border border-ocean-200 dark:border-ocean-800 rounded-xl p-3 flex gap-2">
                    <span className="text-base shrink-0" aria-hidden="true">💡</span>
                    <p className="text-xs text-ocean-700 dark:text-ocean-300 leading-relaxed">{s.tip}</p>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Keyboard shortcuts */}
      <div className="bg-card border border-border rounded-2xl p-4 mb-6 shadow-sm">
        <h2 className="font-semibold text-foreground text-sm mb-3 flex items-center gap-2">
          ⌨️ {t.help.shortcutsTitle}
        </h2>
        <div className="space-y-2">
          {SHORTCUT_KEYS.map((key, i) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <kbd className="text-xs bg-muted border border-border rounded px-2 py-1 font-mono shrink-0">{key}</kbd>
              <span className="text-xs text-muted-foreground">{t.help.shortcuts[i]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Links */}
      <div className="space-y-3">
        <a
          href="/guide"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t.help.fullGuideAria}
          className="flex items-center justify-between gap-3 bg-gradient-to-r from-ocean-50 to-teal-50 dark:from-ocean-950/30 dark:to-teal-950/30 border border-ocean-200 dark:border-ocean-800 rounded-2xl p-4 min-h-[44px] hover:from-ocean-100 hover:to-teal-100 transition-all group"
        >
          <div>
            <p className="font-semibold text-ocean-700 text-sm">{t.help.fullGuideTitle}</p>
            <p className="text-xs text-ocean-600 mt-0.5">{t.help.fullGuideDesc}</p>
          </div>
          <ExternalLink className="w-4 h-4 text-ocean-500 shrink-0 group-hover:translate-x-0.5 transition-transform" />
        </a>
        <a
          href="/api/guide"
          download={t.help.pdfFilename}
          aria-label={t.help.pdfAria}
          className="flex items-center justify-between gap-3 bg-card border border-border rounded-2xl p-4 min-h-[44px] hover:bg-muted transition-all group"
        >
          <div>
            <p className="font-semibold text-foreground text-sm">{t.help.pdfTitle}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t.help.pdfDesc}</p>
          </div>
          <Download className="w-4 h-4 text-muted-foreground shrink-0" />
        </a>
      </div>
    </div>
  )
}
