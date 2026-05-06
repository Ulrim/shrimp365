"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import { User as SupabaseUser, Session } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"

interface AppUser {
  id: string
  email: string
  name: string
  role: string
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
}

const AuthContext = createContext<AuthContextType | null>(null)

async function fetchProfile(userId: string): Promise<{ name: string; role: string }> {
  const { data } = await supabase
    .from("profiles")
    .select("name, role")
    .eq("id", userId)
    .single()
  return { name: data?.name || "", role: data?.role || "operator" }
}

function toAppUser(sbUser: SupabaseUser, profile: { name: string; role: string }): AppUser {
  return {
    id: sbUser.id,
    email: sbUser.email || "",
    name: profile.name || sbUser.email?.split("@")[0] || "",
    role: profile.role,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session)
      if (session?.user) {
        const profile = await fetchProfile(session.user.id)
        setUser(toAppUser(session.user, profile))
      }
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session)
        if (session?.user) {
          const profile = await fetchProfile(session.user.id)
          setUser(toAppUser(session.user, profile))
        } else {
          setUser(null)
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
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
  }

  const signup = async (email: string, password: string, name: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
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

  return (
    <AuthContext.Provider value={{ user, session, loading, login, logout, signup, updateProfile, updatePassword }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
