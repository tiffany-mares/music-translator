export interface CreateSongResponse {
  songId: string
  uploadUrl: string
}

// One entry in the public site-wide catalog (GET /songs, Phase 7).
export interface SongListing {
  songId: string
  title: string
  artist: string
  status: string
  createdAt: string
  sourceLanguage: string | null
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

export interface AudioUrls {
  urls: { raw?: string; vocals?: string; noVocals?: string }
  expiresInSeconds: number
}

export interface LyricsWord {
  text: string
  start: number // seconds
  end: number // seconds
}

export interface LyricsLine {
  lineNumber: number
  originalText: string
  // Contract: non-null by COMPLETE, but the doc shape allows null pre-translation - tolerate it.
  translatedText: string | null
  startTime: number
  endTime: number
  words: LyricsWord[] // [] is structurally valid - tolerate it
}

export interface LyricsDoc {
  songId: string
  sourceLanguage: string
  targetLanguage: string
  lines: LyricsLine[]
}

// --- Vocab / spaced repetition (Phase 5.5) ---

export interface ReviewRequest {
  vocabId: string
  quality: number // SM-2 quality 0-5
  // Present on encounter (create-on-first-review); absent on quiz answers.
  term?: string
  definition?: string
  songId?: string
}

export interface ReviewResult {
  vocabId: string
  nextReviewAt: string // ISO-8601
  intervalDays: number
  repetitions: number
  easeFactor: number
  created: boolean
}

export interface DueVocabItem {
  vocabId: string
  term: string
  definition: string
  songId: string | null
  nextReviewAt: string
}

export interface DueVocabResponse {
  items: DueVocabItem[] // most-overdue first
  count: number
}

export interface QuizQuestion {
  vocabId: string
  term: string
  definition: string
  hasContext: boolean
  // The four context fields are explicit nulls when hasContext is false.
  songId: string | null
  lineNumber: number | null
  prompt: string | null // real lyric line with the term blanked as ____
  translation: string | null
}

export interface QuizResponse {
  questions: QuizQuestion[]
  count: number
}

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
