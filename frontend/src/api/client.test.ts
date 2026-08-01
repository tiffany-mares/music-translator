import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSong,
  getAudioUrls,
  getDueVocab,
  getJob,
  getLyrics,
  getQuiz,
  getSongs,
  reviewVocab,
  toProcessOutcome,
  uploadFile,
} from './client'
import { ApiError } from './types'

const fetchMock = vi.fn()

beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status })
}

describe('createSong', () => {
  it('POSTs title with bearer token and parses songId/uploadUrl', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { songId: 'abc123abc123', uploadUrl: 'https://s3/put' }))
    const res = await createSong('tok', { title: 'My Song' })
    expect(res).toEqual({ songId: 'abc123abc123', uploadUrl: 'https://s3/put' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/songs')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({ title: 'My Song' })
  })

  it('throws ApiError with status and body on non-2xx', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }))
    await expect(createSong('tok')).rejects.toMatchObject({ status: 500, body: { error: 'boom' } })
  })
})

describe('uploadFile', () => {
  it('PUTs the file with no Authorization header', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    const file = new File(['x'], 'song.mp3')
    await uploadFile('https://s3/put', file)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://s3/put')
    expect(init.method).toBe('PUT')
    expect(init.body).toBe(file)
    expect(init.headers).toBeUndefined()
  })

  it('throws ApiError on non-2xx', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }))
    await expect(uploadFile('https://s3/put', new File(['x'], 's.mp3'))).rejects.toBeInstanceOf(ApiError)
  })
})

describe('toProcessOutcome', () => {
  it('maps the two 200 shapes', () => {
    expect(toProcessOutcome(200, { valid: true, songId: 's1', format: 'mp3', jobId: 's1.aaaa' })).toEqual({
      kind: 'started',
      songId: 's1',
      format: 'mp3',
      jobId: 's1.aaaa',
    })
    expect(toProcessOutcome(200, { valid: true, songId: 's2', linkedSongId: 's0', format: 'mp3' })).toEqual({
      kind: 'linked',
      songId: 's2',
      linkedSongId: 's0',
      format: 'mp3',
    })
  })

  it('maps rejection and start-failure, throws on anything else', () => {
    expect(toProcessOutcome(400, { valid: false, songId: 's3', reason: 'file too small' })).toEqual({
      kind: 'rejected',
      songId: 's3',
      reason: 'file too small',
    })
    expect(toProcessOutcome(500, { valid: true, songId: 's4', format: 'mp3', error: 'retry' })).toEqual({
      kind: 'startFailed',
      songId: 's4',
      format: 'mp3',
      error: 'retry',
    })
    expect(() => toProcessOutcome(502, { anything: true })).toThrow(ApiError)
  })
})

describe('getAudioUrls', () => {
  it('GETs /songs/{id}/audio-urls with bearer token and returns typed urls', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { urls: { raw: 'https://s3/raw?sig=1' }, expiresInSeconds: 900 }),
    )
    const res = await getAudioUrls('tok', 's1')
    expect(res.urls.raw).toBe('https://s3/raw?sig=1')
    expect(res.expiresInSeconds).toBe(900)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/songs/s1/audio-urls')
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('throws ApiError on 404', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'song not found' }))
    await expect(getAudioUrls('tok', 'nope')).rejects.toMatchObject({ status: 404 })
  })
})

describe('getLyrics', () => {
  it('GETs lyrics with the bearer token and parses the doc', async () => {
    const doc = {
      songId: 's1',
      sourceLanguage: 'ro',
      targetLanguage: 'en',
      lines: [
        {
          lineNumber: 1,
          originalText: 'Salut mondo',
          translatedText: 'Hello world',
          startTime: 1,
          endTime: 2,
          words: [
            { text: 'Salut', start: 1, end: 1.4 },
            { text: 'mondo', start: 1.5, end: 2 },
          ],
        },
      ],
    }
    fetchMock.mockResolvedValue(jsonResponse(200, doc))
    const res = await getLyrics('tok', 's1')
    expect(res).toEqual(doc)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/songs/s1/lyrics')
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('throws ApiError on the 404 that spans the whole QUEUED/PROCESSING window', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'lyrics not available' }))
    await expect(getLyrics('tok', 's1')).rejects.toMatchObject({
      status: 404,
      body: { error: 'lyrics not available' },
    })
  })
})

describe('getJob', () => {
  it('returns the typed job', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { jobId: 's1.aaaa', songId: 's1', status: 'PROCESSING', stage: 'ChunkAudio' }),
    )
    const job = await getJob('tok', 's1.aaaa')
    expect(job.status).toBe('PROCESSING')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/jobs/s1.aaaa')
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('throws ApiError on 404', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'job not found' }))
    await expect(getJob('tok', 's1.zzzz')).rejects.toMatchObject({ status: 404 })
  })
})

describe('reviewVocab', () => {
  it('POSTs the full encounter body with bearer token and parses the schedule', async () => {
    const result = {
      vocabId: 'inimă', nextReviewAt: '2026-08-01T12:00:00Z',
      intervalDays: 1, repetitions: 0, easeFactor: 2.5, created: true,
    }
    fetchMock.mockResolvedValue(jsonResponse(200, result))
    const req = { vocabId: 'inimă', quality: 0, term: 'inimă', definition: 'my heart', songId: 's1' }
    const res = await reviewVocab('tok', req)
    expect(res).toEqual(result)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/vocab/review')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual(req)
  })

  it('throws ApiError on 400 bad quality', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'quality must be 0-5' }))
    await expect(reviewVocab('tok', { vocabId: 'x', quality: 7 })).rejects.toMatchObject({
      status: 400, body: { error: 'quality must be 0-5' },
    })
  })

  it('throws ApiError on 404 unknown item without term', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'vocab item not found' }))
    await expect(reviewVocab('tok', { vocabId: 'ghost', quality: 4 })).rejects.toMatchObject({ status: 404 })
  })
})

describe('getDueVocab', () => {
  it('GETs /vocab/due with the bearer token and parses items', async () => {
    const due = {
      items: [{ vocabId: 'dor', term: 'dor', definition: 'longing', songId: 's1', nextReviewAt: '2026-01-01T00:00:00Z' }],
      count: 1,
    }
    fetchMock.mockResolvedValue(jsonResponse(200, due))
    const res = await getDueVocab('tok')
    expect(res).toEqual(due)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/vocab/due')
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('throws ApiError on non-2xx', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }))
    await expect(getDueVocab('tok')).rejects.toBeInstanceOf(ApiError)
  })
})

describe('getQuiz', () => {
  it('GETs /vocab/quiz and parses questions incl. null context fields', async () => {
    const quiz = {
      questions: [{
        vocabId: 'zzz', term: 'zzz', definition: 'nonsense', hasContext: false,
        songId: null, lineNumber: null, prompt: null, translation: null,
      }],
      count: 1,
    }
    fetchMock.mockResolvedValue(jsonResponse(200, quiz))
    const res = await getQuiz('tok')
    expect(res).toEqual(quiz)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/vocab/quiz')
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('throws ApiError on non-2xx', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, null))
    await expect(getQuiz('tok')).rejects.toMatchObject({ status: 500 })
  })
})

// --- Phase 7 (lovable-reskin): public routes work without a token ------------

describe('anonymous public requests', () => {
  it('createSong with null token sends NO Authorization header', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { songId: 'x', uploadUrl: 'u' }))
    await createSong(null, { title: 'Anon' })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBeUndefined()
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('getJob with null token sends no auth header and parses the job', async () => {
    const job = { jobId: 's1.aaaa', songId: 's1', status: 'QUEUED' }
    fetchMock.mockResolvedValue(jsonResponse(200, job))
    expect(await getJob(null, 's1.aaaa')).toEqual(job)
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers?.Authorization).toBeUndefined()
  })
})

describe('getSongs', () => {
  it('fetches the public catalog without a token', async () => {
    const songs = [{ songId: 'a', title: 'T', artist: 'A', status: 'VALIDATED',
      createdAt: '2026-07-01T00:00:00+00:00', sourceLanguage: 'ro' }]
    fetchMock.mockResolvedValue(jsonResponse(200, { songs }))
    expect(await getSongs(null)).toEqual(songs)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/songs$/)
    expect(init?.headers?.Authorization).toBeUndefined()
  })

  it('still sends the bearer token when signed in', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { songs: [] }))
    await getSongs('tok')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('throws ApiError on failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'scan failed' }))
    await expect(getSongs(null)).rejects.toMatchObject({ status: 500 })
  })
})
