import {
  ApiError,
  type AudioUrls,
  type CreateSongResponse,
  type Job,
  type LyricsDoc,
  type ProcessOutcome,
} from './types'

const BASE = import.meta.env.VITE_API_BASE_URL

async function parseJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export async function createSong(
  token: string,
  meta?: { title?: string; artist?: string },
): Promise<CreateSongResponse> {
  const res = await fetch(`${BASE}/songs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(meta ?? {}),
  })
  const body = await parseJson(res)
  if (!res.ok) throw new ApiError(res.status, body)
  return body as CreateSongResponse
}

// Presigned PUT: authentication is baked into the URL; adding headers that
// weren't signed (like Authorization) can invalidate the signature.
export async function uploadFile(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, { method: 'PUT', body: file })
  if (!res.ok) throw new ApiError(res.status, null)
}

export function toProcessOutcome(status: number, body: Record<string, unknown>): ProcessOutcome {
  const songId = String(body.songId ?? '')
  const format = String(body.format ?? '')
  if (status === 200 && typeof body.jobId === 'string') {
    return { kind: 'started', songId, format, jobId: body.jobId }
  }
  if (status === 200 && typeof body.linkedSongId === 'string') {
    return { kind: 'linked', songId, linkedSongId: body.linkedSongId, format }
  }
  if (status === 400 && body.valid === false) {
    return { kind: 'rejected', songId, reason: String(body.reason ?? 'upload rejected') }
  }
  if (status === 500 && body.valid === true && typeof body.error === 'string') {
    return { kind: 'startFailed', songId, format, error: body.error }
  }
  throw new ApiError(status, body)
}

export async function processSong(token: string, songId: string): Promise<ProcessOutcome> {
  const res = await fetch(`${BASE}/songs/${songId}/process`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await parseJson(res)
  return toProcessOutcome(res.status, (body ?? {}) as Record<string, unknown>)
}

export async function getAudioUrls(token: string, songId: string): Promise<AudioUrls> {
  const res = await fetch(`${BASE}/songs/${songId}/audio-urls`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await parseJson(res)
  if (!res.ok) throw new ApiError(res.status, body)
  return body as AudioUrls
}

export async function getLyrics(token: string, songId: string): Promise<LyricsDoc> {
  const res = await fetch(`${BASE}/songs/${songId}/lyrics`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await parseJson(res)
  if (!res.ok) throw new ApiError(res.status, body)
  return body as LyricsDoc
}

export async function getJob(token: string, jobId: string): Promise<Job> {
  const res = await fetch(`${BASE}/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await parseJson(res)
  if (!res.ok) throw new ApiError(res.status, body)
  return body as Job
}
