import { useEffect, useRef } from 'react'
import type { LyricsLine } from '../api/types'
import { extractTerm, toVocabId } from '../vocab/encounter'

export interface ActiveWord {
  lineIndex: number
  wordIndex: number
}

// Purely presentational: the active word arrives as a prop, so highlight tests
// inject it directly and all rAF/clock machinery stays in useWordSync. Word
// spans carry data-start/data-end - the live verification hook (and a future
// click-to-seek seam). Word spacing is CSS margin, not text nodes, so the
// active background never covers a trailing space.
//
// 5.5: when onWordClick is provided, saveable words render as native
// <button type="button"> (keyboard/AT support for free — no role=button
// reimplementation); punctuation-only tokens (extractTerm -> '') stay spans.
// word-saved styling keys off savedVocabIds via the same toVocabId identity
// the encounter payload uses.
export default function LyricsPanel({
  lines,
  active,
  onWordClick,
  savedVocabIds,
}: {
  lines: LyricsLine[]
  active: ActiveWord | null
  onWordClick?: (lineIndex: number, wordIndex: number) => void
  savedVocabIds?: ReadonlySet<string>
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
              ? line.words.map((w, wi) => {
                  const term = extractTerm(w.text)
                  const classes = ['word']
                  if (li === active?.lineIndex && wi === active.wordIndex)
                    classes.push('word-active')
                  if (term && savedVocabIds?.has(toVocabId(term))) classes.push('word-saved')
                  const className = classes.join(' ')
                  return onWordClick && term ? (
                    <button
                      key={wi}
                      type="button"
                      className={className}
                      data-start={w.start}
                      data-end={w.end}
                      title={`Save “${term}” to vocabulary`}
                      onClick={() => onWordClick(li, wi)}
                    >
                      {w.text}
                    </button>
                  ) : (
                    <span key={wi} className={className} data-start={w.start} data-end={w.end}>
                      {w.text}
                    </span>
                  )
                })
              : line.originalText}
          </p>
          {line.translatedText && <p className="lyrics-translation">{line.translatedText}</p>}
        </div>
      ))}
    </div>
  )
}
