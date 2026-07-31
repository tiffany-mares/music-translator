import { useEffect, useRef } from 'react'
import type { LyricsLine } from '../api/types'

export interface ActiveWord {
  lineIndex: number
  wordIndex: number
}

// Purely presentational: the active word arrives as a prop, so highlight tests
// inject it directly and all rAF/clock machinery stays in useWordSync. Word
// spans carry data-start/data-end - the live verification hook (and a future
// click-to-seek seam). Word spacing is CSS margin, not text nodes, so the
// active background never covers a trailing space.
export default function LyricsPanel({
  lines,
  active,
}: {
  lines: LyricsLine[]
  active: ActiveWord | null
}) {
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])
  const activeLine = active?.lineIndex ?? -1

  useEffect(() => {
    if (activeLine < 0) return
    // Optional call: jsdom has no scrollIntoView; browsers always do.
    lineRefs.current[activeLine]?.scrollIntoView?.({ block: 'nearest' })
  }, [activeLine])

  return (
    <div className="lyrics-panel" data-testid="lyrics-panel">
      {lines.map((line, li) => (
        <div
          key={li}
          ref={(el) => {
            lineRefs.current[li] = el
          }}
          className={li === activeLine ? 'lyrics-line line-active' : 'lyrics-line'}
        >
          <p className="lyrics-original">
            {line.words.length > 0
              ? line.words.map((w, wi) => (
                  <span
                    key={wi}
                    className={
                      li === active?.lineIndex && wi === active.wordIndex
                        ? 'word word-active'
                        : 'word'
                    }
                    data-start={w.start}
                    data-end={w.end}
                  >
                    {w.text}
                  </span>
                ))
              : line.originalText}
          </p>
          {line.translatedText && <p className="lyrics-translation">{line.translatedText}</p>}
        </div>
      ))}
    </div>
  )
}
