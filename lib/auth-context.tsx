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
    role: data?.role || "farmer",
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
    //
    // 이 콜백 안에서 다른 supabase 호출을 기다리면 안 된다.
    // 콜백이 도는 동안 auth 라이브러리가 토큰 잠금(navigator.locks)을 쥐고 있는데,
    // profiles 조회도 세션이 필요해 같은 잠금을 기다린다 — 서로 물려 멈춘다.
    // 그러면 setLoading(false) 까지 못 가서 대시보드·수질기록이 영영 로딩만 돈다.
    // 콘솔에 "Lock ... was released because another request stole it" 이 찍히는 것이
    // 이 상태의 신호다.
    //
    // 그래서 세션은 즉시 반영하고, 프로필 조회는 잠금을 놓은 뒤에 따로 돌린다.
    let alive = true

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session)

        if (!session?.user) {
          setUser(null)
          setLoading(false)
          if (event === "SIGNED_OUT") window.location.replace("/")
          return
        }

        // 프로필이 오기 전에도 화면은 떠야 한다. 이메일만으로 먼저 채운다.
        setUser(toAppUser(session.user, { name: "", role: "farmer", plan: "free" }))
        setLoading(false)

        // 잠금 밖에서 조회한다. setTimeout 0 이면 콜백이 끝난 뒤에 실행된다.
        const userId = session.user.id
        const sbUser = session.user
        setTimeout(async () => {
          try {
            const profile = await fetchProfile(userId)
            if (alive) setUser(toAppUser(sbUser, profile))
          } catch (e) {
            // 프로필을 못 읽어도 로그인 상태는 유지한다. 위에서 채워 둔 값으로 쓴다.
            console.warn("[auth] profile load failed:", e)
          }
        }, 0)
      }
    )

    return () => {
      alive = false
      subscription.unsubscribe()
    }
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
    // 1) global — 서버 측 세션(refresh token)을 revoke 해 해당 계정 연결을 실제로 끊는다.
    try {
      await supabase.auth.signOut({ scope: "global" })
    } catch (e) {
      console.warn("[auth] global signOut failed:", e)
    }
    // 2) local — 서버 revoke가 네트워크 오류로 실패해도 이 기기의 세션/쿠키는 반드시 제거.
    try {
      await supabase.auth.signOut({ scope: "local" })
    } catch (e) {
      console.warn("[auth] local signOut failed:", e)
    }
    setUser(null)
    setSession(null)
    // 로그아웃 후 홈페이지 첫 화면(마케팅 랜딩)으로 이동. 전체 새로고침으로
    // 남은 상태/캐시까지 깨끗이 초기화한다. 랜딩에 로그인 버튼이 있다.
    if (typeof window !== "undefined") window.location.replace("/")
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
