"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import { User as SupabaseUser, Session } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { isTestAccount } from "@/lib/mock-data"

// Base URL for auth email links. Falls back to the current origin so signup /
// verification / password-reset links never become "undefined/..." if the env
// var is missing on the deploy target.
function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (typeof window !== "undefined" ? window.location.origin : "https://www.shrimp365.kr")
  )
}

interface AppUser {
  id: string
  email: string
  name: string
  role: string
  plan: "free" | "basic" | "pro" | "enterprise"
}

interface AuthContextType {
  user: AppUser | null
  session: Session | null
  loading: boolean
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  signInWithProvider: (provider: "google" | "kakao") => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
  signup: (email: string, password: string, name: string) => Promise<{ success: boolean; error?: string }>
  updateProfile: (name: string) => Promise<void>
  updatePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>
  updateEmail: (newEmail: string) => Promise<{ success: boolean; error?: string }>
  sendPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>
  resendVerification: (email: string) => Promise<{ success: boolean; error?: string }>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

async function fetchProfile(userId: string): Promise<{ name: string; role: string; plan: "free" | "basic" | "pro" | "enterprise" }> {
  const { data, error } = await supabase
    .from("profiles")
    .select("name, role, plan, plan_expires_at")
    .eq("id", userId)
    .single()
  if (error && error.code !== "PGRST116") {
    console.warn("[auth] fetchProfile failed:", error.message)
  }
  // plan_expires_at 만료 체크 제거 — 모든 기능 무료 개방
  const plan = (data?.plan as "free" | "basic" | "pro" | "enterprise") || "free"
  return {
    name: data?.name || "",
    role: data?.role || "operator",
    plan,
  }
}

function toAppUser(sbUser: SupabaseUser, profile: { name: string; role: string; plan: "free" | "basic" | "pro" | "enterprise" }): AppUser {
  const email = sbUser.email || ""
  return {
    id: sbUser.id,
    email,
    name: profile.name || email.split("@")[0] || "",
    role: profile.role,
    plan: isTestAccount(email) ? "pro" : profile.plan,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // onAuthStateChange fires immediately with the current session on subscribe,
    // so we don't need a separate getSession() call — which avoids the navigator.locks
    // race condition triggered by React Strict Mode double-invoking effects.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session)
        if (session?.user) {
          try {
            const profile = await fetchProfile(session.user.id)
            setUser(toAppUser(session.user, profile))
          } catch (e) {
            console.warn("[auth] profile load failed:", e)
            setUser(toAppUser(session.user, { name: "", role: "operator", plan: "free" }))
          }
        } else {
          setUser(null)
          if (event === "SIGNED_OUT") {
            window.location.replace("/login")
          }
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      const msg =
        error.message.includes("Invalid login") || error.message.includes("invalid_credentials")
          ? "이메일 또는 비밀번호가 올바르지 않습니다."
          : error.message.includes("Email not confirmed")
          ? "이메일 인증이 필요합니다. 메일함을 확인해주세요."
          : "로그인에 실패했습니다."
      return { success: false, error: msg }
    }
    return { success: true }
  }

  // Google / Kakao — Supabase 기본 OAuth. 성공 시 브라우저가 provider로 리다이렉트된다.
  const signInWithProvider = async (provider: "google" | "kakao") => {
    // 카카오 이메일(account_email)은 비즈앱 심사 전에는 제공되지 않아 요청 시 KOE205가
    // 발생한다. 비즈앱 승인 전까지는 닉네임만 요청한다.
    // (승인 후 이메일까지 받으려면 "profile_nickname account_email"로 확장)
    const kakaoScopes = process.env.NEXT_PUBLIC_KAKAO_SCOPES || "profile_nickname"
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${siteUrl()}/auth/callback?next=/home`,
        ...(provider === "kakao" ? { scopes: kakaoScopes } : {}),
      },
    })
    if (error) {
      console.warn("[auth] OAuth failed:", error.message)
      return { success: false, error: "소셜 로그인에 실패했습니다. 잠시 후 다시 시도해주세요." }
    }
    return { success: true }
  }

  const logout = async () => {
    // scope: "local" — 서버 revoke 네트워크 호출에 의존하지 않고 로컬 세션/쿠키를
    // 확실히 지운다. (global 스코프는 revoke 실패 시 쿠키가 남아 로그아웃 후에도
    // 미들웨어가 로그인 상태로 인식해 되돌리는 문제가 있었음)
    try {
      await supabase.auth.signOut({ scope: "local" })
    } catch (e) {
      console.warn("[auth] signOut failed:", e)
    }
    setUser(null)
    setSession(null)
    // 전체 새로고침으로 남은 상태/캐시까지 깨끗이 초기화
    if (typeof window !== "undefined") window.location.replace("/login")
  }

  const signup = async (email: string, password: string, name: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name }, emailRedirectTo: `${siteUrl()}/auth/callback?next=/home` },
    })
    if (error) {
      const msg = error.message.includes("already registered")
        ? "이미 사용 중인 이메일입니다."
        : error.message
      return { success: false, error: msg }
    }
    return { success: true }
  }

  const updateProfile = async (name: string) => {
    if (!user) return
    await supabase.from("profiles").update({ name }).eq("id", user.id)
    setUser(prev => prev ? { ...prev, name } : null)
  }

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { success: false, error: "비밀번호 변경에 실패했습니다." }
    return { success: true }
  }

  const updateEmail = async (newEmail: string) => {
    const { error } = await supabase.auth.updateUser({ email: newEmail })
    if (error) return { success: false, error: "이메일 변경에 실패했습니다." }
    return { success: true }
  }

  const resendVerification = async (email: string) => {
    const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${siteUrl()}/auth/callback?next=/home` } })
    if (error) return { success: false, error: "재발송에 실패했습니다." }
    return { success: true }
  }

  const sendPasswordReset = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl()}/reset-password`,
    })
    if (error) return { success: false, error: "재설정 메일 발송에 실패했습니다." }
    return { success: true }
  }

  const refreshProfile = async () => {
    const { data: { user: sbUser } } = await supabase.auth.getUser()
    if (!sbUser) return
    const profile = await fetchProfile(sbUser.id)
    setUser(toAppUser(sbUser, profile))
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, login, signInWithProvider, logout, signup, updateProfile, updatePassword, updateEmail, sendPasswordReset, resendVerification, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
