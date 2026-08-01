// Ported from the Lovable vinyl.tsx (cn() replaced with template strings).
// Progress ring + spinning disc; onSeek turns the ring into a click-to-seek
// dial (angle -> fraction of the track).
export default function Vinyl({
  spinning = false,
  size = 280,
  className = '',
  progress = 0,
  onSeek,
}: {
  spinning?: boolean
  size?: number
  className?: string
  progress?: number
  onSeek?: (pct: number) => void
}) {
  return (
    <div className={`relative select-none ${className}`} style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full -rotate-90"
        onClick={(e) => {
          if (!onSeek) return
          const r = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - r.left - r.width / 2
          const y = e.clientY - r.top - r.height / 2
          let a = (Math.atan2(y, x) * 180) / Math.PI + 90
          if (a < 0) a += 360
          onSeek(a / 360)
        }}
        role={onSeek ? 'slider' : undefined}
        aria-label={onSeek ? 'Seek' : undefined}
        aria-valuenow={Math.round(progress * 100)}
      >
        <circle cx="50" cy="50" r="47" fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
          cx="50"
          cy="50"
          r="47"
          fill="none"
          stroke="var(--brass)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${progress * 295.3} 295.3`}
          className={onSeek ? 'cursor-pointer' : undefined}
        />
      </svg>
      <div
        className={`absolute inset-[7%] rounded-full ${spinning ? 'vinyl-spin' : ''}`}
        style={{
          background:
            'repeating-radial-gradient(circle at center, oklch(0.16 0.02 260) 0 3px, oklch(0.22 0.025 262) 3px 5px)',
        }}
      >
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_25%,color-mix(in_oklab,var(--brass)_18%,transparent),transparent_60%)]" />
        <div className="absolute left-1/2 top-1/2 h-[30%] w-[30%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brass/80" />
        <div className="absolute left-1/2 top-1/2 h-[5%] w-[5%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-background" />
      </div>
    </div>
  )
}
