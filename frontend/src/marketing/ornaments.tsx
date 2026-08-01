import { useEffect, useState } from 'react'

// Ported from the Lovable music-ornaments component set. All animation
// utilities (ornament-float, vinyl-spin, stave-draw, wave-scroll, eq-bar)
// live in styles.css and are disabled under prefers-reduced-motion there.

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  vectorEffect: 'non-scaling-stroke',
} as const

const r = (n: number) => Math.round(n * 100) / 100

/** Parallax music ornaments drifting behind the page. */
export function MusicOrnaments() {
  const [scroll, setScroll] = useState(0)

  useEffect(() => {
    const onScroll = () => setScroll(window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const items = [
    { c: 'left-[6%] top-[18%]', s: 220, d: 0.16, o: 0.26, k: 0, g: <Disc /> },
    { c: 'right-[8%] top-[32%]', s: 160, d: -0.1, o: 0.29, k: 3, g: <Clef /> },
    { c: 'left-[10%] top-[72%]', s: 180, d: 0.22, o: 0.23, k: 6, g: <WaveRing /> },
    { c: 'right-[12%] top-[92%]', s: 200, d: -0.16, o: 0.23, k: 2, g: <Disc /> },
    { c: 'left-[48%] top-[156%]', s: 250, d: 0.12, o: 0.18, k: 8, g: <Notes /> },
    { c: 'right-[6%] top-[184%]', s: 190, d: -0.2, o: 0.23, k: 4, g: <WaveRing /> },
    { c: 'left-[5%] top-[212%]', s: 170, d: 0.18, o: 0.21, k: 5, g: <Clef /> },
    { c: 'right-[18%] top-[10%]', s: 120, d: -0.26, o: 0.26, k: 1, g: <EighthPair /> },
    { c: 'right-[26%] top-[58%]', s: 130, d: 0.24, o: 0.21, k: 2.5, g: <Headphones /> },
    { c: 'left-[68%] top-[120%]', s: 110, d: -0.28, o: 0.23, k: 4.5, g: <EighthPair /> },
    { c: 'right-[10%] top-[220%]', s: 160, d: 0.14, o: 0.18, k: 9, g: <Equalizer /> },
  ]

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {items.map((it, i) => (
        <div
          key={i}
          className={`absolute ${it.c} text-brass`}
          style={{
            width: it.s,
            height: it.s,
            opacity: it.o,
            transform: `translate3d(0, ${scroll * it.d}px, 0)`,
          }}
        >
          <div className="ornament-float h-full w-full" style={{ animationDelay: `-${it.k}s` }}>
            {it.g}
          </div>
        </div>
      ))}
      <NoteConfetti scroll={scroll} />
    </div>
  )
}

/** Small twinkling notes scattered far behind everything. */
export function NoteConfetti({ scroll }: { scroll: number }) {
  const specks = Array.from({ length: 12 }).map((_, i) => ({
    left: `${(i * 53) % 92}%`,
    top: `${((i * 71) % 260) + 6}%`,
    size: 14 + ((i * 7) % 16),
    depth: (i % 2 ? 1 : -1) * (0.08 + (i % 5) * 0.04),
    delay: (i % 9) * 0.7,
    sage: i % 4 === 0,
  }))
  return (
    <>
      {specks.map((s, i) => (
        <div
          key={i}
          className={`absolute ${s.sage ? 'text-sage' : 'text-brass'}`}
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            opacity: 0.3,
            transform: `translate3d(0, ${scroll * s.depth}px, 0)`,
          }}
        >
          <div className="ornament-float h-full w-full" style={{ animationDelay: `-${s.delay}s` }}>
            {i % 3 === 0 ? <SingleNote /> : <EighthPair />}
          </div>
        </div>
      ))}
    </>
  )
}

/** Animated staff/waveform divider used between sections. */
export function WaveDivider() {
  return (
    <div aria-hidden className="relative h-14 overflow-hidden opacity-60">
      <div className="wave-scroll flex w-[200%] items-end gap-1.5 px-1">
        {Array.from({ length: 160 }).map((_, i) => (
          <span
            key={i}
            className="eq-bar w-full flex-1 bg-brass/45"
            style={{
              height: `${r(18 + Math.abs(Math.sin(i * 0.35)) * 34)}px`,
              animationDelay: `${(i % 12) * 0.09}s`,
              animationDuration: `${1 + (i % 5) * 0.18}s`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

function SingleNote() {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full">
      <g {...stroke}>
        <ellipse cx="34" cy="74" rx="16" ry="12" transform="rotate(-20 34 74)" />
        <path d="M49 68V16" />
        <path d="M49 16c14 4 24 12 26 24" />
      </g>
    </svg>
  )
}

function EighthPair() {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full">
      <g {...stroke}>
        <ellipse cx="24" cy="76" rx="13" ry="10" transform="rotate(-20 24 76)" />
        <ellipse cx="72" cy="66" rx="13" ry="10" transform="rotate(-20 72 66)" />
        <path d="M36 71V22l48-10v49" />
        <path d="M36 36l48-10" />
      </g>
    </svg>
  )
}

function Headphones() {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full">
      <g {...stroke}>
        <path d="M18 62V52a32 32 0 0 1 64 0v10" />
        <rect x="10" y="58" width="18" height="28" rx="8" />
        <rect x="72" y="58" width="18" height="28" rx="8" />
      </g>
    </svg>
  )
}

function Equalizer() {
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full">
      <g {...stroke}>
        {[12, 26, 40, 54, 68, 82].map((x, i) => {
          const h = 20 + Math.abs(Math.sin(i * 1.3)) * 46
          return <line key={x} x1={x} y1={r(84 - h)} x2={x} y2="84" strokeWidth={3} />
        })}
        <line x1="6" y1="90" x2="94" y2="90" />
      </g>
    </svg>
  )
}

function Disc() {
  return (
    <svg
      viewBox="0 0 200 200"
      className="vinyl-spin h-full w-full"
      style={{ animationDuration: '44s' }}
    >
      {[92, 78, 64, 50, 36, 22].map((radius) => (
        <circle key={radius} cx="100" cy="100" r={radius} {...stroke} />
      ))}
      <circle cx="100" cy="100" r="8" fill="currentColor" />
      <path d="M100 8v18M100 174v18M8 100h18M174 100h18" {...stroke} />
    </svg>
  )
}

function WaveRing() {
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full">
      {Array.from({ length: 48 }).map((_, i) => {
        const a = (i / 48) * Math.PI * 2
        const amp = 56 + Math.sin(i * 1.7) * 22
        return (
          <line
            key={i}
            x1={r(100 + Math.cos(a) * 40)}
            y1={r(100 + Math.sin(a) * 40)}
            x2={r(100 + Math.cos(a) * amp)}
            y2={r(100 + Math.sin(a) * amp)}
            {...stroke}
          />
        )
      })}
      <circle cx="100" cy="100" r="36" {...stroke} />
    </svg>
  )
}

function Clef() {
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full">
      <g {...stroke}>
        {[40, 60, 80, 100, 120].map((y) => (
          <line key={y} x1="10" y1={y} x2="190" y2={y} />
        ))}
        <path
          className="stave-draw"
          d="M96 150c22-6 30-26 24-46-6-20-32-30-40-14-8 15 6 28 22 36 18 9 34 20 32 38-2 16-24 20-32 8"
        />
        <circle cx="96" cy="164" r="7" fill="currentColor" stroke="none" />
      </g>
    </svg>
  )
}

function Notes() {
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full">
      <g {...stroke}>
        <ellipse cx="52" cy="140" rx="18" ry="13" transform="rotate(-18 52 140)" />
        <path d="M69 134V50l70-16v84" />
        <ellipse cx="122" cy="124" rx="18" ry="13" transform="rotate(-18 122 124)" />
        <path d="M69 66l70-16" />
      </g>
    </svg>
  )
}
