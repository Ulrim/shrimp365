/** Flat blue brand mark (replaces the 🦐 emoji logo across the app). */
export function BrandMark({ size = 36, icon = 18, className = "" }: { size?: number; icon?: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 border-[1.5px] border-[#1E40AF] text-[#1E40AF] ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
      aria-hidden="true"
    >
      <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2.5c4 4.5 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 2-6.5 6-11Z" />
      </svg>
    </span>
  )
}
