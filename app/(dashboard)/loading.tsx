export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-6 w-40 bg-white/5 rounded-lg" />
          <div className="h-4 w-64 bg-white/5 rounded-lg" />
        </div>
        <div className="h-9 w-24 bg-white/5 rounded-xl" />
      </div>

      {/* Cards skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-slate-800/50 border border-white/5 rounded-2xl p-5 space-y-3">
            <div className="h-4 w-24 bg-white/5 rounded" />
            <div className="h-8 w-16 bg-white/5 rounded" />
            <div className="h-3 w-32 bg-white/5 rounded" />
          </div>
        ))}
      </div>

      {/* List skeleton */}
      <div className="bg-slate-800/50 border border-white/5 rounded-2xl p-5 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-14 bg-white/5 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
