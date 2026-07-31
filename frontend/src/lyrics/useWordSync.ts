import { useEffect, useState, type RefObject } from 'react'
import { activeWordAt, type FlatWord } from './wordSync'

// Samples the <audio> element's currentTime on requestAnimationFrame and
// binary-searches it against the flattened word timings. The element clock IS
// the playback clock here - a deliberate deviation from section 5.1's literal
// "AudioContext.currentTime": an AudioContext is only the playback clock if
// media routes through it, and routing the current no-CORS media through
// MediaElementAudioSourceNode outputs SILENCE. Web Audio + the bucket GET CORS
// rule arrive in 6.4 (pitch), where they're actually needed. See
// notes/phase4.md 4.4.
//
// setState fires only when the computed index CHANGES - paused audio or 60
// frames inside one word cause zero re-renders. The loop runs while mounted;
// a per-frame binary search over a few hundred words is negligible, and not
// pausing it on 'pause' events keeps the hook stateless about media events.
export function useWordSync(
  audioRef: RefObject<HTMLAudioElement | null>,
  flat: FlatWord[],
): number {
  const [active, setActive] = useState(-1)

  useEffect(() => {
    if (flat.length === 0) return
    let raf = 0
    let last = -1
    const tick = () => {
      const audio = audioRef.current
      if (audio) {
        const idx = activeWordAt(flat, audio.currentTime)
        if (idx !== last) {
          last = idx
          setActive(idx)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [audioRef, flat])

  return active
}
