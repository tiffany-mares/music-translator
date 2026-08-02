import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplifyAuth from 'aws-amplify/auth'
import * as api from '../api/client'
import type { Job } from '../api/types'
import { renderWithProviders } from '../test/renderWithProviders'
import UploadPanel from './UploadPanel'

vi.mock('aws-amplify/auth')
vi.mock('../api/client')
const mockedAuth = vi.mocked(amplifyAuth)
const mockedApi = vi.mocked(api)

type Session = Awaited<ReturnType<typeof amplifyAuth.fetchAuthSession>>
const session = {
  tokens: { idToken: { toString: () => 'tok', payload: { email: 'x@y.com' } } },
} as unknown as Session

function audioFile(bytes = 60 * 1024, name = 'song.mp3') {
  return new File([new Uint8Array(bytes)], name, { type: 'audio/mpeg' })
}

async function pickAndSubmit(file: File, title?: string) {
  if (title) await userEvent.type(screen.getByLabelText(/title/i), title)
  await userEvent.upload(screen.getByLabelText(/audio file/i), file)
  // jsdom marks a `required` file input invalid even with files attached, so a
  // click on the submit button is blocked by constraint validation there (real
  // browsers validate correctly). Submit the form directly instead.
  fireEvent.submit(screen.getByRole('form', { name: /upload a song/i }))
}

describe('UploadPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
    // Player renders in polling/linked branches; keep its queries deterministic.
    mockedApi.getAudioUrls.mockResolvedValue({ urls: { raw: 'https://s3/raw?d' }, expiresInSeconds: 900 })
    mockedApi.getLyrics.mockResolvedValue({
      songId: 's0',
      sourceLanguage: 'ro',
      targetLanguage: 'en',
      lines: [],
    })
  })

  it('runs the full started path and shows job status', async () => {
    mockedApi.createSong.mockResolvedValue({ songId: 's1', uploadUrl: 'https://s3/put' })
    mockedApi.uploadFile.mockResolvedValue(undefined)
    mockedApi.processSong.mockResolvedValue({ kind: 'started', songId: 's1', format: 'mp3', jobId: 's1.aaaa' })
    mockedApi.getJob.mockResolvedValue({ jobId: 's1.aaaa', songId: 's1', status: 'QUEUED' } as Job)
    renderWithProviders(<UploadPanel />)
    await pickAndSubmit(audioFile(), 'My Song')
    await waitFor(() => expect(screen.getByText(/queued/i)).toBeInTheDocument())
    // upload form now collects title + artist + language (empty when the test
    // helper doesn't fill them; jsdom submit bypasses native `required`)
    expect(mockedApi.createSong).toHaveBeenCalledWith('tok', {
      title: 'My Song',
      artist: '',
      sourceLanguage: '',
    })
    expect(mockedApi.uploadFile).toHaveBeenCalledWith('https://s3/put', expect.any(File))
    expect(mockedApi.processSong).toHaveBeenCalledWith('tok', 's1')
  })

  it('shows ready immediately on a cache hit and never polls', async () => {
    mockedApi.createSong.mockResolvedValue({ songId: 's2', uploadUrl: 'https://s3/put' })
    mockedApi.uploadFile.mockResolvedValue(undefined)
    mockedApi.processSong.mockResolvedValue({ kind: 'linked', songId: 's2', linkedSongId: 's0', format: 'mp3' })
    renderWithProviders(<UploadPanel />)
    await pickAndSubmit(audioFile())
    await waitFor(() => expect(screen.getByText(/matched an existing song/i)).toBeInTheDocument())
    expect(mockedApi.getJob).not.toHaveBeenCalled()
  })

  it('shows the server rejection reason', async () => {
    mockedApi.createSong.mockResolvedValue({ songId: 's3', uploadUrl: 'https://s3/put' })
    mockedApi.uploadFile.mockResolvedValue(undefined)
    mockedApi.processSong.mockResolvedValue({ kind: 'rejected', songId: 's3', reason: 'unsupported format' })
    renderWithProviders(<UploadPanel />)
    await pickAndSubmit(audioFile())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('unsupported format'))
  })

  it('start failure offers retry that re-processes without re-uploading', async () => {
    mockedApi.createSong.mockResolvedValue({ songId: 's4', uploadUrl: 'https://s3/put' })
    mockedApi.uploadFile.mockResolvedValue(undefined)
    mockedApi.processSong
      .mockResolvedValueOnce({ kind: 'startFailed', songId: 's4', format: 'mp3', error: 'pipeline failed to start' })
      .mockResolvedValueOnce({ kind: 'started', songId: 's4', format: 'mp3', jobId: 's4.bbbb' })
    mockedApi.getJob.mockResolvedValue({ jobId: 's4.bbbb', songId: 's4', status: 'QUEUED' } as Job)
    renderWithProviders(<UploadPanel />)
    await pickAndSubmit(audioFile())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('pipeline failed to start'))
    await userEvent.click(screen.getByRole('button', { name: /retry processing/i }))
    await waitFor(() => expect(screen.getByText(/queued/i)).toBeInTheDocument())
    expect(mockedApi.createSong).toHaveBeenCalledTimes(1)
    expect(mockedApi.uploadFile).toHaveBeenCalledTimes(1)
    expect(mockedApi.processSong).toHaveBeenCalledTimes(2)
  })

  it('rejects undersized files client-side with zero API calls', async () => {
    renderWithProviders(<UploadPanel />)
    await pickAndSubmit(audioFile(10 * 1024))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/between 50 KB and 25 MB/i))
    expect(mockedApi.createSong).not.toHaveBeenCalled()
  })

  it('polling branch shows the player with raw audio while the job is still queued', async () => {
    mockedApi.createSong.mockResolvedValue({ songId: 's1', uploadUrl: 'https://s3/put' })
    mockedApi.uploadFile.mockResolvedValue(undefined)
    mockedApi.processSong.mockResolvedValue({ kind: 'started', songId: 's1', format: 'mp3', jobId: 's1.aaaa' })
    mockedApi.getJob.mockResolvedValue({ jobId: 's1.aaaa', songId: 's1', status: 'QUEUED' } as Job)
    mockedApi.getAudioUrls.mockResolvedValue({ urls: { raw: 'https://s3/raw?q' }, expiresInSeconds: 900 })
    renderWithProviders(<UploadPanel />)
    await pickAndSubmit(audioFile())
    // The done-when in miniature: job status AND playable audio visible together.
    await waitFor(() => expect(screen.getByText(/queued/i)).toBeInTheDocument())
    await waitFor(() =>
      expect(screen.getByTestId('player-audio')).toHaveAttribute('src', 'https://s3/raw?q'),
    )
    expect(mockedApi.getAudioUrls).toHaveBeenCalledWith('tok', 's1')
  })

  it('linked branch shows the player for the new songId without polling', async () => {
    mockedApi.createSong.mockResolvedValue({ songId: 's2', uploadUrl: 'https://s3/put' })
    mockedApi.uploadFile.mockResolvedValue(undefined)
    mockedApi.processSong.mockResolvedValue({ kind: 'linked', songId: 's2', linkedSongId: 's0', format: 'mp3' })
    mockedApi.getAudioUrls.mockResolvedValue({
      urls: { raw: 'https://s3/raw?l', vocals: 'https://s3/v?l', noVocals: 'https://s3/nv?l' },
      expiresInSeconds: 900,
    })
    renderWithProviders(<UploadPanel />)
    await pickAndSubmit(audioFile())
    await waitFor(() => expect(screen.getByText(/matched an existing song/i)).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('player-audio')).toBeInTheDocument())
    expect(mockedApi.getAudioUrls).toHaveBeenCalledWith('tok', 's2')
    expect(mockedApi.getJob).not.toHaveBeenCalled()
  })

  it('linked branch shows the ORIGINAL songs lyrics instantly (fetched by linkedSongId)', async () => {
    const lyricsDoc = {
      songId: 's0',
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
    mockedApi.createSong.mockResolvedValue({ songId: 's2', uploadUrl: 'https://s3/put' })
    mockedApi.uploadFile.mockResolvedValue(undefined)
    mockedApi.processSong.mockResolvedValue({ kind: 'linked', songId: 's2', linkedSongId: 's0', format: 'mp3' })
    mockedApi.getLyrics.mockResolvedValue(lyricsDoc)
    renderWithProviders(<UploadPanel />)
    await pickAndSubmit(audioFile())
    await waitFor(() => expect(mockedApi.getLyrics).toHaveBeenCalledWith('tok', 's0'))
    await waitFor(() => expect(screen.getByText('Salut')).toBeInTheDocument())
  })

  it('FAILED job surfaces the alert + Try again while the player stays mounted', async () => {
    mockedApi.createSong.mockResolvedValue({ songId: 's5', uploadUrl: 'https://s3/put' })
    mockedApi.uploadFile.mockResolvedValue(undefined)
    mockedApi.processSong.mockResolvedValue({ kind: 'started', songId: 's5', format: 'mp3', jobId: 's5.aaaa' })
    mockedApi.getJob.mockResolvedValue({
      jobId: 's5.aaaa', songId: 's5', status: 'FAILED', error: 'soundfile decode error',
    } as Job)
    renderWithProviders(<UploadPanel />)
    await pickAndSubmit(audioFile())
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/processing failed: soundfile decode error/i),
    )
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    // 4.3 decision: raw playback survives a pipeline failure.
    expect(screen.getByTestId('player-audio')).toBeInTheDocument()
  })

  it('Try again re-POSTs /process only and restarts polling under the fresh jobId', async () => {
    mockedApi.createSong.mockResolvedValue({ songId: 's6', uploadUrl: 'https://s3/put' })
    mockedApi.uploadFile.mockResolvedValue(undefined)
    mockedApi.processSong
      .mockResolvedValueOnce({ kind: 'started', songId: 's6', format: 'mp3', jobId: 's6.aaaa' })
      .mockResolvedValueOnce({ kind: 'started', songId: 's6', format: 'mp3', jobId: 's6.bbbb' })
    // Key on jobId: three deduped observers share one fetch per key — order-based
    // mockResolvedValueOnce chains would be fragile here.
    mockedApi.getJob.mockImplementation(async (_t: string | null, jobId: string) =>
      jobId === 's6.aaaa'
        ? ({ jobId, songId: 's6', status: 'FAILED', error: 'boom' } as Job)
        : ({ jobId, songId: 's6', status: 'QUEUED' } as Job),
    )
    renderWithProviders(<UploadPanel />)
    await pickAndSubmit(audioFile())
    await waitFor(() => expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(screen.getByText(/queued/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
    expect(mockedApi.createSong).toHaveBeenCalledTimes(1)
    expect(mockedApi.uploadFile).toHaveBeenCalledTimes(1)
    expect(mockedApi.processSong).toHaveBeenNthCalledWith(2, 'tok', 's6')
    expect(mockedApi.getJob).toHaveBeenCalledWith('tok', 's6.bbbb')
  })

  it('re-presigns once on PUT failure and continues with the new songId', async () => {
    mockedApi.createSong
      .mockResolvedValueOnce({ songId: 'old1', uploadUrl: 'https://s3/put-expired' })
      .mockResolvedValueOnce({ songId: 'new1', uploadUrl: 'https://s3/put-fresh' })
    mockedApi.uploadFile.mockRejectedValueOnce(new Error('403')).mockResolvedValueOnce(undefined)
    mockedApi.processSong.mockResolvedValue({ kind: 'started', songId: 'new1', format: 'mp3', jobId: 'new1.cccc' })
    mockedApi.getJob.mockResolvedValue({ jobId: 'new1.cccc', songId: 'new1', status: 'QUEUED' } as Job)
    renderWithProviders(<UploadPanel />)
    await pickAndSubmit(audioFile())
    await waitFor(() => expect(screen.getByText(/queued/i)).toBeInTheDocument())
    expect(mockedApi.createSong).toHaveBeenCalledTimes(2)
    expect(mockedApi.uploadFile).toHaveBeenNthCalledWith(2, 'https://s3/put-fresh', expect.any(File))
    expect(mockedApi.processSong).toHaveBeenCalledWith('tok', 'new1')
  })
})

// --- upload loading UX (spinning disc + explore-library escape hatch) --------

describe('upload loading UX', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedAuth.fetchAuthSession.mockResolvedValue(session)
    mockedApi.getLyrics.mockResolvedValue({
      songId: 's0', sourceLanguage: 'ro', targetLanguage: 'en', lines: [],
    })
  })

  it('while processing: 30-minute note + Explore the library button navigating away', async () => {
    mockedApi.createSong.mockResolvedValue({ songId: 'newsong12345', uploadUrl: 'https://s3/put' })
    mockedApi.uploadFile.mockResolvedValue(undefined)
    mockedApi.processSong.mockResolvedValue({
      kind: 'started', songId: 'newsong12345', format: 'mp3', jobId: 'newsong12345.job1',
    })
    mockedApi.getJob.mockResolvedValue({
      jobId: 'newsong12345.job1', songId: 'newsong12345', status: 'PROCESSING', stage: 'ChunkAudio',
    })
    mockedApi.getAudioUrls.mockResolvedValue({ urls: { raw: 'https://s3/raw?n' }, expiresInSeconds: 900 })
    const onNavigate = vi.fn()
    renderWithProviders(<UploadPanel onNavigate={onNavigate} />)
    const form = screen.getByRole('form', { name: /upload a song/i })
    const file = new File([new Uint8Array(60_000)], 'song.mp3', { type: 'audio/mpeg' })
    const input = screen.getByLabelText(/audio file/i) as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file] })
    fireEvent.submit(form)
    expect(await screen.findByText(/up to 30 minutes/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /explore the library/i }))
    expect(onNavigate).toHaveBeenCalledWith('library')
  })
})
