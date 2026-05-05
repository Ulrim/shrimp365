"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import { User } from "@/types"
import { TEST_ACCOUNTS, MOCK_USER } from "@/lib/mock-data"

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  logout: () => void
  signup: (email: string, password: string, name: string) => Promise<{ success: boolean; error?: string }>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem("shrimp365_user")
    if (stored) {
      setUser(JSON.parse(stored))
    }
    setLoading(false)
  }, [])

  const login = async (email: string, password: string) => {
    const account = TEST_ACCOUNTS.find(a => a.email === email && a.password === password)
    if (account) {
      const userData: User = {
        id: "mock-user-1",
        email: account.email,
        name: account.name.split(" ")[0],
        role: email.includes("admin") ? "admin" : "operator",
        farm_count: 2,
      }
      setUser(userData)
      localStorage.setItem("shrimp365_user", JSON.stringify(userData))
      return { success: true }
    }
    return { success: false, error: "이메일 또는 비밀번호가 올바르지 않습니다." }
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem("shrimp365_user")
  }

  const signup = async (email: string, password: string, name: string) => {
    if (TEST_ACCOUNTS.find(a => a.email === email)) {
      return { success: false, error: "이미 사용 중인 이메일입니다." }
    }
    const userData: User = {
      id: "new-user-" + Date.now(),
      email,
      name,
      role: "operator",
      farm_count: 0,
    }
    setUser(userData)
    localStorage.setItem("shrimp365_user", JSON.stringify(userData))
    return { success: true }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, signup }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
