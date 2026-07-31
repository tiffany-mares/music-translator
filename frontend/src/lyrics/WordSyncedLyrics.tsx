import { useMemo, type RefObject } from 'react'
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

  if (pipelineState === 'failed') return null
  if (isError) return <p className="status-line">Couldn&apos;t load lyrics.</p>
  if (!data) return <p className="status-line">Lyrics loading…</p>
  const active =
    activeIndex >= 0
      ? { lineIndex: flat[activeIndex].lineIndex, wordIndex: flat[activeIndex].wordIndex }
      : null
  return <LyricsPanel lines={data.lines} active={active} />
}
