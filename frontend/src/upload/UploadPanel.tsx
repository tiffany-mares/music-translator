import { useRef, useState, type FormEvent } from 'react'
import { Music, Upload } from 'lucide-react'
import type { View } from '../nav/NavShell'
import Player from '../player/Player'
import Vinyl from '../player/Vinyl'
import JobStatusLine from './JobStatusLine'
import { useJobPolling } from './useJobPolling'
import { useUploadFlow } from './useUploadFlow'

const panelCls = 'mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12'
const pillCls =
  'font-button self-start rounded-full border border-brass/50 px-5 py-2.5 text-brass hover:bg-brass/10'

// Re-skin only (Phase 7): the REAL upload flow drives everything — no
// simulated pipeline. Every test-asserted name/copy string is unchanged.
export default function UploadPanel({ onNavigate }: { onNavigate?: (view: View) => void } = {}) {
  const { state, start, retryProcess, reset } = useUploadFlow()
  // Same ['job', jobId] key as JobStatusLine + Player — RQ dedupes, zero extra requests.
  const { data: polledJob } = useJobPolling(state.step === 'polling' ? state.jobId : null)
  const [title, setTitle] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const busy = state.step === 'creating' || state.step === 'uploading' || state.step === 'processing'

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (file) void start(file, title.trim() || undefined)
  }

  if (state.step === 'polling') {
    const failed = polledJob?.status === 'FAILED'
    const done = polledJob?.status === 'COMPLETE'
    return (
      <div className={panelCls}>
        {/* the loading centerpiece: a spinning disc while the pipeline runs */}
        {!done && (
          <div className="flex flex-col items-center gap-4 text-center">
            <Vinyl size={160} spinning={!failed} />
            <JobStatusLine jobId={state.jobId} />
            {!failed && (
              <>
                <p className="max-w-sm text-sm text-muted-foreground">
                  A brand-new song can take up to 30 minutes to fully process — you don&apos;t
                  need to wait here. Playback below starts right away, and the song keeps
                  loading while you explore.
                </p>
                {onNavigate && (
                  <button
                    type="button"
                    className={pillCls}
                    onClick={() => onNavigate('library')}
                  >
                    Explore the library in the meantime
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {done && <JobStatusLine jobId={state.jobId} />}
        <Player songId={state.songId} jobId={state.jobId} />
        {failed && (
          <button type="button" className={pillCls} onClick={() => void retryProcess()}>
            Try again
          </button>
        )}
      </div>
    )
  }

  if (state.step === 'linked') {
    return (
      <div className={panelCls}>
        <p className="status-line status-complete label-mono text-sage">
          Ready (matched an existing song).
        </p>
        <Player songId={state.songId} jobId={null} lyricsSongId={state.linkedSongId} />
        <button type="button" className={pillCls} onClick={reset}>
          Upload another
        </button>
      </div>
    )
  }

  if (state.step === 'rejected' || state.step === 'error' || state.step === 'startFailed') {
    const message =
      state.step === 'rejected' ? state.reason : state.step === 'error' ? state.message : state.error
    return (
      <div className={panelCls}>
        <p
          role="alert"
          className="rounded-[3px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive"
        >
          {message}
        </p>
        {state.step === 'startFailed' ? (
          <button type="button" className={pillCls} onClick={() => void retryProcess()}>
            Retry processing
          </button>
        ) : (
          <button type="button" className={pillCls} onClick={reset}>
            Upload another
          </button>
        )}
      </div>
    )
  }

  return (
    <form className={panelCls} onSubmit={handleSubmit} aria-label="Upload a song">
      <div className="label-mono flex items-center gap-3 text-brass">
        <span className="whitespace-nowrap">[ UPLOAD ]</span>
        <span className="sweep-rule hidden flex-1 sm:block" />
      </div>
      <h1 className="font-content text-5xl leading-[0.95] tracking-[-0.02em]">
        Add a <span className="text-brass">song</span>
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Cadenza separates the vocals, times every word, and translates every line. Anything you
        already love <span className="text-sage">singing along</span> to works best.
      </p>
      <label className="label-mono flex max-w-md flex-col gap-1.5 text-muted-foreground">
        Title (optional)
        <input
          className="w-full rounded-[3px] border border-border bg-surface px-4 py-3 text-sm text-foreground outline-none focus:border-brass"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
        />
      </label>
      <label className="label-mono flex max-w-md cursor-pointer flex-col gap-1.5 text-muted-foreground">
        Audio file
        <span className="corner-ticks plate flex flex-col items-center gap-3 rounded-[10px] px-6 py-10 text-center">
          <Music className="h-8 w-8 text-brass" aria-hidden />
          <span className="font-content text-lg normal-case tracking-normal text-foreground">
            {fileName ?? 'Choose an audio file'}
          </span>
          <span className="text-muted-foreground">MP3 · WAV · FLAC · OGG · M4A</span>
          <input
            ref={fileRef}
            type="file"
            accept=".mp3,.wav,.flac,.ogg,.m4a,audio/*"
            required
            disabled={busy}
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            className="sr-only"
          />
        </span>
      </label>
      <button
        type="submit"
        disabled={busy}
        className="font-button group/btn relative inline-flex max-w-md items-center justify-center gap-2.5 overflow-hidden rounded-full bg-brass px-6 py-3 text-ink transition-all duration-500 hover:-translate-y-1 hover:bg-brass-soft active:scale-[0.98] disabled:opacity-60"
      >
        <Upload className="h-4 w-4" aria-hidden />
        {state.step === 'creating'
          ? 'Creating song…'
          : state.step === 'uploading'
            ? 'Uploading…'
            : state.step === 'processing'
              ? 'Validating…'
              : 'Upload'}
      </button>
    </form>
  )
}
