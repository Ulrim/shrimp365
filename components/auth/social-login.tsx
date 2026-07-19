"use client"

import { useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { useT } from "@/lib/i18n-context"

// ─── Brand logos (inline SVG) ────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

function KakaoIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#000000" d="M12 3C6.48 3 2 6.58 2 10.99c0 2.87 1.9 5.38 4.75 6.79-.16.56-.86 3.03-.9 3.22-.05.24.09.24.19.17.08-.05 3.2-2.17 4.55-3.09.46.06.93.1 1.41.1 5.52 0 10-3.58 10-7.99C22 6.58 17.52 3 12 3z" />
    </svg>
  )
}

/**
 * 소셜 로그인 버튼 묶음 (Google / Kakao).
 * - Google, Kakao: Supabase 기본 OAuth (signInWithProvider)
 */
export function SocialLogin() {
  const { signInWithProvider } = useAuth()
  const { t } = useT()
  const [pending, setPending] = useState<string | null>(null)

  const handleOAuth = async (provider: "google" | "kakao") => {
    setPending(provider)
    const res = await signInWithProvider(provider)
    // 성공 시 브라우저가 provider로 리다이렉트되므로 아래는 실패 시에만 실행됨
    if (!res.success) setPending(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground">{t.auth.socialOr}</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => handleOAuth("google")}
          disabled={!!pending}
          className="w-full flex items-center justify-center gap-3 min-h-[44px] rounded-lg border border-border bg-white text-gray-700 font-medium text-sm hover:bg-gray-50 transition-colors disabled:opacity-60"
        >
          <GoogleIcon />
          {t.auth.socialGoogle}
        </button>

        <button
          type="button"
          onClick={() => handleOAuth("kakao")}
          disabled={!!pending}
          className="w-full flex items-center justify-center gap-3 min-h-[44px] rounded-lg bg-[#FEE500] text-[#191600] font-medium text-sm hover:brightness-95 transition-all disabled:opacity-60"
        >
          <KakaoIcon />
          {t.auth.socialKakao}
        </button>
      </div>
    </div>
  )
}
