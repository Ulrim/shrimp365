"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import { User as SupabaseUser, Session } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { isTestAccount } from "@/lib/mock-data"

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
  // plan_expires_at가 있고 만료됐으면 free로 다운그레이드
  let plan = (data?.plan as "free" | "basic" | "pro" | "enterprise") || "free"
  if (data?.plan_expires_at && new Date(data.plan_expires_at) < new Date()) {
    plan = "free"
  }
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

  const logout = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) console.warn("[auth] signOut failed:", error.message)
    setUser(null)
    setSession(null)
  }

  const signup = async (email: string, password: string, name: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name }, emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/login` },
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
    const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/login` } })
    if (error) return { success: false, error: "재발송에 실패했습니다." }
    return { success: true }
  }

  const sendPasswordReset = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/reset-password`,
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
    <AuthContext.Provider value={{ user, session, loading, login, logout, signup, updateProfile, updatePassword, updateEmail, sendPasswordReset, resendVerification, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
