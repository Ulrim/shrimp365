"use client"

import Link from "next/link"
import { PenSquare } from "lucide-react"
import { useAuth } from "@/lib/auth-context"

export function NewPostButton({ label }: { label: string }) {
  const { user } = useAuth()
  return (
    <Link
      href={user ? "/board/new" : "/login"}
      className="inline-flex items-center gap-1.5 shrink-0 bg-[#1E40AF] hover:bg-[#3B82F6] text-white text-sm font-semibold rounded-lg px-4 min-h-[44px] transition-colors"
    >
      <PenSquare className="w-4 h-4" />
      {label}
    </Link>
  )
}
