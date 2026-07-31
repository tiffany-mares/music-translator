import { useEffect, useRef, useState } from 'react'
import WordSyncedLyrics from '../lyrics/WordSyncedLyrics'
import { useJobPolling } from '../upload/useJobPolling'
import { useAudioUrls } from './useAudioUrls'

type StemKey = 'raw' | 'vocals' | 'noVocals'
const STEM_ORDER: StemKey[] = ['raw', 'vocals', 'noVocals']
const STEM_LABELS: Record<StemKey, string> = {
  raw: 'Original',
  vocals: 'Vocals',
  noVocals: 'Instrumental',
}

// jobId null = linked path (stems, if any, are already final - single fetch).
// LINKED gap fix (frontend side): lyrics are keyed to the ORIGINAL songId - the
// backend never follows linkedSongId (recorded as future hardening), so the
// linked flow passes lyricsSongId = linkedSongId while audio stays on songId.
export default function Player({
  songId,
  jobId,
  lyricsSongId,
}: {
  songId: string
  jobId: string | null
  lyricsSongId?: string
}) {
  // Same queryKey as JobStatusLine's observer - React Query dedupes; no extra requests.
  const { data: job } = useJobPolling(jobId)
  const pipelineDone = jobId === null || job?.status === 'COMPLETE'
  const { data } = useAudioUrls(songId, pipelineDone)

  const audioRef = useRef<HTMLAudioElement>(null)
  const resumeRef = useRef<{ time: number; play: boolean } | null>(null)
  const [stem, setStem] = useState<StemKey>('raw')
  const [src, setSrc] = useState<string>()

  const urls = data?.urls ?? {}
  const available = STEM_ORDER.filter((k) => urls[k])

  // Adopt a URL for the selected stem exactly once. Every audio-urls fetch
  // re-signs the URLs, so binding src straight to data would swap the src on
  // the COMPLETE refetch and restart playback mid-song. Refetches exist to
  // discover new stems, never to rebind the playing element.
  useEffect(() => {
    const url = urls[stem]
    if (src === undefined && url) setSrc(url)
  }, [src, stem, urls])

  const selectStem = (next: StemKey) => {
    const url = data?.urls[next]
    if (!url || next === stem) return
    const audio = audioRef.current
    resumeRef.current = audio ? { time: audio.currentTime, play: !audio.paused } : null
    setStem(next)
    setSrc(url)
  }

  if (!src) return <p className="status-line">Preparing audio…</p>

  return (
    <div className="player">
      <audio
        ref={audioRef}
        controls
        src={src}
        data-testid="player-audio"
        onLoadedMetadata={() => {
          const resume = resumeRef.current
          if (!resume || !audioRef.current) return
          resumeRef.current = null
          audioRef.current.currentTime = resume.time
          // Post-swap resume is best-effort: if autoplay policy blocks it,
          // the user just presses play again.
          if (resume.play) void audioRef.current.play().catch(() => {})
        }}
      />
      {available.length > 1 && (
        <div className="player-stems" role="group" aria-label="Audio track">
          {available.map((k) => (
            <button key={k} aria-pressed={k === stem} onClick={() => selectStem(k)}>
              {STEM_LABELS[k]}
            </button>
          ))}
        </div>
      )}
      <WordSyncedLyrics
        songId={lyricsSongId ?? songId}
        pipelineDone={pipelineDone}
        audioRef={audioRef}
      />
    </div>
  )
}
