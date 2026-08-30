"use client"

import Link from "next/link"
import { Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase"

/** 관리자에게만 보이는 등록 버튼. 비관리자·비로그인·크롤러에게는 아무것도 렌더하지 않는다. */
export function NewCardNewsButton({ label }: { label: string }) {
  const { user } = useAuth()
  const [adminId, setAdminId] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let alive = true
    supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()
      .then(({ data }) => { if (alive && data?.role === "admin") setAdminId(user.id) })
    return () => { alive = false }
  }, [user])

  // 로그아웃하거나 계정이 바뀌면 이전 확인 결과를 그대로 쓰지 않는다.
  if (!user || adminId !== user.id) return null

  return (
    <Link
      href="/cardnews/new"
      className="shrink-0 inline-flex items-center gap-1.5 bg-[#1E40AF] hover:bg-[#3B82F6] text-white text-sm font-semibold px-4 min-h-[44px] rounded-lg transition-colors"
    >
      <Plus className="w-4 h-4" aria-hidden="true" />
      {label}
    </Link>
  )
}
