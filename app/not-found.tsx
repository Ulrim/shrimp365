import Link from "next/link"
import { Waves, Home, ArrowLeft } from "lucide-react"

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-ocean-950 via-slate-900 to-teal-950 p-6">
      <div className="text-center max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-gradient-to-br from-ocean-400 to-teal-500 rounded-xl flex items-center justify-center">
            <Waves className="w-6 h-6 text-white" />
          </div>
          <span className="text-white text-xl font-bold">Shrimp365</span>
        </div>

        <div className="text-8xl font-bold bg-gradient-to-r from-ocean-300 to-teal-300 bg-clip-text text-transparent mb-4">
          404
        </div>

        <h1 className="text-2xl font-bold text-white mb-2">페이지를 찾을 수 없습니다</h1>
        <p className="text-slate-400 text-sm mb-8">
          요청하신 페이지가 존재하지 않거나 이동되었습니다.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/dashboard"
            className="flex items-center justify-center gap-2 bg-gradient-to-r from-ocean-500 to-teal-500 hover:from-ocean-600 hover:to-teal-600 text-white font-semibold px-6 py-2.5 rounded-xl transition-all"
          >
            <Home className="w-4 h-4" />
            대시보드로 이동
          </Link>
          <button
            onClick={() => window.history.back()}
            className="flex items-center justify-center gap-2 border border-white/10 text-slate-300 hover:text-white hover:bg-white/5 px-6 py-2.5 rounded-xl transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            이전 페이지
          </button>
        </div>
      </div>
    </div>
  )
}
