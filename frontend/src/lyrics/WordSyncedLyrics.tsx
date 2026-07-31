import { useMemo, type RefObject } from 'react'
import LyricsPanel from './LyricsPanel'
import { useLyrics } from './useLyrics'
import { useWordSync } from './useWordSync'
import { flattenWords } from './wordSync'

// Container: fetch -> flatten (memoized - useWordSync's effect deps need a
// stable array) -> sync -> present. Renders null until the doc exists; the
// "lyrics loading..." placeholder is 4.5's loading/error pass.
export default function WordSyncedLyrics({
  songId,
  pipelineDone,
  audioRef,
}: {
  songId: string
  pipelineDone: boolean
  audioRef: RefObject<HTMLAudioElement | null>
}) {
  const { data } = useLyrics(songId, pipelineDone)
  const flat = useMemo(() => (data ? flattenWords(data.lines) : []), [data])
  const activeIndex = useWordSync(audioRef, flat)

  if (!data) return null
  const active =
    activeIndex >= 0
      ? { lineIndex: flat[activeIndex].lineIndex, wordIndex: flat[activeIndex].wordIndex }
      : null
  return <LyricsPanel lines={data.lines} active={active} />
}
