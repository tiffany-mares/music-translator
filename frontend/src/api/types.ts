export interface CreateSongResponse {
  songId: string
  uploadUrl: string
}

export type JobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETE' | 'FAILED'

export interface Job {
  jobId: string
  songId: string
  status: JobStatus
  stage?: string
  chunkCount?: number
  error?: string
}

// The four legitimate outcomes of POST /songs/{id}/process — all are UI states,
// not exceptions, so processSong returns this union instead of throwing.
export type ProcessOutcome =
  | { kind: 'started'; songId: string; format: string; jobId: string }
  | { kind: 'linked'; songId: string; linkedSongId: string; format: string }
  | { kind: 'rejected'; songId: string; reason: string }
  | { kind: 'startFailed'; songId: string; format: string; error: string }

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(`API error ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}
