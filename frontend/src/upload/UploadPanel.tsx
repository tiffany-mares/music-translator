import { useRef, useState, type FormEvent } from 'react'
import Player from '../player/Player'
import JobStatusLine from './JobStatusLine'
import { useUploadFlow } from './useUploadFlow'

export default function UploadPanel() {
  const { state, start, retryProcess, reset } = useUploadFlow()
  const [title, setTitle] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const busy = state.step === 'creating' || state.step === 'uploading' || state.step === 'processing'

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (file) void start(file, title.trim() || undefined)
  }

  if (state.step === 'polling') {
    return (
      <div className="upload-panel">
        <JobStatusLine jobId={state.jobId} />
        <Player songId={state.songId} jobId={state.jobId} />
      </div>
    )
  }

  if (state.step === 'linked') {
    return (
      <div className="upload-panel">
        <p className="status-line status-complete">Ready (matched an existing song).</p>
        <Player songId={state.songId} jobId={null} />
        <button onClick={reset}>Upload another</button>
      </div>
    )
  }

  if (state.step === 'rejected' || state.step === 'error' || state.step === 'startFailed') {
    const message =
      state.step === 'rejected' ? state.reason : state.step === 'error' ? state.message : state.error
    return (
      <div className="upload-panel">
        <p role="alert" className="auth-error">
          {message}
        </p>
        {state.step === 'startFailed' ? (
          <button onClick={() => void retryProcess()}>Retry processing</button>
        ) : (
          <button onClick={reset}>Upload another</button>
        )}
      </div>
    )
  }

  return (
    <form className="upload-panel" onSubmit={handleSubmit} aria-label="Upload a song">
      <label>
        Title (optional)
        <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
      </label>
      <label>
        Audio file
        <input ref={fileRef} type="file" accept=".mp3,.wav,.flac,.ogg,.m4a,audio/*" required disabled={busy} />
      </label>
      <button type="submit" disabled={busy}>
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
