import { useCallback, useRef, useState } from 'react'
import { createSong, processSong, uploadFile } from '../api/client'
import type { ProcessOutcome } from '../api/types'
import { useAuth } from '../auth/AuthContext'

const MIN_BYTES = 50 * 1024
const MAX_BYTES = 25 * 1024 * 1024

export type UploadFlowState =
  | { step: 'idle' }
  | { step: 'creating' }
  | { step: 'uploading'; songId: string }
  | { step: 'processing'; songId: string }
  | { step: 'polling'; songId: string; jobId: string }
  | { step: 'linked'; songId: string; linkedSongId: string }
  | { step: 'rejected'; reason: string; songId?: string }
  | { step: 'startFailed'; songId: string; error: string }
  | { step: 'error'; message: string }

export function useUploadFlow() {
  const { getOptionalIdToken } = useAuth()
  const [state, setState] = useState<UploadFlowState>({ step: 'idle' })
  // Survives the state machine so retryProcess can re-POST after startFailed.
  const songIdRef = useRef<string | null>(null)

  const applyOutcome = (outcome: ProcessOutcome) => {
    switch (outcome.kind) {
      case 'started':
        setState({ step: 'polling', songId: outcome.songId, jobId: outcome.jobId })
        break
      case 'linked':
        setState({ step: 'linked', songId: outcome.songId, linkedSongId: outcome.linkedSongId })
        break
      case 'rejected':
        setState({ step: 'rejected', songId: outcome.songId, reason: outcome.reason })
        break
      case 'startFailed':
        setState({ step: 'startFailed', songId: outcome.songId, error: outcome.error })
        break
    }
  }

  // User-event driven only — never called from an effect, so StrictMode's
  // double-invoked effects cannot double-create songs.
  const start = useCallback(
    async (file: File, title?: string) => {
      if (file.size < MIN_BYTES || file.size > MAX_BYTES) {
        setState({ step: 'rejected', reason: 'File must be between 50 KB and 25 MB.' })
        return
      }
      const meta = title ? { title } : undefined
      try {
        setState({ step: 'creating' })
        let created = await createSong(await getOptionalIdToken(), meta)
        setState({ step: 'uploading', songId: created.songId })
        try {
          await uploadFile(created.uploadUrl, file)
        } catch {
          // Presign may have expired (15-min TTL). One automatic re-presign;
          // POST /songs mints a NEW songId, so carry the fresh one forward.
          created = await createSong(await getOptionalIdToken(), meta)
          setState({ step: 'uploading', songId: created.songId })
          await uploadFile(created.uploadUrl, file)
        }
        songIdRef.current = created.songId
        setState({ step: 'processing', songId: created.songId })
        // Fresh token: the PUT of a large file can outlive short token windows.
        applyOutcome(await processSong(await getOptionalIdToken(), created.songId))
      } catch (err) {
        setState({ step: 'error', message: err instanceof Error ? err.message : 'Upload failed' })
      }
    },
    [getOptionalIdToken],
  )

  // The 500 contract says: retry POST /process only. Never re-uploads.
  const retryProcess = useCallback(async () => {
    const songId = songIdRef.current
    if (!songId) return
    try {
      setState({ step: 'processing', songId })
      applyOutcome(await processSong(await getOptionalIdToken(), songId))
    } catch (err) {
      setState({ step: 'error', message: err instanceof Error ? err.message : 'Retry failed' })
    }
  }, [getOptionalIdToken])

  const reset = useCallback(() => setState({ step: 'idle' }), [])

  return { state, start, retryProcess, reset }
}
