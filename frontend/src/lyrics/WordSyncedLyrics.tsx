import { useMemo, useState, type RefObject } from 'react'
import { buildEncounter } from '../vocab/encounter'
import { useReviewVocab } from '../vocab/useReviewVocab'
import LyricsPanel from './LyricsPanel'
import { useLyrics } from './useLyrics'
import { useWordSync } from './useWordSync'
import { flattenWords } from './wordSync'

export type PipelineState = 'running' | 'failed' | 'done'

// Container: fetch -> flatten (memoized) -> sync -> present. States:
//   running        -> "Lyrics loading…" (5.1's placeholder; useLyrics stays disabled)
//   failed         -> null (JobStatusLine's role="alert" owns the failure; no double-alert)
//   done + no data -> "Lyrics loading…" (fetch in flight)
//   done + error   -> "Couldn't load lyrics."
//   done + data    -> panel
//
// 5.5: this component owns the vocab ENCOUNTER — it holds the LyricsDoc, so it
// can build the full create-on-first-review payload (term + line translation +
// doc.songId, which on the linked path IS the original song, so quiz context
// resolves). savedVocabIds is per-mount session feedback; a repeat click on an
// already-saved word is swallowed (an accidental double-tap should not reset
// the schedule via a second quality-0 review).
export default function WordSyncedLyrics({
  songId,
  pipelineState,
  audioRef,
}: {
  songId: string
  pipelineState: PipelineState
  audioRef: RefObject<HTMLAudioElement | null>
}) {
  const { data, isError } = useLyrics(songId, pipelineState === 'done')
  const flat = useMemo(() => (data ? flattenWords(data.lines) : []), [data])
  const activeIndex = useWordSync(audioRef, flat)
  const review = useReviewVocab()
  const [savedVocabIds, setSavedVocabIds] = useState<ReadonlySet<string>>(new Set())
  const [saveError, setSaveError] = useState(false)

  if (pipelineState === 'failed') return null
  if (isError) return <p className="status-line">Couldn&apos;t load lyrics.</p>
  if (!data) return <p className="status-line">Lyrics loading…</p>

  const handleWordClick = (lineIndex: number, wordIndex: number) => {
    const req = buildEncounter(data, lineIndex, wordIndex)
    if (!req || savedVocabIds.has(req.vocabId)) return
    review.mutate(req, {
      onSuccess: () => {
        setSaveError(false)
        setSavedVocabIds((prev) => new Set(prev).add(req.vocabId))
      },
      onError: () => setSaveError(true),
    })
  }

  const active =
    activeIndex >= 0
      ? { lineIndex: flat[activeIndex].lineIndex, wordIndex: flat[activeIndex].wordIndex }
      : null
  return (
    <>
      {saveError && (
        <p role="alert" className="auth-error">
          Couldn&apos;t save that word — click it again to retry.
        </p>
      )}
      <LyricsPanel
        lines={data.lines}
        active={active}
        onWordClick={handleWordClick}
        savedVocabIds={savedVocabIds}
      />
    </>
  )
}
