import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSong, getAudioUrls, getJob, getLyrics, toProcessOutcome, uploadFile } from './client'
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
