import type { View } from '../nav/NavShell'
import heroUrl from '../assets/cadenza-hero-watercolor.png'

// Task 6 stub: hero + CTAs only. Task 7 ports the full Lovable landing
// (marquee, inspiration essay, pipeline, flow table, FAQ).
export default function Landing({ onNavigate }: { onNavigate: (view: View) => void }) {
  return (
    <section className="relative overflow-hidden band-ink grain-dark text-ink-foreground">
      <img
        src={heroUrl}
        alt=""
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-30"
      />
      <div className="relative z-10 mx-auto flex min-h-[70vh] max-w-4xl flex-col items-start justify-center gap-6 px-6 py-24">
        <p className="label-mono text-brass">[ CADENZA ]</p>
        <h1 className="font-content text-4xl font-semibold leading-tight sm:text-6xl">
          Learn a language through the songs you already love.
        </h1>
        <p className="max-w-xl text-ink-foreground/70">
          Upload a song. Cadenza separates the vocals, times every word, translates every line,
          and turns the music you love into your teacher.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <CtaPill label="Browse the library" onClick={() => onNavigate('library')} primary />
          <CtaPill label="Upload a song" onClick={() => onNavigate('upload')} />
          <CtaPill label="How it works" onClick={() => onNavigate('how')} />
        </div>
      </div>
    </section>
  )
}

function CtaPill({
  label,
  onClick,
  primary,
}: {
  label: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-button rounded-full border px-5 py-2.5 ${
        primary
          ? 'border-brass bg-brass text-primary-foreground'
          : 'border-brass/50 text-brass hover:bg-brass/10'
      }`}
    >
      {label}
    </button>
  )
}
