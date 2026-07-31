import { useEffect, useRef, useState } from 'react'
import WordSyncedLyrics, { type PipelineState } from '../lyrics/WordSyncedLyrics'
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
  const pipelineState: PipelineState =
    jobId === null || job?.status === 'COMPLETE'
      ? 'done'
      : job?.status === 'FAILED'
        ? 'failed'
        : 'running'
  const pipelineDone = pipelineState === 'done' // audio-urls queryKey unchanged
  const { data, isError: urlsError, refetch: refetchUrls } = useAudioUrls(songId, pipelineDone)

  const audioRef = useRef<HTMLAudioElement>(null)
  const resumeRef = useRef<{ time: number; play: boolean } | null>(null)
  const [stem, setStem] = useState<StemKey>('raw')
  const [src, setSrc] = useState<string>()
  const [mediaError, setMediaError] = useState(false)

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
    setMediaError(false)
    setStem(next)
    setSrc(url)
  }

  // Expiry-mid-playback recovery. Deliberately NOT setSrc(undefined)+adoption-effect:
  // that effect ([src, stem, urls] deps) would fire with the STALE cached urls and
  // re-adopt the expired URL before the refetch lands. Direct-set after the awaited
  // refetch, same pattern as selectStem. On refetch failure (isSuccess false) keep
  // the error state so the button remains. `stem` captured at click time is an
  // accepted micro-staleness (same class selectStem already accepts).
  const reloadTrack = async () => {
    const audio = audioRef.current
    resumeRef.current = audio ? { time: audio.currentTime, play: false } : null
    const res = await refetchUrls()
    const url = res.isSuccess ? res.data.urls[stem] : undefined
    if (url) {
      setMediaError(false)
      setSrc(url)
    }
  }

  if (!src) {
    if (urlsError)
      return (
        <div className="player">
          <p role="alert" className="auth-error">
            Couldn&apos;t load audio.
          </p>
          <button onClick={() => void refetchUrls()}>Retry</button>
        </div>
      )
    return <p className="status-line">Preparing audio…</p>
  }

  return (
    <div className="player">
      <audio
        ref={audioRef}
        controls
        src={src}
        data-testid="player-audio"
        onError={() => setMediaError(true)}
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
      {mediaError && (
        <>
          <p role="alert" className="auth-error">
            Audio failed to load — the link may have expired.
          </p>
          <button onClick={() => void reloadTrack()}>Reload track</button>
        </>
      )}
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
        pipelineState={pipelineState}
        audioRef={audioRef}
      />
    </div>
  )
}
