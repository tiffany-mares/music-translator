import { useEffect, useState } from 'react'

const TYPE_MS = 60
const DELETE_MS = 32
const HOLD_MS = 2200

function reducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// Recompile-style rotating typewriter: types a phrase, holds, deletes, moves
// on. Brass caret blinks via the caret-blink utility. Reduced motion (or no
// matchMedia, i.e. jsdom without the stub) still animates in tests but real
// browsers with the preference get the first phrase statically.
export default function Typewriter({ phrases }: { phrases: string[] }) {
  const [state, setState] = useState({ index: 0, length: 0, deleting: false })
  const staticMode = reducedMotion()

  useEffect(() => {
    if (staticMode) return
    const phrase = phrases[state.index]
    const done = state.length === phrase.length
    const delay = state.deleting ? DELETE_MS : done ? HOLD_MS : TYPE_MS
    const timer = setTimeout(() => {
      setState((s) => {
        const current = phrases[s.index]
        if (s.deleting) {
          if (s.length === 0) return { index: (s.index + 1) % phrases.length, length: 0, deleting: false }
          return { ...s, length: s.length - 1 }
        }
        if (s.length === current.length) return { ...s, deleting: true }
        return { ...s, length: s.length + 1 }
      })
    }, delay)
    return () => clearTimeout(timer)
  }, [state, phrases, staticMode])

  const text = staticMode ? phrases[0] : phrases[state.index].slice(0, state.length)
  return (
    <span className="whitespace-nowrap">
      <span data-testid="typewriter">{text}</span>
      {!staticMode && (
        <span aria-hidden className="caret-blink -mb-1 ml-0.5 inline-block h-[1em] w-[2px] bg-brass align-baseline" />
      )}
    </span>
  )
}
