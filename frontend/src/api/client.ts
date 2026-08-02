import {
  ApiError,
  type AudioUrls,
  type CreateSongResponse,
  type DueVocabResponse,
  type Job,
  type LyricsDoc,
  type ProcessOutcome,
  type QuizResponse,
  type MyLibraryResponse,
  type ProfileResponse,
  type ReviewRequest,
  type ReviewResult,
  type SongListing,
} from './types'

const BASE = import.meta.env.VITE_API_BASE_URL

async function parseJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

// The listen/upload path is public (Phase 7): those routes take
// `token: string | null` and send Authorization only when signed in.
// The /vocab/* routes keep the required `token: string`.
function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function createSong(
  token: string | null,
  meta?: { title?: string; artist?: string; sourceLanguage?: string },
): Promise<CreateSongResponse> {
  const res = await fetch(`${BASE}/songs`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(meta ?? {}),
  })
  const body = await parseJson(res)
  if (!res.ok) throw new ApiError(res.status, body)
  return body as CreateSongResponse
}

export async function getSongs(token: string | null): Promise<SongListing[]> {
  const res = await fetch(`${BASE}/songs`, { headers: authHeaders(token) })
  const body = await parseJson(res)
  if (!res.ok) throw new ApiError(res.status, body)
  return (body as { songs: SongListing[] }).songs
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

export async function processSong(token: string | null, songId: string): Promise<ProcessOutcome> {
  const res = await fetch(`${BASE}/songs/${songId}/process`, {
    method: 'POST',
    headers: authHeaders(token),
  })
  const body = await parseJson(res)
  return toProcessOutcome(res.status, (body ?? {}) as Record<string, unknown>)
}

export async function getAudioUrls(token: string | null, songId: string): Promise<AudioUrls> {
  const res = await fetch(`${BASE}/songs/${songId}/audio-urls`, {
    headers: authHeaders(token),
  })
  const body = await parseJson(res)
  if (!res.ok) throw new ApiError(res.status, body)
  return body as AudioUrls
}

export async function getLyrics(token: string | null, songId: string): Promise<LyricsDoc> {
  const res = await fetch(`${BASE}/songs/${songId}/lyrics`, {
    headers: authHeaders(token),
  })
  const body = await parseJson(res)
  if (!res.ok) throw new ApiError(res.status, body)
  return body as LyricsDoc
}

export async function getJob(token: string | null, jobId: string): Promise<Job> {
  const res = await fetch(`${BASE}/jobs/${jobId}`, {
    headers: authHeaders(token),
  })
  const body = await parseJson(res)
  if (!res.ok) throw new ApiError(res.status, body)
  return body as Job
}

export async function reviewVocab(token: string, req: ReviewRequest): Promise<ReviewResult> {
  const res = await fetch(`${BASE}/vocab/review`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  const body = await parseJson(res)
  if (!res.ok) throw new ApiError(res.status, body)
  return body as ReviewResult
}

// The user's whole collection (every saved word, soonest next-review first).
export async function getAllVocab(token: string): Promise<DueVocabResponse> {
  const res = await fetch(`${BASE}/vocab`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await parseJson(res)
  if (!res.ok) throw new ApiError(res.status, body)
  return body as DueVocabResponse
}

export async function getDueVocab(token: string): Promise<DueVocabResponse> {
  const res = await fetch(`${BASE}/vocab/due`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await parseJson(res)
  if (!res.ok) throw new ApiError(res.status, body)
  return body as DueVocabResponse
}

export async function getMyLibrary(token: string): Promise<MyLibraryResponse> {
  const res = await fetch(`${BASE}/library`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await parseJson(res)
  if (!res.ok) throw new ApiError(res.status, body)
  return body as MyLibraryResponse
}

export async function addToMyLibrary(token: string, songId: string): Promise<void> {
  const res = await fetch(`${BASE}/library/${songId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new ApiError(res.status, await parseJson(res))
}

export async function removeFromMyLibrary(token: string, songId: string): Promise<void> {
  const res = await fetch(`${BASE}/library/${songId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new ApiError(res.status, await parseJson(res))
}

export async function getProfile(token: string): Promise<ProfileResponse> {
  const res = await fetch(`${BASE}/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await parseJson(res)
  if (!res.ok) throw new ApiError(res.status, body)
  return body as ProfileResponse
}

export async function putProfile(token: string, targetLanguage: string): Promise<ProfileResponse> {
  const res = await fetch(`${BASE}/profile`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetLanguage }),
  })
  const body = await parseJson(res)
  if (!res.ok) throw new ApiError(res.status, body)
  return body as ProfileResponse
}

export async function getQuiz(token: string): Promise<QuizResponse> {
  const res = await fetch(`${BASE}/vocab/quiz`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await parseJson(res)
  if (!res.ok) throw new ApiError(res.status, body)
  return body as QuizResponse
}
